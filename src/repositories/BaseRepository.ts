import { adminFirestore } from "@/firebase/firebaseAdmin";
import {
  FieldValue,
  type Query,
  type CollectionReference,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import dayjs, { SL_TZ } from "../utils/dayjs";

/**
 * Base Repository providing common Firestore operations
 * All repositories should extend this class
 */
export abstract class BaseRepository<T> {
  protected collection: CollectionReference;
  protected collectionName: string;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
    this.collection = adminFirestore.collection(collectionName);
  }

  /**
   * Get document reference for transactions
   */
  getDocRef(id: string): FirebaseFirestore.DocumentReference {
    return this.collection.doc(id);
  }

  /**
   * Get base query with standard active filters (isDeleted, status)
   */
  protected getActiveQuery(): Query {
    return this.collection
      .where("isDeleted", "==", false)
      .where("status", "==", true);
  }

  /**
   * Get base query without status filter (for entities that use different status handling)
   */
  protected getNonDeletedQuery(): Query {
    return this.collection.where("isDeleted", "==", false);
  }

  /**
   * Count documents matching query without fetching all data
   */
  protected async countDocuments(query: Query): Promise<number> {
    try {
      const countSnapshot = await query.count().get();
      return countSnapshot.data().count;
    } catch (error) {
      console.error(`[${this.collectionName}Repository] Count error:`, error);
      // Fallback to full fetch if count() not available
      const snapshot = await query.get();
      return snapshot.size;
    }
  }

  /**
   * Apply offset-based pagination to query
   * Note: For large datasets, consider cursor-based pagination
   */
  protected applyPagination(
    query: Query,
    page: number = 1,
    size: number = 20
  ): Query {
    const offset = Math.max(0, (page - 1) * size);
    return query.offset(offset).limit(size);
  }

  /**
   * Fetch a single document by ID
   */
  async findById(id: string): Promise<T | null> {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as T;
  }

  /**
   * Create a new document
   */
  async create(
    id: string,
    data: T,
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<T> {
    const docRef = this.collection.doc(id);
    const now = FieldValue.serverTimestamp();
    const record = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };
    if (tx) {
      (tx as any).set(docRef, record);
    } else {
      await docRef.set(record);
    }
    return record as any;
  }

  /**
   * Update an existing document
   */
  async update(
    id: string,
    data: Partial<T>,
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<void> {
    const docRef = this.collection.doc(id);
    const updateData = {
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (tx) {
      (tx as any).update(docRef, updateData);
    } else {
      await docRef.update(updateData);
    }
  }

  /**
   * Soft-delete a document
   */
  async softDelete(
    id: string,
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<void> {
    const updateData = {
      isDeleted: true,
      updatedAt: FieldValue.serverTimestamp(),
    };
    return this.update(id, updateData as any, tx);
  }

  /**
   * Delete a document
   */
  async delete(
    id: string,
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<void> {
    const docRef = this.collection.doc(id);
    if (tx) {
      tx.delete(docRef);
    } else {
      await docRef.delete();
    }
  }

  /**
   * Batch fetch documents by IDs (handles Firestore 'in' limit of 30)
   */
  protected async findDocsByIds(
    ids: string[],
    idField: string = "id"
  ): Promise<DocumentSnapshot[]> {
    if (!ids.length) return [];

    const results: DocumentSnapshot[] = [];
    const chunks: string[][] = [];

    // Split into chunks of 30 (Firestore 'in' limit)
    for (let i = 0; i < ids.length; i += 30) {
      chunks.push(ids.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      const snapshot = await this.collection
        .where(idField, "in", chunk)
        .get();
      results.push(...snapshot.docs);
    }

    return results;
  }

  /**
   * Public wrapper for findDocsByIds
   */
  async findByIds(ids: string[]): Promise<T[]> {
    if (!ids.length) return [];
    const docs = await this.findDocsByIds(ids);
    return docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);
  }

  /**
   * Run a Firestore write batch with a callback
   */
  async runBatch(callback: (batch: FirebaseFirestore.WriteBatch) => Promise<void>): Promise<void> {
    const batch = this.createBatch();
    await callback(batch);
    await batch.commit();
  }

  /**
   * Run a Firestore write batch with a callback
   */
  async runBatch(callback: (batch: FirebaseFirestore.WriteBatch) => Promise<void>): Promise<void> {
    const batch = this.createBatch();
    await callback(batch);
    await batch.commit();
  }

  /**
   * Get last document number for a prefix
   */
  protected async findLastNumber(field: string, prefix: string): Promise<string | null> {
    const snapshot = await this.collection
      .where(field, ">=", prefix)
      .where(field, "<", prefix + "\uf8ff")
      .orderBy(field, "desc")
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return snapshot.docs[0].data()[field];
  }

  /**
   * Serialize Firestore Timestamp to Sri Lanka Localized String
   */
  protected serializeTimestamp(val: any): string | null {
    if (!val) return null;
    try {
      const date =
        typeof val.toDate === "function"
          ? val.toDate()
          : val instanceof Date
          ? val
          : new Date(val);

      if (isNaN(date.getTime())) return String(val);

      return dayjs(date).tz(SL_TZ).format("DD/MM/YYYY, hh:mm:ss a");
    } catch {
      return String(val);
    }
  }

  /**
   * Run a Firestore transaction
   */
  async runTransaction<R>(
    updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<R>
  ): Promise<R> {
    return adminFirestore.runTransaction(updateFunction);
  }

  /**
   * Create a Firestore write batch
   */
  createBatch(): FirebaseFirestore.WriteBatch {
    return adminFirestore.batch();
  }

  /**
   * Find any document by collection name and ID
   */
  async findAnyDocument(collectionName: string, id: string): Promise<any | null> {
    const doc = await adminFirestore.collection(collectionName).doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }
}
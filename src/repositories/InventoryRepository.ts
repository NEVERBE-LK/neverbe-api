import { BaseRepository } from "./BaseRepository";
import type { InventoryItem } from "@/model/InventoryItem";
import { FieldValue, Transaction } from "firebase-admin/firestore";

/**
 * Inventory Repository - handles all stock and inventory data access
 */
export class InventoryRepository extends BaseRepository<InventoryItem> {
  constructor() {
    super("stock_inventory");
  }

  /**
   * Find inventory item by product, variant, size and stock location
   */
  async findBySpecs(
    productId: string,
    variantId: string | null,
    size: string,
    stockId: string
  ): Promise<FirebaseFirestore.DocumentReference | null> {
    const snapshot = await this.collection
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("size", "==", size)
      .where("stockId", "==", stockId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return snapshot.docs[0].ref;
  }

  /**
   * Find all inventory items for a product
   */
  async findByProductId(productId: string): Promise<InventoryItem[]> {
    const snapshot = await this.collection
      .where("productId", "==", productId)
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
  }

  /**
   * Find specific inventory item data
   */
  async findItem(stockId: string, productId: string, variantId: string | null, size: string): Promise<InventoryItem | null> {
    const snapshot = await this.collection
      .where("stockId", "==", stockId)
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("size", "==", size)
      .limit(1)
      .get();

    return snapshot.empty ? null : (snapshot.docs[0].data() as InventoryItem);
  }

  /**
   * Find all inventory items for a product and stock
   */
  async findByProductAndStock(productId: string, stockId: string): Promise<InventoryItem[]> {
    let query = this.collection.where("productId", "==", productId);
    if (stockId) query = query.where("stockId", "==", stockId);
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
  }

  /**
   * Get product IDs available at a specific stock location
   */
  async findProductIdsByStock(stockId: string): Promise<string[]> {
    const snapshot = await this.collection
      .where("stockId", "==", stockId)
      .get();
    return Array.from(new Set(snapshot.docs.map(doc => doc.data().productId)));
  }

  /**
   * Find paginated inventory with filters
   */
  async findPaginated(options: {
    page?: number;
    size?: number;
    productId?: string;
    variantId?: string;
    sizeFilter?: string;
    stockId?: string;
  }): Promise<{ dataList: InventoryItem[]; total: number }> {
    const { page = 1, size = 20, productId, variantId, sizeFilter, stockId } = options;
    let query = this.collection as FirebaseFirestore.Query;

    if (productId) query = query.where("productId", "==", productId);
    if (variantId) query = query.where("variantId", "==", variantId);
    if (sizeFilter) query = query.where("size", "==", sizeFilter);
    if (stockId) query = query.where("stockId", "==", stockId);

    const total = await this.countDocuments(query);
    const snapshot = await this.applyPagination(query, page, size).get();

    return {
      dataList: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)),
      total
    };
  }

  /**
   * Update quantity directly
   */
  async updateQuantity(id: string, newQuantity: number): Promise<void> {
    await this.update(id, {
      quantity: Number(newQuantity),
    } as any);
  }

  /**
   * Find specific item ID
   */
  async findDocId(productId: string, variantId: string | null, size: string, stockId: string): Promise<string | null> {
    const snapshot = await this.collection
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("size", "==", size)
      .where("stockId", "==", stockId)
      .limit(1)
      .get();

    return snapshot.empty ? null : snapshot.docs[0].id;
  }

  /**
   * Deduct stock for a specific item (Transaction safe)
   */
  async deductStock(
    tx: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
    productId: string,
    variantId: string | null,
    size: string,
    stockId: string,
    quantity: number
  ) {
    const invRef = await this.findBySpecs(productId, variantId, size, stockId);
    if (!invRef) {
      const newRef = this.collection.doc();
      (tx as any).set(newRef, {
        productId,
        variantId: variantId || null,
        size,
        stockId,
        quantity: -quantity,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    (tx as any).update(invRef, {
      quantity: FieldValue.increment(-quantity),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  /**
   * Restore stock for a specific item (Transaction safe)
   * Prevents stock reversal on minus stock items from exceeding 0 (so 0-stock items cannot become positive real stock)
   */
  async restoreStock(
    tx: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
    productId: string,
    variantId: string | null,
    size: string,
    stockId: string,
    quantity: number,
    options?: { isMinusStock?: boolean; capAtZero?: boolean }
  ) {
    const invRef = await this.findBySpecs(productId, variantId, size, stockId);
    if (!invRef) return;

    if (tx instanceof Transaction) {
      const snap = await tx.get(invRef);
      if (snap.exists) {
        const currentQty = Number(snap.data()?.quantity ?? 0);
        // Rule: If item was marked as minus stock, or capAtZero is requested,
        // or current stock is negative, cap at 0 so it can never become positive real stock
        if (options?.isMinusStock || options?.capAtZero || currentQty < 0) {
          const newQty = Math.min(0, currentQty + quantity);
          tx.update(invRef, {
            quantity: newQty,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return;
        }
      }
    }

    (tx as any).update(invRef, {
      quantity: FieldValue.increment(quantity),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  /**
   * Upsert stock (create or increment) (Transaction safe)
   */
  async upsertStock(
    tx: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
    productId: string,
    variantId: string | null,
    size: string,
    stockId: string,
    quantity: number
  ) {
    const snapshot = await this.collection
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("size", "==", size)
      .where("stockId", "==", stockId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      (tx as any).update(snapshot.docs[0].ref, {
        quantity: FieldValue.increment(quantity),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      const newRef = this.collection.doc();
      (tx as any).set(newRef, {
        productId,
        variantId,
        size,
        stockId,
        quantity,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
}

export const inventoryRepository = new InventoryRepository();

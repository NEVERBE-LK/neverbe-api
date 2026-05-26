import { BaseRepository } from "./BaseRepository";
import type { Promotion } from "@/interfaces";

/**
 * Promotion Repository - handles promotion data access
 */
export class PromotionRepository extends BaseRepository<Promotion> {
  constructor() {
    super("promotions");
  }

  /**
   * Serialize promotion for client
   */
  private serializePromotion(
    doc: FirebaseFirestore.DocumentSnapshot,
  ): Promotion {
    const data = doc.data()!;
    return {
      id: doc.id,
      ...data,
      startDate: this.serializeTimestamp(data.startDate),
      endDate: this.serializeTimestamp(data.endDate),
      createdAt: this.serializeTimestamp(data.createdAt),
      updatedAt: this.serializeTimestamp(data.updatedAt),
    } as Promotion;
  }

  /**
   * Find all active promotions (within date range)
   */
  async findActive(): Promise<Promotion[]> {
    const now = new Date();

    // Fetch all promotions and filter in-memory to avoid index issues
    // and handle missing fields (e.g., missing isActive or isDeleted) safely
    const snapshot = await this.collection.get();

    return snapshot.docs
      .filter((doc) => {
        const data = doc.data()!;
        
        // Ensure not marked as deleted
        if (data.isDeleted === true) return false;

        // 1. Status Check (support both legacy `status` and `isActive` boolean)
        if (data.status === "INACTIVE" || data.isActive === false) return false;

        // 2. Date Check using raw Firestore Timestamps or raw Dates
        const rawStart = data.startDate;
        const rawEnd = data.endDate;

        const startDate = rawStart
          ? typeof rawStart.toDate === "function"
            ? rawStart.toDate()
            : rawStart instanceof Date
            ? rawStart
            : new Date(rawStart)
          : null;
          
        const endDate = rawEnd
          ? typeof rawEnd.toDate === "function"
            ? rawEnd.toDate()
            : rawEnd instanceof Date
            ? rawEnd
            : new Date(rawEnd)
          : null;

        if (startDate && now < startDate) return false;
        if (endDate && now > endDate) return false;

        return true;
      })
      .map((doc) => this.serializePromotion(doc));
  }

  /**
   * Find promotion by ID
   */
  async findById(id: string): Promise<Promotion | null> {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return null;

    const promo = this.serializePromotion(doc);
    if ((promo as any).isDeleted) return null;

    return promo;
  }

  /**
   * Find all promotions
   */
  async findAll(): Promise<Promotion[]> {
    const snapshot = await this.collection.where("isDeleted", "!=", true).get();
    return snapshot.docs.map((doc) => this.serializePromotion(doc));
  }

  /**
   * Create a new promotion
   */
  async create(data: Partial<Promotion>): Promise<Promotion> {
    const docRef = await this.collection.add({
      ...data,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const doc = await docRef.get();
    return this.serializePromotion(doc);
  }

  /**
   * Update an existing promotion
   */
  async update(id: string, data: Partial<Promotion>): Promise<Promotion> {
    await this.collection.doc(id).update({
      ...data,
      updatedAt: new Date(),
    });
    const doc = await this.collection.doc(id).get();
    return this.serializePromotion(doc);
  }

  /**
   * Delete a promotion (soft delete)
   */
  async delete(id: string): Promise<void> {
    await this.collection.doc(id).update({
      isDeleted: true,
      updatedAt: new Date(),
    });
  }

  /**
   * Increment usage count for a promotion
   */
  async incrementUsageCount(id: string): Promise<void> {
    const admin = await import("firebase-admin");
    await this.collection.doc(id).update({
      usageCount: admin.firestore.FieldValue.increment(1),
      updatedAt: new Date(),
    });
  }
  /**
   * Find paginated promotions
   */
  async findPaginated(options: {
    page?: number;
    size?: number;
    filterStatus?: string;
    search?: string;
    type?: string;
  }): Promise<{ dataList: Promotion[]; total: number }> {
    const { page = 1, size = 20, filterStatus, search, type } = options;
    let query = this.collection.where("isDeleted", "==", false);

    if (filterStatus && filterStatus !== "all") {
      query = query.where("isActive", "==", filterStatus === "ACTIVE" || filterStatus === "true");
    }
    if (type && type !== "all") {
      query = query.where("type", "==", type);
    }
    if (search) {
      query = query.where("name", ">=", search).where("name", "<=", search + "\uf8ff");
    }

    const total = (await query.count().get()).data().count;
    const snapshot = await query
      .orderBy("createdAt", "desc")
      .offset((page - 1) * size)
      .limit(size)
      .get();

    return {
      dataList: snapshot.docs.map(doc => this.serializePromotion(doc)),
      total
    };
  }

  /**
   * Get user usage count for a promotion
   */
  async getUserUsageCount(promoId: string, userId: string): Promise<number> {
    const snapshot = await this.collection.firestore
      .collection("orders")
      .where("userId", "==", userId)
      .where("appliedPromotionIds", "array-contains", promoId)
      .where("status", "!=", "CANCELLED")
      .count()
      .get();
    return snapshot.data().count;
  }
}

export const promotionRepository = new PromotionRepository();

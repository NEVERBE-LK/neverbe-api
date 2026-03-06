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

    const snapshot = await this.collection
      .where("isActive", "==", true)
      .where("isDeleted", "!=", true)
      // Firestore index limitation: we cannot reliably do multiple inequality filters
      // on different fields (`isDeleted`, `endDate`, `startDate`) without explicit
      // composite indexes.
      // The filter logic below already exactly verifies the dates in-memory safely.
      .get();

    return snapshot.docs
      .map((doc) => this.serializePromotion(doc))
      .filter((promo) => {
        const startDate = promo.startDate
          ? new Date(promo.startDate as string)
          : null;
        const endDate = promo.endDate
          ? new Date(promo.endDate as string)
          : null;
        if (startDate && now < startDate) return false;
        if (endDate && now > endDate) return false;
        return true;
      });
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
}

// Singleton instance
export const promotionRepository = new PromotionRepository();

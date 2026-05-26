import { BaseRepository } from "./BaseRepository";
import { Coupon } from "@/model/Coupon";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Coupon Repository - handles coupon data access
 */
export class CouponRepository extends BaseRepository<Coupon> {
  constructor() {
    super("coupons");
  }

  /**
   * Find coupon by code
   */
  async findByCode(code: string): Promise<Coupon | null> {
    const snapshot = await this.collection
      .where("code", "==", code)
      .where("isDeleted", "==", false)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as Coupon;
  }

  /**
   * Find all active public coupons (within date range, active status, not deleted)
   */
  async findActivePublic(): Promise<Coupon[]> {
    const now = new Date();

    const snapshot = await this.collection.get();

    return snapshot.docs
      .filter((doc) => {
        const data = doc.data()!;

        // Ensure not marked as deleted
        if (data.isDeleted === true) return false;

        // 1. Status Check
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
      .map((doc) => {
        return { id: doc.id, ...doc.data() } as Coupon;
      });
  }

  /**
   * Find paginated coupons
   */
  async findPaginated(options: {
    page?: number;
    size?: number;
    filterStatus?: string;
    search?: string;
  }): Promise<{ dataList: Coupon[]; total: number }> {
    const { page = 1, size = 20, filterStatus, search } = options;
    let query = this.collection.where("isDeleted", "==", false);

    if (filterStatus && filterStatus !== "all") {
      query = query.where("isActive", "==", filterStatus === "ACTIVE" || filterStatus === "true");
    }

    if (search) {
      query = query.where("code", ">=", search).where("code", "<=", search + "\uf8ff");
    }

    const total = (await query.count().get()).data().count;
    const snapshot = await query
      .orderBy("createdAt", "desc")
      .offset((page - 1) * size)
      .limit(size)
      .get();

    return {
      dataList: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Coupon)),
      total
    };
  }

  /**
   * Get user usage count
   */
  async getUserUsageCount(couponId: string, userId: string): Promise<number> {
    const snapshot = await this.collection.firestore
      .collection("coupon_usage")
      .where("couponId", "==", couponId)
      .where("userId", "==", userId)
      .count()
      .get();
    return snapshot.data().count;
  }

  /**
   * Track usage
   */
  async trackUsage(couponId: string, userId: string, orderId: string, discountApplied: number): Promise<void> {
    const usageRef = this.collection.firestore.collection("coupon_usage").doc();
    await usageRef.set({
      id: usageRef.id,
      couponId,
      userId,
      orderId,
      discountApplied,
      usedAt: FieldValue.serverTimestamp(),
    });

    await this.collection.doc(couponId).update({
      usageCount: FieldValue.increment(1),
    });
  }
}

export const couponRepository = new CouponRepository();

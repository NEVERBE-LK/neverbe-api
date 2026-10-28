import { BaseRepository } from "./BaseRepository";
import { Coupon } from "@/model/Coupon";
import { ProductVariantTarget } from "@/model/Promotion";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Coupon Repository - handles coupon data access
 */
export class CouponRepository extends BaseRepository<Coupon> {
  constructor() {
    super("coupons");
  }

  /**
   * Serialize coupon for client
   */
  public serializeCoupon(data: any): Coupon {
    if (!data) return data;
    const docData = typeof data.data === "function" ? { id: data.id, ...data.data() } : data;
    return {
      ...docData,
      startDate: this.serializeTimestamp(docData.startDate),
      endDate: this.serializeTimestamp(docData.endDate),
      createdAt: this.serializeTimestamp(docData.createdAt),
      updatedAt: this.serializeTimestamp(docData.updatedAt),
    } as Coupon;
  }

  /**
   * Find coupon by ID
   */
  async findById(id: string): Promise<Coupon | null> {
    const doc = await this.collection.doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data?.isDeleted === true) return null;
    return this.serializeCoupon(doc);
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
    return this.serializeCoupon(doc);
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
      .map((doc) => this.serializeCoupon(doc));
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
      dataList: snapshot.docs.map(doc => this.serializeCoupon(doc)),
      total
    };
  }

  /**
   * Update an existing coupon
   */
  async update(id: string, data: Partial<Coupon>): Promise<Coupon> {
    const docRef = this.collection.doc(id);
    const updateData = {
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await docRef.update(updateData);
    const updatedDoc = await docRef.get();
    return this.serializeCoupon(updatedDoc);
  }

  /**
   * Check if this is the customer's first order
   */
  async isFirstOrder(userId: string | null, email?: string | null, phone?: string | null): Promise<boolean> {
    try {
      const db = this.collection.firestore;
      if (userId && userId !== "guest") {
        const userOrders = await db
          .collection("orders")
          .where("userId", "==", userId)
          .where("isDeleted", "==", false)
          .limit(1)
          .get();
        if (!userOrders.empty) return false;
      }
      if (phone) {
        const phoneOrders = await db
          .collection("orders")
          .where("customer.phone", "==", phone)
          .where("isDeleted", "==", false)
          .limit(1)
          .get();
        if (!phoneOrders.empty) return false;
      }
      if (email) {
        const emailOrders = await db
          .collection("orders")
          .where("customer.email", "==", email)
          .where("isDeleted", "==", false)
          .limit(1)
          .get();
        if (!emailOrders.empty) return false;
      }
      return true;
    } catch (err) {
      console.error("[CouponRepository] Error checking isFirstOrder:", err);
      return true;
    }
  }

  /**
   * Check if cart items meet variant eligibility rules
   */
  checkVariantEligibility(
    cartItems: any[],
    targets: ProductVariantTarget[]
  ): boolean {
    if (!targets || targets.length === 0) return true;
    for (const target of targets) {
      const matching = cartItems.filter(
        (i) => (i.productId || i.itemId) === target.productId
      );
      if (matching.length === 0) continue;
      if (target.variantMode === "ALL_VARIANTS") return true;
      if (target.variantMode === "SPECIFIC_VARIANTS" && target.variantIds) {
        if (
          matching.some(
            (i) => i.variantId && target.variantIds!.includes(i.variantId)
          )
        )
          return true;
      }
    }
    return false;
  }

  /**
   * Filter cart items eligible for variant targeting
   */
  getEligibleCartItems(
    cartItems: any[],
    targets: ProductVariantTarget[]
  ): any[] {
    if (!targets || targets.length === 0) return cartItems;
    return cartItems.filter((item) => {
      const target = targets.find(
        (t) => t.productId === (item.productId || item.itemId)
      );
      if (!target) return false;
      if (target.variantMode === "ALL_VARIANTS") return true;
      return (
        target.variantMode === "SPECIFIC_VARIANTS" &&
        target.variantIds?.includes(item.variantId)
      );
    });
  }

  /**
   * Get user usage count
   */
  async getUserUsageCount(couponId: string, userIdentifier: string): Promise<number> {
    if (!userIdentifier || userIdentifier === "guest") return 0;
    const snapshot = await this.collection.firestore
      .collection("coupon_usage")
      .where("couponId", "==", couponId)
      .where("userId", "==", userIdentifier)
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
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

export const couponRepository = new CouponRepository();

import { BaseRepository } from "./BaseRepository";
import { FieldValue } from "firebase-admin/firestore";
import type { Order } from "@/interfaces";
import { formatInTimeZone } from "date-fns-tz";

/**
 * Order Repository - handles order data access
 */
export class OrderRepository extends BaseRepository<Order> {
  constructor() {
    super("orders");
  }

  /**
   * Format timestamp to locale string
   */
  private toLocaleString(val: any): string | null {
    if (!val) return null;
    try {
      // Handle Firestore Timestamps and various other date formats
      let date: Date;
      if (typeof val.toDate === "function") {
        date = val.toDate();
      } else if (val instanceof Date) {
        date = val;
      } else if (val && typeof val === "object" && "_seconds" in val) {
        // Handle raw Firestore timestamp objects if they aren't converted to admin.Timestamp instances
        date = new Date(val._seconds * 1000);
      } else {
        date = new Date(val);
      }

      if (isNaN(date.getTime())) return null;
      return formatInTimeZone(date, "Asia/Colombo", "dd/MM/yyyy, hh:mm:ss a");
    } catch (e) {
      console.error("[OrderRepository] timestamp conversion error:", e);
      return null;
    }
  }

  /**
   * Find order by orderId for invoice
   */
  async findByOrderId(orderId: string): Promise<Order | null> {
    const snapshot = await this.collection
      .where("orderId", "==", orderId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const order = snapshot.docs[0].data() as Order;

    // Safely get date for expiry check
    let createdAtDate: Date;
    if (order.createdAt && typeof (order.createdAt as any).toDate === "function") {
      createdAtDate = (order.createdAt as any).toDate();
    } else if (order.createdAt && (order.createdAt as any)._seconds) {
      createdAtDate = new Date((order.createdAt as any)._seconds * 1000);
    } else {
      createdAtDate = new Date();
    }

    const diffDays =
      (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24);
    const expired = diffDays > 30;

    return {
      ...order,
      createdAt: this.toLocaleString(order.createdAt),
      updatedAt: this.toLocaleString(order.updatedAt),
      expired,
      customer: order.customer ? {
        ...order.customer,
        createdAt: this.toLocaleString(order.customer.createdAt),
        updatedAt: this.toLocaleString(order.customer.updatedAt),
      } : null,
    } as any;
  }

  /**
   * Update order payment status
   */
  async updatePaymentStatus(
    docId: string,
    paymentId: string,
    status: string,
  ): Promise<Order> {
    await this.collection.doc(docId).update({
      paymentId,
      paymentStatus: status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const doc = await this.collection.doc(docId).get();
    return doc.data() as Order;
  }

  /**
   * Find order document ID by orderId
   */
  async findDocIdByOrderId(orderId: string): Promise<string | null> {
    const snapshot = await this.collection
      .where("orderId", "==", orderId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return snapshot.docs[0].id;
  }

  /**
   * Check if user has any completed orders
   */
  async hasCompletedOrders(userId: string): Promise<boolean> {
    const snapshot = await this.collection
      .where("userId", "==", userId)
      .where("status", "!=", "CANCELLED")
      .limit(1)
      .get();

    return !snapshot.empty;
  }

  /**
   * Get recent orders for a user
   */
  async findByUserId(userId: string, limit: number = 10): Promise<Order[]> {
    const snapshot = await this.collection
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .where("from", "==", "Website")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      ...(doc.data() as Order),
      createdAt: this.toLocaleString(doc.data().createdAt),
      updatedAt: this.toLocaleString(doc.data().updatedAt),
    }));
  }

  /**
   * Count orders by item (for hot products calculation)
   */
  async countOrdersByItem(
    limit: number = 100,
  ): Promise<Record<string, number>> {
    const snapshot = await this.collection.limit(limit).get();
    const itemCount: Record<string, number> = {};

    snapshot.forEach((doc) => {
      const order = doc.data();
      if (Array.isArray(order.items)) {
        order.items.forEach((item: any) => {
          if (item?.itemId) {
            itemCount[item.itemId] = (itemCount[item.itemId] || 0) + 1;
          }
        });
      }
    });

    return itemCount;
  }
}

// Singleton instance
export const orderRepository = new OrderRepository();

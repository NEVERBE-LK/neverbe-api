import { BaseRepository } from "./BaseRepository";
import { FieldValue } from "firebase-admin/firestore";
import type { Order } from "@/interfaces";
import dayjs, { SL_TZ } from "../utils/dayjs";
import { parseToDayjs, toSafeLocaleString } from "../services/UtilService";
import { encryptOrderCustomer, decryptOrderCustomer } from "../services/EncryptionService";

/**
 * Order Repository - handles order data access
 */
export class OrderRepository extends BaseRepository<Order> {
  constructor() {
    super("orders");
  }

  decryptOrder(order: Order | null): Order | null {
    if (!order) return null;
    const orderId = order.orderId || (order as any).id;
    if (order.customer && orderId) {
      return {
        ...order,
        customer: decryptOrderCustomer(order.customer, orderId),
      };
    }
    return order;
  }

  encryptOrder(order: Order): Order {
    const orderId = order.orderId || (order as any).id;
    if (order.customer && orderId) {
      return {
        ...order,
        customer: encryptOrderCustomer(order.customer, orderId),
      };
    }
    return order;
  }

  encryptOrderPartial(order: Partial<Order>, orderId: string): Partial<Order> {
    if (order.customer && orderId) {
      return {
        ...order,
        customer: encryptOrderCustomer(order.customer, orderId),
      };
    }
    return order;
  }

  async findById(id: string): Promise<Order | null> {
    const order = await super.findById(id);
    return this.decryptOrder(order);
  }

  async findByIds(ids: string[]): Promise<Order[]> {
    const orders = await super.findByIds(ids);
    return orders.map(o => this.decryptOrder(o) as Order);
  }

  async create(
    id: string,
    data: Order,
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<Order> {
    const encryptedData = this.encryptOrder(data);
    return super.create(id, encryptedData, tx);
  }

  async update(
    id: string,
    data: Partial<Order>,
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<void> {
    const encryptedData = this.encryptOrderPartial(data, id);
    return super.update(id, encryptedData, tx);
  }

  /**
   * Format timestamp to locale string
   */
  private toLocaleString(val: any): string | null {
    return toSafeLocaleString(val);
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

    const rawOrder = snapshot.docs[0].data() as Order;
    const order = this.decryptOrder({ id: snapshot.docs[0].id, ...rawOrder } as any) as Order;

    // Safely get date for expiry check
    const createdAtDate = parseToDayjs(order.createdAt)?.toDate() || new Date();

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

    return snapshot.docs.map((doc) => {
      const order = this.decryptOrder({ id: doc.id, ...doc.data() } as any) as Order;
      return {
        ...order,
        createdAt: this.toLocaleString(order.createdAt),
        updatedAt: this.toLocaleString(order.updatedAt),
      };
    });
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

  /**
   * Find paid orders within a date range
   */
  async findPaidOrdersInDateRange(
    start: Date,
    end: Date
  ): Promise<Order[]> {
    const snapshot = await this.collection
      .where("paymentStatus", "==", "Paid")
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .get();

    return snapshot.docs.map(doc => this.decryptOrder({ id: doc.id, ...doc.data() } as any) as Order);
  }

  /**
   * Find orders within a date range by status
   */
  async findByStatusInDateRange(
    start: Date,
    end: Date,
    statusList: string[] = ["Paid", "PAID"]
  ): Promise<Order[]> {
    const snapshot = await this.collection
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .where("paymentStatus", "in", statusList)
      .get();

    return snapshot.docs.map(doc => this.decryptOrder({ id: doc.id, ...doc.data() } as any) as Order);
  }

  /**
   * Get recent orders with limit
   */
  async findRecent(limit: number): Promise<Order[]> {
    const snapshot = await this.collection
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => this.decryptOrder({ id: doc.id, ...doc.data() } as any) as Order);
  }

  /**
   * Find orders for reporting purposes
   */
  async findForReport(options?: {
    start?: Date;
    end?: Date;
    paymentStatus?: string;
    limit?: number;
  }): Promise<Order[]> {
    const snapshot = await this.collection.get();
    let docs = snapshot.docs.map(doc => this.decryptOrder({ id: doc.id, ...doc.data() } as any) as Order);

    if (options?.start || options?.end) {
      const startMs = options.start ? options.start.getTime() : 0;
      const endMs = options.end ? options.end.getTime() : Date.now();
      docs = docs.filter((order) => {
        const t = parseToDayjs(order.createdAt)?.valueOf() || 0;
        return t >= startMs && t <= endMs;
      });
    }

    if (options?.paymentStatus && options.paymentStatus !== "all") {
      const ps = options.paymentStatus.toLowerCase();
      docs = docs.filter((o) => (o.paymentStatus || "").toLowerCase() === ps);
    }

    docs.sort((a, b) => (parseToDayjs(b.createdAt)?.valueOf() || 0) - (parseToDayjs(a.createdAt)?.valueOf() || 0));

    if (options?.limit) {
      docs = docs.slice(0, options.limit);
    }

    return docs;
  }

  /**
   * Count by payment status
   */
  async countByPaymentStatus(status: string): Promise<number> {
    const snapshot = await this.collection
      .where("paymentStatus", "==", status)
      .count()
      .get();
    return snapshot.data().count;
  }

  /**
   * Count by order status and payment status
   */
  async countByStatusAndPayment(
    paymentStatus: string,
    orderStatuses: string[]
  ): Promise<number> {
    const snapshot = await this.collection
      .where("paymentStatus", "==", paymentStatus)
      .where("status", "in", orderStatuses)
      .count()
      .get();
    return snapshot.data().count;
  }

  /**
   * Save order with retry logic
   */
  async saveWithRetry(id: string, data: Order, maxAttempts: number = 3): Promise<void> {
    const docRef = this.collection.doc(id);
    const now = FieldValue.serverTimestamp();
    const encrypted = this.encryptOrder(data);
    const orderData = { ...encrypted, createdAt: now, updatedAt: now };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await docRef.set(orderData);
        return;
      } catch (err: any) {
        if (attempt === maxAttempts) throw err;
        await new Promise(r => setTimeout(r, attempt * 200));
      }
    }
  }

  /**
   * Find paginated orders with filters
   */
  async findPaginated(options: {
    page?: number;
    size?: number;
    startDate?: Date;
    endDate?: Date;
    status?: string;
    paymentStatus?: string;
    orderId?: string;
    from?: string;
    stockId?: string;
    paymentMethod?: string;
  }): Promise<{ dataList: Order[]; total: number }> {
    const { 
      page = 1, 
      size = 20, 
      startDate, 
      endDate, 
      status, 
      paymentStatus, 
      orderId, 
      from, 
      stockId, 
      paymentMethod 
    } = options;

    let query: FirebaseFirestore.Query = this.collection;

    if (startDate && endDate) {
      query = query.where("createdAt", ">=", startDate).where("createdAt", "<=", endDate);
    }
    if (status) query = query.where("status", "==", status);
    if (paymentStatus) query = query.where("paymentStatus", "==", paymentStatus);
    if (from) query = query.where("from", "==", from);
    if (stockId) query = query.where("stockId", "==", stockId);
    if (paymentMethod) query = query.where("paymentMethod", "==", paymentMethod);
    if (orderId) query = query.where("orderId", "==", orderId);

    const total = (await query.count().get()).data().count;
    
    // Default sorting
    query = query.orderBy("createdAt", "desc");

    const snapshot = await query
      .offset((page - 1) * size)
      .limit(size)
      .get();

    return {
      dataList: snapshot.docs.map(doc => this.decryptOrder({ id: doc.id, ...doc.data() } as any) as Order),
      total
    };
  }

  /**
   * Find Store (POS) order by orderId
   */
  async findStoreOrderByOrderId(orderId: string, stockId?: string): Promise<{ docId: string; data: Order } | null> {
    let query = this.collection
      .where("orderId", "==", orderId)
      .where("from", "==", "Store");

    if (stockId) {
      query = query.where("stockId", "==", stockId);
    }

    const snapshot = await query.limit(1).get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return {
      docId: doc.id,
      data: this.decryptOrder({ id: doc.id, ...doc.data() } as any) as Order,
    };
  }

  /**
   * Add exchange ID to order with transaction support
   */
  async arrayUnionExchangeId(
    docId: string,
    exchangeId: string,
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<void> {
    await this.update(docId, {
      exchangeIds: FieldValue.arrayUnion(exchangeId),
    } as any, tx);
  }
}

// Singleton instance
export const orderRepository = new OrderRepository();

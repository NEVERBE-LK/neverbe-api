import { BaseRepository } from "./BaseRepository";
import { Timestamp } from "firebase-admin/firestore";
import { decryptOrderCustomer } from "../services/EncryptionService";

/**
 * Report Repository - handles complex analytical queries
 */
export class ReportRepository extends BaseRepository<any> {
  constructor() {
    super("orders");
  }

  /**
   * Get orders for detailed analytics
   */
  async findOrdersForAnalysis(options: {
    start: Date;
    end: Date;
    paymentStatus?: string | string[];
  }): Promise<any[]> {
    const { start, end, paymentStatus } = options;
    let query = this.collection.firestore.collection("orders")
      .where("createdAt", ">=", Timestamp.fromDate(start))
      .where("createdAt", "<=", Timestamp.fromDate(end));

    if (paymentStatus) {
      if (Array.isArray(paymentStatus)) {
        query = query.where("paymentStatus", "in", paymentStatus);
      } else if (paymentStatus !== "all") {
        if (paymentStatus.toLowerCase() === "paid") {
          query = query.where("paymentStatus", "in", ["Paid", "PAID"]);
        } else {
          query = query.where("paymentStatus", "==", paymentStatus);
        }
      }
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => {
      const data = doc.data();
      const orderId = data.orderId || doc.id;
      return {
        id: doc.id,
        ...data,
        customer: data.customer ? decryptOrderCustomer(data.customer, orderId) : null,
      };
    });
  }

  /**
   * Get all orders (historical) for returning customer analysis
   */
  async findHistoricalOrders(cutoff: Date, status: string[]): Promise<any[]> {
    const snapshot = await this.collection.firestore.collection("orders")
      .where("createdAt", "<", Timestamp.fromDate(cutoff))
      .where("paymentStatus", "in", status)
      .get();
    return snapshot.docs.map(doc => {
      const data = doc.data();
      const orderId = data.orderId || doc.id;
      return {
        id: doc.id,
        ...data,
        customer: data.customer ? decryptOrderCustomer(data.customer, orderId) : null,
      };
    });
  }

  /**
   * Get expenses for report
   */
  async findExpensesForReport(options: {
    start: Date;
    end: Date;
    type?: string;
    category?: string;
    status?: string;
  }): Promise<any[]> {
    const { start, end, type, category, status } = options;
    let query = this.collection.firestore.collection("expenses")
      .where("date", ">=", Timestamp.fromDate(start))
      .where("date", "<=", Timestamp.fromDate(end));

    if (type) query = query.where("type", "==", type);
    if (status) query = query.where("status", "==", status);
    if (category && category !== "all") {
      query = query.where("category", "==", category);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Get all products for inventory analysis
   */
  async findAllProducts(): Promise<any[]> {
    const snapshot = await this.collection.firestore.collection("products")
      .get();
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.isDeleted !== true);
  }

  /**
   * Get stock inventory records
   */
  async findStockInventory(options: {
    stockId?: string;
    quantityThreshold?: number;
  }): Promise<any[]> {
    let query = this.collection.firestore.collection("stock_inventory") as any;

    if (options.stockId && options.stockId !== "all") {
      query = query.where("stockId", "==", options.stockId);
    }

    if (options.quantityThreshold !== undefined) {
      query = query.where("quantity", "<=", options.quantityThreshold).orderBy("quantity", "asc");
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Batch fetch documents from any collection
   */
  async findDocsInBatch(collection: string, field: string, ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    const result: any[] = [];
    for (const chunk of chunks) {
      const snap = await this.collection.firestore.collection(collection)
        .where(field, "in", chunk)
        .get();
      snap.docs.forEach(d => result.push({ id: d.id, ...d.data() }));
    }
    return result;
  }
}

export const reportRepository = new ReportRepository();

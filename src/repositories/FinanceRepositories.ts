import { BaseRepository } from "./BaseRepository";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Stock Repository - handles physical stock locations
 */
export class StockRepository extends BaseRepository<any> {
  constructor() {
    super("stocks");
  }

  /**
   * Find paginated stocks
   */
  async findPaginated(options: {
    page?: number;
    size?: number;
    status?: boolean;
  }): Promise<{ dataList: any[]; total: number }> {
    const { page = 1, size = 20, status } = options;
    let query = this.getActiveQuery();

    if (typeof status === "boolean") {
      query = query.where("status", "==", status);
    }

    const total = (await query.count().get()).data().count;
    const snapshot = await query
      .offset((page - 1) * size)
      .limit(size)
      .get();

    return {
      dataList: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      total
    };
  }

  /**
   * Get active stocks for dropdown
   */
  async findForDropdown(): Promise<{ id: string; label: string }[]> {
    const snapshot = await this.getActiveQuery().get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      label: doc.data().name,
    }));
  }

  /**
   * Get all active stocks
   */
  async findActiveStocks(): Promise<any[]> {
    const snapshot = await this.getActiveQuery()
      .where("status", "==", true)
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}

/**
 * PettyCash Repository - handles small cash transactions
 */
export class PettyCashRepository extends BaseRepository<any> {
  constructor() {
    super("expenses");
  }

  /**
   * Find transactions for dashboard
   */
  async findForDashboard(): Promise<any[]> {
    const snapshot = await this.collection
      .where("status", "==", "APPROVED")
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Get recent expenses
   */
  async findRecent(limit: number = 5): Promise<any[]> {
    const snapshot = await this.collection.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Find filtered petty cash entries
   */
  async findFiltered(filters: {
    status?: string;
    type?: string;
    category?: string;
    stockId?: string;
  }): Promise<any[]> {
    let query = this.getNonDeletedQuery();

    if (filters.status) query = query.where("status", "==", filters.status);
    if (filters.type) query = query.where("type", "==", filters.type);
    if (filters.category) query = query.where("category", "==", filters.category);
    if (filters.stockId) query = query.where("stockId", "==", filters.stockId);

    const snapshot = await query.orderBy("date", "desc").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}

/**
 * PaymentRecord Repository - handles supplier and other payment records
 */
export class PaymentRecordRepository extends BaseRepository<any> {
  constructor() {
    super("payment_records");
  }

  /**
   * Find records for dashboard
   */
  async findForDashboard(): Promise<any[]> {
    const snapshot = await this.collection.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Get recent records
   */
  async findRecent(limit: number = 5): Promise<any[]> {
    const snapshot = await this.collection.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}

export const stockRepository = new StockRepository();
export const pettyCashRepository = new PettyCashRepository();
export const paymentRecordRepository = new PaymentRecordRepository();

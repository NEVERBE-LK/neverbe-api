import { BaseRepository } from "./BaseRepository";
import { POSCartItem } from "@/services/POSService";
import { FieldValue, Transaction } from "firebase-admin/firestore";

/**
 * PosCart Repository - handles POS cart data access
 */
export class PosCartRepository extends BaseRepository<POSCartItem> {
  constructor() {
    super("pos_cart");
  }

  /**
   * Get cart items for a specific stock and user
   */
  async findByStockAndUser(stockId: string, userId: string): Promise<POSCartItem[]> {
    let query = this.collection.orderBy("createdAt", "desc");
    if (stockId) query = query.where("stockId", "==", stockId);
    if (userId) query = query.where("userId", "==", userId);

    const snap = await query.get();
    return snap.docs.map(doc => doc.data() as POSCartItem);
  }

  /**
   * Find specific item in cart
   */
  async findSpecificItem(
    tx: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
    filters: { itemId: string; variantId: string; size: string; stockId: string; userId: string }
  ): Promise<FirebaseFirestore.DocumentSnapshot | null> {
    const query = this.collection
      .where("itemId", "==", filters.itemId)
      .where("variantId", "==", filters.variantId)
      .where("size", "==", filters.size)
      .where("stockId", "==", filters.stockId)
      .where("userId", "==", filters.userId)
      .limit(1);

    const snap = tx instanceof Transaction ? await tx.get(query) : await query.get();
    return snap.empty ? null : snap.docs[0];
  }

  /**
   * Add item to cart
   */
  async addItem(tx: FirebaseFirestore.Transaction, item: POSCartItem, userId: string) {
    const docRef = this.collection.doc();
    tx.set(docRef, {
      ...item,
      userId: userId || "anonymous",
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  /**
   * Clear cart for a specific stock/user
   */
  async findForClearing(stockId: string, userId: string, limit: number = 500): Promise<FirebaseFirestore.QuerySnapshot> {
    let query = this.collection.limit(limit);
    if (stockId) query = query.where("stockId", "==", stockId);
    if (userId) query = query.where("userId", "==", userId);
    return await query.get();
  }
}

export const posCartRepository = new PosCartRepository();

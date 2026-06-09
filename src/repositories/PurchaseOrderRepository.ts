import { BaseRepository } from "./BaseRepository";
import type { PurchaseOrder } from "@/model/PurchaseOrder";
import { Transaction } from "firebase-admin/firestore";

/**
 * PurchaseOrder Repository - handles purchase order data access
 */
export class PurchaseOrderRepository extends BaseRepository<PurchaseOrder> {
  constructor() {
    super("purchase_orders");
  }

  /**
   * Find paginated and filtered purchase orders
   */
  async findPaginated(options: {
    status?: string;
    supplierId?: string;
    page?: number;
    size?: number;
  }): Promise<{ dataList: PurchaseOrder[]; total: number }> {
    const { status, supplierId, page = 1, size = 20 } = options;
    let query = this.collection as FirebaseFirestore.Query;

    if (status) query = query.where("status", "==", status);
    if (supplierId) query = query.where("supplierId", "==", supplierId);

    const total = (await query.count().get()).data().count;
    const snapshot = await query
      .orderBy("createdAt", "desc")
      .offset((page - 1) * size)
      .limit(size)
      .get();

    return {
      dataList: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder)),
      total
    };
  }

  /**
   * Get last PO number for a prefix
   */
  async findLastPONumber(prefix: string): Promise<string | null> {
    return this.findLastNumber("poNumber", prefix);
  }

  /**
   * Get pending POs (APPROVED status)
   */
  async findPending(): Promise<PurchaseOrder[]> {
    const snapshot = await this.collection
      .where("status", "==", "APPROVED")
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder));
  }

  /**
   * Get product IDs from all APPROVED purchase orders
   */
  async findProductIdsFromApprovedPOs(): Promise<Set<string>> {
    const snapshot = await this.collection
      .where("status", "==", "APPROVED")
      .get();

    const productIds = new Set<string>();
    snapshot.forEach((doc) => {
      const po = doc.data();
      if (Array.isArray(po.items)) {
        po.items.forEach((item: any) => {
          if (item.productId) productIds.add(item.productId);
        });
      }
    });
    return productIds;
  }

  /**
   * Update received quantities for a PO and calculate new status
   */
  async updateReceivedQuantities(
    id: string,
    receivedItems: {
      productId: string;
      variantId?: string;
      size: string;
      quantity: number;
    }[],
    tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch
  ): Promise<void> {
    const docRef = this.collection.doc(id);
    const snap = tx instanceof Transaction ? await tx.get(docRef) : await docRef.get();
    
    if (!snap.exists) throw new Error(`Purchase Order with ID ${id} not found`);
    const po = snap.data() as PurchaseOrder;

    const updatedItems = po.items.map((item) => {
      const received = receivedItems.find(
        (r) => r.productId === item.productId && r.variantId === item.variantId && r.size === item.size,
      );

      if (received) {
        return {
          ...item,
          receivedQuantity: (item.receivedQuantity || 0) + received.quantity,
        };
      }
      return item;
    });

    const allReceived = updatedItems.every((item) => (item.receivedQuantity || 0) >= item.quantity);
    const anyReceived = updatedItems.some((item) => (item.receivedQuantity || 0) > 0);

    let newStatus = po.status;
    if (allReceived) {
      newStatus = "COMPLETED" as any;
    } else if (anyReceived) {
      newStatus = "APPROVED" as any;
    }

    const updateData = { 
      items: updatedItems, 
      status: newStatus, 
      updatedAt: require("firebase-admin/firestore").FieldValue.serverTimestamp() 
    };

    if (tx) {
      (tx as any).update(docRef, updateData);
    } else {
      await docRef.update(updateData);
    }
  }
}

export const purchaseOrderRepository = new PurchaseOrderRepository();

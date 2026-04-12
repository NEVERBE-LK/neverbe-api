import { adminFirestore } from "@/firebase/firebaseAdmin";
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderItem,
} from "@/model/PurchaseOrder";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "@/utils/apiResponse";
import { nanoid } from "nanoid";

const COLLECTION = "purchase_orders";

/**
 * Generate next PO number
 */
const generatePONumber = async (): Promise<string> => {
  const today = new Date();
  const prefix = `PO-${today.getFullYear()}${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}`;

  const snapshot = await adminFirestore
    .collection(COLLECTION)
    .where("poNumber", ">=", prefix)
    .where("poNumber", "<", prefix + "\uf8ff")
    .limit(1)
    .get();

  let sequence = 1;
  if (!snapshot.empty) {
    const lastPO = snapshot.docs[0].data().poNumber;
    const lastSeq = parseInt(lastPO.split("-").pop() || "0", 10);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${String(sequence).padStart(4, "0")}`;
};

/**
 * Get all purchase orders with optional filters
 */
export const getPurchaseOrders = async (
  status?: PurchaseOrderStatus,
  supplierId?: string,
): Promise<PurchaseOrder[]> => {
  try {
    let query: FirebaseFirestore.Query = adminFirestore.collection(COLLECTION);

    if (status) {
      query = query.where("status", "==", status);
    }

    if (supplierId) {
      query = query.where("supplierId", "==", supplierId);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as PurchaseOrder[];
  } catch (error) {
    console.error("[PurchaseOrderService] Error fetching POs:", error);
    throw error;
  }
};

/**
 * Get PO by ID
 */
export const getPurchaseOrderById = async (
  id: string,
): Promise<PurchaseOrder> => {
  try {
    const doc = await adminFirestore.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
      throw new AppError(`Purchase Order with ID ${id} not found`, 404);
    }
    return { id: doc.id, ...doc.data() } as PurchaseOrder;
  } catch (error) {
    console.error("[PurchaseOrderService] Error fetching PO:", error);
    throw error;
  }
};

/**
 * Create new purchase order
 */
export const createPurchaseOrder = async (
  po: Omit<PurchaseOrder, "id" | "poNumber" | "createdAt" | "updatedAt">,
): Promise<PurchaseOrder> => {
  try {
    const poNumber = await generatePONumber();

    // Calculate total
    const totalAmount = po.items.reduce((sum, item) => sum + item.totalCost, 0);

    // Initialize receivedQuantity to 0 for all items
    const items: PurchaseOrderItem[] = po.items.map((item) => ({
      ...item,
      receivedQuantity: 0,
    }));

    const id = `po-${nanoid(8)}`;
    await adminFirestore
      .collection(COLLECTION)
      .doc(id)
      .set({
        ...po,
        poNumber,
        items,
        totalAmount,
        status: po.status || "DRAFT",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    return {
      id,
      ...po,
      poNumber,
      items,
      totalAmount,
    };
  } catch (error) {
    console.error("[PurchaseOrderService] Error creating PO:", error);
    throw error;
  }
};

/**
 * Update purchase order
 */
export const updatePurchaseOrder = async (
  id: string,
  updates: Partial<PurchaseOrder>,
): Promise<PurchaseOrder> => {
  try {
    const docRef = adminFirestore.collection(COLLECTION).doc(id);
    const docSnap = await docRef.get(); // Check existence first
    if (!docSnap.exists) {
      throw new AppError(`Purchase Order with ID ${id} not found`, 404);
    }

    const updateData = { ...updates };
    delete (updateData as any).id;
    delete (updateData as any).poNumber;
    delete (updateData as any).createdAt;

    // Recalculate total if items changed
    if (updateData.items) {
      updateData.totalAmount = updateData.items.reduce(
        (sum, item) => sum + item.totalCost,
        0,
      );
    }

    await docRef.update({
      ...updateData,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updated = await getPurchaseOrderById(id);
    return updated; // getPurchaseOrderById will throw if not found (unlikely here)
  } catch (error) {
    console.error("[PurchaseOrderService] Error updating PO:", error);
    throw error;
  }
};

/**
 * Update PO status
 */
export const updatePOStatus = async (
  id: string,
  status: PurchaseOrderStatus,
): Promise<PurchaseOrder> => {
  return updatePurchaseOrder(id, { status });
};

/**
 * Update received quantities on PO (called when GRN is created)
 */
export const updateReceivedQuantities = async (
  id: string,
  receivedItems: {
    productId: string;
    variantId?: string;
    size: string;
    quantity: number;
  }[],
): Promise<PurchaseOrder> => {
  try {
    const po = await getPurchaseOrderById(id);

    // Note: getPurchaseOrderById throws 404 if not found, so no need to check po null

    const updatedItems = po.items.map((item) => {
      const received = receivedItems.find(
        (r) =>
          r.productId === item.productId &&
          r.variantId === item.variantId &&
          r.size === item.size,
      );

      if (received) {
        return {
          ...item,
          receivedQuantity: (item.receivedQuantity || 0) + received.quantity,
        };
      }
      return item;
    });

    // Determine new status
    const allReceived = updatedItems.every(
      (item) => (item.receivedQuantity || 0) >= item.quantity,
    );
    const anyReceived = updatedItems.some(
      (item) => (item.receivedQuantity || 0) > 0,
    );

    let newStatus: PurchaseOrderStatus = po.status;
    if (allReceived) {
      newStatus = "COMPLETED";
    } else if (anyReceived) {
      newStatus = "APPROVED";
    }

    return updatePurchaseOrder(id, { items: updatedItems, status: newStatus });
  } catch (error) {
    console.error(
      "[PurchaseOrderService] Error updating received quantities:",
      error,
    );
    throw error;
  }
};

/**
 * Delete PO (only if draft)
 */
export const deletePurchaseOrder = async (id: string): Promise<void> => {
  try {
    const po = await getPurchaseOrderById(id); // Will throw 404 if not found

    if (po.status !== "DRAFT") {
      throw new AppError("Only draft POs can be deleted", 400);
    }

    await adminFirestore.collection(COLLECTION).doc(id).delete();
  } catch (error) {
    console.error("[PurchaseOrderService] Error deleting PO:", error);
    throw error;
  }
};

/**
 * Get pending POs for GRN creation
 */
export const getPendingPurchaseOrders = async (): Promise<PurchaseOrder[]> => {
  try {
    const snapshot = await adminFirestore
      .collection(COLLECTION)
      .where("status", "==", "APPROVED")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as PurchaseOrder[];
  } catch (error) {
    console.error("[PurchaseOrderService] Error fetching pending POs:", error);
    throw error;
  }
};

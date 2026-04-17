import { adminFirestore } from "@/firebase/firebaseAdmin";
import { GRN, GRNItem, GRNStatus } from "@/model/GRN";
import { FieldValue } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import {
  getPurchaseOrderById,
  updateReceivedQuantities,
} from "./PurchaseOrderService";
import { AppError } from "@/utils/apiResponse";

const COLLECTION = "grn";
const INVENTORY_COLLECTION = "stock_inventory";

/**
 * Generate next GRN number
 */
const generateGRNNumber = async (): Promise<string> => {
  const today = new Date();
  const prefix = `GRN-${today.getFullYear()}${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}`;

  const snapshot = await adminFirestore
    .collection(COLLECTION)
    .where("grnNumber", ">=", prefix)
    .where("grnNumber", "<", prefix + "\uf8ff")
    .limit(1)
    .get();

  let sequence = 1;
  if (!snapshot.empty) {
    const lastGRN = snapshot.docs[0].data().grnNumber;
    const lastSeq = parseInt(lastGRN.split("-").pop() || "0", 10);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${String(sequence).padStart(4, "0")}`;
};

/**
 * Get all GRNs
 */
export const getGRNs = async (
  purchaseOrderId?: string,
  status?: GRNStatus,
): Promise<GRN[]> => {
  try {
    let query: FirebaseFirestore.Query = adminFirestore.collection(COLLECTION);

    if (purchaseOrderId) {
      query = query.where("purchaseOrderId", "==", purchaseOrderId);
    }

    if (status) {
      query = query.where("status", "==", status);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as GRN[];
  } catch (error) {
    console.error("[GRNService] Error fetching GRNs:", error);
    throw error;
  }
};

/**
 * Get GRN by ID
 */
export const getGRNById = async (id: string): Promise<GRN> => {
  try {
    const doc = await adminFirestore.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
      throw new AppError(`GRN with ID ${id} not found`, 404);
    }
    return { id: doc.id, ...doc.data() } as GRN;
  } catch (error) {
    console.error("[GRNService] Error fetching GRN:", error);
    throw error;
  }
};

/**
 * Create GRN (Can be DRAFT, SUBMITTED or APPROVED)
 */
export const createGRN = async (
  grn: Omit<
    GRN,
    "id" | "grnNumber" | "inventoryUpdated" | "createdAt" | "updatedAt"
  >,
): Promise<GRN> => {
  try {
    // Validate PO exists
    await getPurchaseOrderById(grn.purchaseOrderId);

    const grnNumber = await generateGRNNumber();

    // Calculate total
    const totalAmount = grn.items.reduce(
      (sum, item) => sum + item.totalCost,
      0,
    );

    // Create GRN document
    const id = `grn-${nanoid(8)}`;
    const newGRN: GRN = {
      ...grn,
      grnNumber,
      totalAmount,
      inventoryUpdated: false,
      status: grn.status || "DRAFT",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    } as any;

    await adminFirestore.collection(COLLECTION).doc(id).set(newGRN);

    // If created as APPROVED or COMPLETED, trigger updates
    if (grn.status === "APPROVED" || grn.status === "COMPLETED") {
      await processGRNApproval(id);
    }

    return {
      id,
      ...newGRN,
    } as any;
  } catch (error) {
    console.error("[GRNService] Error creating GRN:", error);
    throw error;
  }
};

/**
 * Update GRN Status (Handle inventory updates on Approval)
 */
export const updateGRNStatus = async (
  id: string,
  status: GRNStatus,
): Promise<GRN> => {
  try {
    const docRef = adminFirestore.collection(COLLECTION).doc(id);
    const grn = await getGRNById(id);

    if (grn.status === "COMPLETED" || grn.status === "REJECTED") {
      throw new AppError(`Cannot update status of a ${grn.status} GRN`, 400);
    }

    await docRef.update({
      status,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (
      (status === "APPROVED" || status === "COMPLETED") &&
      !grn.inventoryUpdated
    ) {
      await processGRNApproval(id);
    }

    return await getGRNById(id);
  } catch (error) {
    console.error("[GRNService] Error updating GRN status:", error);
    throw error;
  }
};

/**
 * Process GRN Approval (Update inventory and PO)
 */
const processGRNApproval = async (id: string): Promise<void> => {
  const grn = await getGRNById(id);
  if (grn.inventoryUpdated) return;

  const docRef = adminFirestore.collection(COLLECTION).doc(id);

  // Update inventory quantities
  await updateInventoryFromGRN(grn.items);

  // Mark GRN as inventory updated
  await docRef.update({ 
    inventoryUpdated: true,
    updatedAt: FieldValue.serverTimestamp()
  });

  // Update PO received quantities
  await updateReceivedQuantities(
    grn.purchaseOrderId,
    grn.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      size: item.size,
      quantity: item.receivedQuantity,
    })),
  );
};

/**
 * Update inventory quantities from GRN items
 */
const updateInventoryFromGRN = async (items: GRNItem[]): Promise<void> => {
  const batch = adminFirestore.batch();

  /* Use plain object to avoid iteration issues */
  const productUpdates: Record<string, number> = {};

  for (const item of items) {
    if (item.receivedQuantity <= 0) continue;

    // Query for existing inventory entry
    const inventoryQuery = await adminFirestore
      .collection(INVENTORY_COLLECTION)
      .where("productId", "==", item.productId)
      .where("size", "==", item.size)
      .where("stockId", "==", item.stockId)
      .limit(1)
      .get();

    if (!inventoryQuery.empty) {
      // Update existing inventory
      const inventoryDoc = inventoryQuery.docs[0];
      const currentQty = inventoryDoc.data().quantity || 0;
      batch.update(inventoryDoc.ref, {
        quantity: Math.max(0, currentQty) + item.receivedQuantity,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Create new inventory entry
      const newInventoryRef = adminFirestore
        .collection(INVENTORY_COLLECTION)
        .doc();
      batch.set(newInventoryRef, {
        productId: item.productId,
        variantId: item.variantId || null,
        size: item.size,
        stockId: item.stockId,
        quantity: item.receivedQuantity,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Accumulate product updates
    const current = productUpdates[item.productId] || 0;
    productUpdates[item.productId] = current + item.receivedQuantity;
  }

  await batch.commit();
  console.log(
    `[GRNService] Updated inventory and product totals for ${items.length} items`,
  );
};

/**
 * Get GRNs for a specific supplier
 */
export const getGRNsBySupplierId = async (
  supplierId: string,
): Promise<GRN[]> => {
  try {
    const snapshot = await adminFirestore
      .collection(COLLECTION)
      .where("supplierId", "==", supplierId)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as GRN[];
  } catch (error) {
    console.error("[GRNService] Error fetching GRNs by supplier:", error);
    throw error;
  }
};

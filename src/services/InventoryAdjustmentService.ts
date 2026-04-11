import { adminFirestore, adminAuth } from "@/firebase/firebaseAdmin";
import {
  InventoryAdjustment,
  AdjustmentItem,
  AdjustmentType,
  AdjustmentStatus,
} from "@/model/InventoryAdjustment";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "@/utils/apiResponse";
import { searchAdjustments } from "./AlgoliaService";
import { nanoid } from "nanoid";

const COLLECTION = "inventory_adjustments";
const INVENTORY_COLLECTION = "stock_inventory";

/**
 * Generate adjustment number
 */
const generateAdjustmentNumber = async (): Promise<string> => {
  const today = new Date();
  const prefix = `ADJ-${today.getFullYear()}${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}`;

  const snapshot = await adminFirestore
    .collection(COLLECTION)
    .where("adjustmentNumber", ">=", prefix)
    .where("adjustmentNumber", "<", prefix + "\uf8ff")
    .limit(1)
    .get();

  let sequence = 1;
  if (!snapshot.empty) {
    const last = snapshot.docs[0].data().adjustmentNumber;
    const lastSeq = parseInt(last.split("-").pop() || "0", 10);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${String(sequence).padStart(4, "0")}`;
};

/**
 * Get all adjustments with Algolia search
 */
export const getAdjustments = async (
  pageNumber = 1,
  size = 20,
  search?: string,
  type?: AdjustmentType,
  status?: AdjustmentStatus,
): Promise<{ dataList: InventoryAdjustment[]; rowCount: number }> => {
  try {
    const filters: string[] = [];

    if (type) filters.push(`type:"${type}"`);
    if (status) filters.push(`status:"${status}"`);

    const { hits, nbHits } = await searchAdjustments(search || "", {
      page: pageNumber - 1,
      hitsPerPage: size,
      filters: filters.join(" AND "),
    });

    const adjustments = hits.map((hit: Record<string, any>) => ({
      ...hit,
      id: (hit.objectID as string) || (hit.id as string),
      createdAt: hit.createdAt,
      updatedAt: hit.updatedAt,
    })) as (InventoryAdjustment & { adjustedByName?: string })[];

    // Resolve adjustedBy user names
    const userIds = Array.from(
      new Set(adjustments.map((a) => a.adjustedBy).filter(Boolean)),
    );
    if (userIds.length > 0) {
      try {
        const usersResult = await adminAuth.getUsers(
          userIds.map((id) => ({ uid: id as string })),
        );
        const userMap = new Map(
          usersResult.users.map((u) => [
            u.uid,
            u.displayName || u.email || "Unknown User",
          ]),
        );

        adjustments.forEach((adj) => {
          if (adj.adjustedBy) {
            adj.adjustedByName = userMap.get(adj.adjustedBy);
          }
        });
      } catch (authError) {
        console.warn(
          "[AdjustmentService] Error resolving usernames:",
          authError,
        );
      }
    }

    return { dataList: adjustments, rowCount: nbHits };
  } catch (error) {
    console.error("[AdjustmentService] Error fetching adjustments:", error);
    throw error;
  }
};

/**
 * Get adjustment by ID
 */
export const getAdjustmentById = async (
  id: string,
): Promise<InventoryAdjustment & { adjustedByName?: string }> => {
  try {
    const doc = await adminFirestore.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
      throw new AppError(`Adjustment with ID ${id} not found`, 404);
    }
    const data = doc.data() as InventoryAdjustment;
    let adjustedByName = "";

    if (data.adjustedBy) {
      try {
        const user = await adminAuth.getUser(data.adjustedBy);
        adjustedByName = user.displayName || user.email || "Unknown User";
      } catch (e) {
        console.warn(
          "[AdjustmentService] Error fetching user for detail view",
          e,
        );
      }
    }

    return { id: doc.id, ...data, adjustedByName };
  } catch (error) {
    console.error("[AdjustmentService] Error fetching adjustment:", error);
    throw error;
  }
};

/**
 * Create adjustment and update inventory
 */
export const createAdjustment = async (
  adjustment: Omit<
    InventoryAdjustment,
    "id" | "adjustmentNumber" | "createdAt" | "updatedAt"
  >,
  userId: string,
): Promise<InventoryAdjustment> => {
  try {
    const adjustmentNumber = await generateAdjustmentNumber();
    const status = adjustment.status || "DRAFT";

    // Create adjustment record
    const id = `adj-${nanoid(8)}`;
    await adminFirestore
      .collection(COLLECTION)
      .doc(id)
      .set({
        ...adjustment,
        status,
        adjustmentNumber,
        adjustedBy: userId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    // We do NOT update inventory here anymore. Only on COMPLETION.
    if (status === "COMPLETED") {
      await updateInventoryFromAdjustment(adjustment.items, adjustment.type);
    }

    console.log(
      `[AdjustmentService] Created adjustment ${adjustmentNumber} with ${adjustment.items.length} items`,
    );

    return {
      id,
      ...adjustment,
      status,
      adjustmentNumber,
    };
  } catch (error) {
    console.error("[AdjustmentService] Error creating adjustment:", error);
    throw error;
  }
};

/**
 * Update adjustment status
 */
export const updateAdjustmentStatus = async (
  id: string,
  status: AdjustmentStatus,
  userId: string, // Who updated it
): Promise<void> => {
  try {
    const docRef = adminFirestore.collection(COLLECTION).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new AppError("Adjustment not found", 404);
    }

    const currentData = doc.data() as InventoryAdjustment;

    if (currentData.status === "COMPLETED") {
      throw new AppError("Cannot change status of a COMPLETED adjustment", 400);
    }

    const updates: Record<string, any> = {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      adjustedBy: userId, // Track who approved/rejected/completed
    };

    await docRef.update(updates);

    // ⚠️ CRITICAL: Only COMPLETED status triggers physical inventory updates.
    // APPROVED status is a review milestone and does NOT affect stock levels.
    if (status === "COMPLETED") {
      await updateInventoryFromAdjustment(currentData.items, currentData.type);
    }
  } catch (error) {
    console.error("[AdjustmentService] Error updating status:", error);
    throw error;
  }
};

/**
 * Update inventory based on adjustment
 */
const updateInventoryFromAdjustment = async (
  items: AdjustmentItem[],
  type: AdjustmentType,
): Promise<void> => {
  const batch = adminFirestore.batch();
  /* Use plain object to avoid iteration issues */
  const productUpdates: Record<string, number> = {};

  for (const item of items) {
    if (item.quantity <= 0) continue;

    // Get current inventory
    const inventoryQuery = await adminFirestore
      .collection(INVENTORY_COLLECTION)
      .where("productId", "==", item.productId)
      .where("size", "==", item.size)
      .where("stockId", "==", item.stockId)
      .limit(1)
      .get();

    let currentQty = 0;
    let inventoryRef: FirebaseFirestore.DocumentReference;

    if (!inventoryQuery.empty) {
      inventoryRef = inventoryQuery.docs[0].ref;
      currentQty = inventoryQuery.docs[0].data().quantity || 0;
    } else {
      inventoryRef = adminFirestore.collection(INVENTORY_COLLECTION).doc();
    }

    // Calculate new quantity based on type
    let newQty = currentQty;
    let change = 0;

    switch (type) {
      case "add":
      case "return":
        newQty = Math.max(0, currentQty) + item.quantity;
        break;
      case "remove":
      case "damage":
        newQty = Math.max(0, currentQty - item.quantity);
        break;
      case "transfer":
        newQty = Math.max(0, currentQty - item.quantity);
        // Also add to destination
        if (item.destinationStockId) {
          await addToDestinationStock(item);
        }
        break;
    }

    change = newQty - currentQty;

    if (!inventoryQuery.empty) {
      batch.update(inventoryRef, {
        quantity: newQty,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      batch.set(inventoryRef, {
        productId: item.productId,
        variantId: item.variantId || null,
        size: item.size,
        stockId: item.stockId,
        quantity: newQty,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Accumulate product updates
    if (change !== 0) {
      const current = productUpdates[item.productId] || 0;
      productUpdates[item.productId] = current + change;
    }
  }

  // Recalculate global stock for all affected products
  const { updateProductStockCount } = await import("./InventoryService");
  for (const productId of Object.keys(productUpdates)) {
    await updateProductStockCount(productId);
  }

  await batch.commit();
};

/**
 * Add stock to destination for transfers
 */
const addToDestinationStock = async (item: AdjustmentItem): Promise<void> => {
  if (!item.destinationStockId) return;

  const inventoryQuery = await adminFirestore
    .collection(INVENTORY_COLLECTION)
    .where("productId", "==", item.productId)
    .where("size", "==", item.size)
    .where("stockId", "==", item.destinationStockId)
    .limit(1)
    .get();

  if (!inventoryQuery.empty) {
    const doc = inventoryQuery.docs[0];
    const currentQty = doc.data().quantity || 0;
    await doc.ref.update({
      quantity: currentQty + item.quantity,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await adminFirestore.collection(INVENTORY_COLLECTION).add({
      productId: item.productId,
      variantId: item.variantId || null,
      size: item.size,
      stockId: item.destinationStockId,
      quantity: item.quantity,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
};

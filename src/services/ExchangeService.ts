import { adminFirestore } from "@/firebase/firebaseAdmin";
import admin from "firebase-admin";
import { ExchangeRecord, ExchangeRequest } from "@/model/ExchangeRecord";
import { Order } from "@/model/Order";
import { AppError } from "@/utils/apiResponse";
import { nanoid } from "nanoid";
import {
  findExistingInventoryItem,
  getInventoryQuantity,
  updateProductStockCount,
} from "./InventoryService";

const EXCHANGES_COLLECTION = "exchanges";
const ORDERS_COLLECTION = "orders";
const EXCHANGE_WINDOW_DAYS = 14; // Working days

// ================================
// 🔹 WORKING DAYS CALCULATION
// ================================

/**
 * Calculate the number of working days between two dates (excludes weekends)
 */
export const calculateWorkingDays = (fromDate: Date, toDate: Date): number => {
  let count = 0;
  const current = new Date(fromDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    // Exclude Sunday (0) and Saturday (6)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
};

/**
 * Check if an order is eligible for exchange (within 14 working days)
 */
export const isOrderEligibleForExchange = (orderCreatedAt: Date): boolean => {
  const today = new Date();
  const workingDays = calculateWorkingDays(orderCreatedAt, today);
  return workingDays <= EXCHANGE_WINDOW_DAYS;
};

// ================================
// 🔹 ORDER LOOKUP FOR EXCHANGE
// ================================

/**
 * Get order details for exchange - validates eligibility
 */
export const getOrderForExchange = async (
  orderId: string,
  stockId?: string,
): Promise<{
  eligible: boolean;
  order?: Order & { docId: string };
  workingDaysElapsed?: number;
  message?: string;
}> => {
  try {
    // Find order by orderId (display ID)
    let query = adminFirestore
      .collection(ORDERS_COLLECTION)
      .where("orderId", "==", orderId)
      .where("from", "==", "Store"); // Only POS orders

    if (stockId) {
      query = query.where("stockId", "==", stockId);
    }

    const snapshot = await query.limit(1).get();

    if (snapshot.empty) {
      return {
        eligible: false,
        message: `Order ${orderId} not found or not a POS order`,
      };
    }

    const doc = snapshot.docs[0];
    const orderData = doc.data() as Order;
    const docId = doc.id;

    // Convert Firestore Timestamp to Date
    let createdAtDate: Date;
    if (orderData.createdAt instanceof admin.firestore.Timestamp) {
      createdAtDate = orderData.createdAt.toDate();
    } else if (typeof orderData.createdAt === "string") {
      createdAtDate = new Date(orderData.createdAt);
    } else {
      createdAtDate = new Date();
    }

    const workingDaysElapsed = calculateWorkingDays(createdAtDate, new Date());
    const eligible = workingDaysElapsed <= EXCHANGE_WINDOW_DAYS;

    if (!eligible) {
      return {
        eligible: false,
        workingDaysElapsed,
        message: `Order is ${workingDaysElapsed} working days old. Exchange window is ${EXCHANGE_WINDOW_DAYS} working days.`,
      };
    }

    // Check if order is already cancelled or refunded
    if (orderData.status === "CANCELLED" || orderData.status === "REFUNDED") {
      return {
        eligible: false,
        message: `Order is ${orderData.status} and cannot be exchanged`,
      };
    }

    return {
      eligible: true,
      order: {
        ...orderData,
        docId,
        createdAt: createdAtDate.toISOString(),
        updatedAt:
          orderData.updatedAt instanceof admin.firestore.Timestamp
            ? orderData.updatedAt.toDate().toISOString()
            : orderData.updatedAt,
      } as Order & { docId: string },
      workingDaysElapsed,
    };
  } catch (error) {
    console.error("Error fetching order for exchange:", error);
    throw error;
  }
};

// ================================
// 🔹 EXCHANGE PROCESSING
// ================================

/**
 * Process an exchange - restock returned items, deduct replacements, create record
 */
export const processExchange = async (
  request: ExchangeRequest,
  userId: string,
  userName?: string,
): Promise<ExchangeRecord> => {
  const {
    originalOrderId,
    stockId,
    returnedItems,
    replacementItems,
    notes,
    paymentMethod,
  } = request;

  // 1. Validate order eligibility
  const eligibilityCheck = await getOrderForExchange(originalOrderId, stockId);
  if (!eligibilityCheck.eligible || !eligibilityCheck.order) {
    throw new AppError(
      eligibilityCheck.message || "Order not eligible for exchange",
      400,
    );
  }

  const order = eligibilityCheck.order;

  // 1b. Fetch existing exchanges to prevent returning more than original quantity
  const existingExchanges = await getExchangesByOrderId(order.orderId);
  const returnedQuantitiesMap: Record<string, number> = {};

  existingExchanges.forEach((ex) => {
    ex.returnedItems.forEach((item) => {
      const key = `${item.itemId}-${item.variantId}-${item.size}`;
      returnedQuantitiesMap[key] =
        (returnedQuantitiesMap[key] || 0) + item.quantity;
    });
  });

  // 2. Validate returned items exist in original order and haven't been fully returned
  for (const returnItem of returnedItems) {
    const originalItem = order.items.find(
      (item) =>
        item.itemId === returnItem.itemId &&
        item.variantId === returnItem.variantId &&
        item.size === returnItem.size,
    );

    if (!originalItem) {
      throw new AppError(
        `Item ${returnItem.name} (${returnItem.size}) not found in original order`,
        400,
      );
    }

    const key = `${returnItem.itemId}-${returnItem.variantId}-${returnItem.size}`;
    const alreadyReturned = returnedQuantitiesMap[key] || 0;

    if (returnItem.quantity + alreadyReturned > originalItem.quantity) {
      throw new AppError(
        `Cannot return ${returnItem.quantity} of ${returnItem.name} (${returnItem.size}). ` +
          `Previously returned: ${alreadyReturned}. Original quantity: ${originalItem.quantity}.`,
        400,
      );
    }

    // Ensure returnItem discount matches what was actually paid (pro-rated if needed)
    // Usually POS should send this, but we validate/enforce it here
    const perItemDiscount =
      (originalItem.discount || 0) / originalItem.quantity;
    returnItem.discount = perItemDiscount * returnItem.quantity;
  }

  // 3. Validate replacement items have sufficient stock
  for (const replaceItem of replacementItems) {
    const inventoryResult = await getInventoryQuantity(
      replaceItem.itemId,
      replaceItem.variantId,
      replaceItem.size,
      stockId,
    );
    const currentStock = inventoryResult?.quantity || 0;

    if (currentStock < replaceItem.quantity) {
      throw new AppError(
        `Insufficient stock for ${replaceItem.name} (${replaceItem.size}). Available: ${currentStock}`,
        400,
      );
    }
  }

  // 4. Calculate totals (respecting discounts)
  const returnTotal = returnedItems.reduce(
    (sum, item) => sum + (item.price * item.quantity - (item.discount || 0)),
    0,
  );
  const replacementTotal = replacementItems.reduce(
    (sum, item) => sum + (item.price * item.quantity - (item.discount || 0)),
    0,
  );
  const priceDifference = replacementTotal - returnTotal;

  // 4a. Validate No Refund Policy
  if (priceDifference < 0) {
    throw new AppError(
      "Refunds are not allowed. Replacement value must be equal to or greater than return value.",
      400,
    );
  }

  // 4b. Validate Payment Method if customer owes money
  if (priceDifference > 0 && !paymentMethod) {
    throw new AppError(
      "Payment method is required when customer owes money.",
      400,
    );
  }

  // 4c. Populate bPrice (Buying Price) for reporting
  // For returned items: Get from original order
  const enrichedReturnedItems = returnedItems.map((rItem) => {
    const original = order.items.find(
      (i) =>
        i.itemId === rItem.itemId &&
        i.variantId === rItem.variantId &&
        i.size === rItem.size,
    );
    return {
      ...rItem,
      bPrice: original?.bPrice || 0,
    };
  });

  // For replacement items: Fetch current product buying price
  const replacementProductIds = Array.from(
    new Set(replacementItems.map((i) => i.itemId)),
  );

  const replacementProductMap: Record<string, any> = {};
  if (replacementProductIds.length > 0) {
    const productSnaps = await adminFirestore
      .collection("products")
      .where(
        admin.firestore.FieldPath.documentId(),
        "in",
        replacementProductIds,
      )
      .get();

    productSnaps.forEach((doc) => {
      replacementProductMap[doc.id] = doc.data();
    });
  }

  const enrichedReplacementItems = replacementItems.map((rItem) => {
    const product = replacementProductMap[rItem.itemId];
    let bPrice = 0;
    if (product) {
      const variant = (product.variants as any[])?.find(
        (v) => v.variantId === rItem.variantId,
      );
      bPrice = variant?.buyingPrice || product.buyingPrice || 0;
    }
    return {
      ...rItem,
      bPrice,
    };
  });

  // 5. Process inventory changes in a transaction
  const exchangeId = `EXC-${nanoid(8).toUpperCase()}`;

  // Pre-resolve inventory IDs to keep the transaction clean and follow "reads before writes"
  const inventoryIdMap: Record<string, string | null> = {};
  const allTargets = [
    ...returnedItems.map((i) => ({
      pid: i.itemId,
      vid: i.variantId,
      size: i.size,
    })),
    ...replacementItems.map((i) => ({
      pid: i.itemId,
      vid: i.variantId,
      size: i.size,
    })),
  ];

  await Promise.all(
    allTargets.map(async (t) => {
      const key = `${t.pid}|${t.vid}|${t.size}`;
      if (!inventoryIdMap[key]) {
        inventoryIdMap[key] = await findExistingInventoryItem(
          t.pid,
          t.vid,
          t.size,
          stockId,
        );
      }
    }),
  );

  await adminFirestore.runTransaction(async (transaction) => {
    // 1️⃣ PHASE: READS
    const uniqueIds = Array.from(
      new Set(Object.values(inventoryIdMap).filter(Boolean)),
    ) as string[];
    const inventoryDocs: Record<string, any> = {};

    if (uniqueIds.length > 0) {
      const refs = uniqueIds.map((id) =>
        adminFirestore.collection("stock_inventory").doc(id),
      );
      const snaps = await transaction.getAll(...refs);
      snaps.forEach((snap) => {
        if (snap.exists) inventoryDocs[snap.id] = snap.data();
      });
    }

    // 2️⃣ PHASE: LOGIC & CALCULATIONS (No more reads allowed after this if we write)
    const inventoryUpdates: {
      ref: admin.firestore.DocumentReference;
      data: any;
      isNew: boolean;
    }[] = [];

    // Track quantity changes during the transaction to handle multiple items affecting same stock
    const tempQuantities: Record<string, number> = {};
    for (const [id, data] of Object.entries(inventoryDocs)) {
      tempQuantities[id] = data.quantity || 0;
    }

    // Process Returns
    for (const item of returnedItems) {
      const key = `${item.itemId}|${item.variantId}|${item.size}`;
      const existingId = inventoryIdMap[key];

      if (existingId) {
        tempQuantities[existingId] =
          (tempQuantities[existingId] || 0) + item.quantity;
        inventoryUpdates.push({
          ref: adminFirestore.collection("stock_inventory").doc(existingId),
          data: {
            quantity: tempQuantities[existingId],
            updatedAt: admin.firestore.Timestamp.now(),
          },
          isNew: false,
        });
      } else {
        const newId = nanoid(10);
        inventoryUpdates.push({
          ref: adminFirestore.collection("stock_inventory").doc(newId),
          data: {
            id: newId,
            productId: item.itemId,
            variantId: item.variantId,
            size: item.size,
            stockId: stockId,
            quantity: item.quantity,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          },
          isNew: true,
        });
      }
    }

    // Process Replacements
    for (const item of replacementItems) {
      const key = `${item.itemId}|${item.variantId}|${item.size}`;
      const existingId = inventoryIdMap[key];

      if (existingId) {
        const currentQty = tempQuantities[existingId] || 0;
        const newQty = currentQty - item.quantity;

        if (newQty < 0) {
          throw new AppError(
            `Insufficient stock for ${item.name} during transaction.`,
            400,
          );
        }

        tempQuantities[existingId] = newQty;
        inventoryUpdates.push({
          ref: adminFirestore.collection("stock_inventory").doc(existingId),
          data: {
            quantity: newQty,
            updatedAt: admin.firestore.Timestamp.now(),
          },
          isNew: false,
        });
      } else {
        // This should theoretically be caught by pre-transaction validation,
        // but as a fallback/integrity check:
        throw new AppError(
          `Inventory record not found for ${item.name} (${item.size})`,
          400,
        );
      }
    }

    // Create exchange record object
    const exchangeRecord: ExchangeRecord = {
      id: exchangeId,
      originalOrderId: order.orderId,
      originalOrderDocId: order.docId,
      stockId,
      returnedItems: enrichedReturnedItems,
      replacementItems: enrichedReplacementItems,
      returnTotal,
      replacementTotal,
      priceDifference,
      paymentMethod: request.paymentMethod,
      status: "completed",
      processedBy: userId,
      processedByName: userName,
      notes,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    };

    // 3️⃣ PHASE: WRITES
    // Apply inventory updates
    // Note: If multiple updates target the same ref, only the last one in the array (most recent calculated) should be applied.
    // We filter for distinct refs to avoid multiple writes to same doc in one transaction.
    const finalUpdates = new Map<string, any>();
    inventoryUpdates.forEach((u) => finalUpdates.set(u.ref.path, u));

    for (const update of finalUpdates.values()) {
      if (update.isNew) {
        transaction.set(update.ref, update.data);
      } else {
        transaction.update(update.ref, update.data);
      }
    }

    // Create exchange record
    transaction.set(
      adminFirestore.collection(EXCHANGES_COLLECTION).doc(exchangeId),
      exchangeRecord,
    );

    // Update original order
    transaction.update(
      adminFirestore.collection(ORDERS_COLLECTION).doc(order.docId),
      {
        exchangeIds: admin.firestore.FieldValue.arrayUnion(exchangeId),
        updatedAt: admin.firestore.Timestamp.now(),
      },
    );
  });

  // 6. Return the created exchange record
  const exchangeDoc = await adminFirestore
    .collection(EXCHANGES_COLLECTION)
    .doc(exchangeId)
    .get();

  // 7. Post-transaction: Update denormalized stock counts (fire and forget or await)
  try {
    const affectedProductIds = new Set<string>();
    returnedItems.forEach((item) => affectedProductIds.add(item.itemId));
    replacementItems.forEach((item) => affectedProductIds.add(item.itemId));

    await Promise.all(
      Array.from(affectedProductIds).map((pid) => updateProductStockCount(pid)),
    );
  } catch (error) {
    console.error(
      "Failed to update product stock counts after exchange:",
      error,
    );
    // Suppress error as the critical transaction succeeded
  }

  return exchangeDoc.data() as ExchangeRecord;
};

// ================================
// 🔹 EXCHANGE HISTORY
// ================================

/**
 * Get exchange record by ID
 */
export const getExchangeById = async (
  exchangeId: string,
): Promise<ExchangeRecord | null> => {
  const doc = await adminFirestore
    .collection(EXCHANGES_COLLECTION)
    .doc(exchangeId)
    .get();

  if (!doc.exists) {
    return null;
  }

  const data = doc.data() as ExchangeRecord;
  return {
    ...data,
    createdAt:
      data.createdAt instanceof admin.firestore.Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt,
    updatedAt:
      data.updatedAt instanceof admin.firestore.Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt,
  };
};

/**
 * Get exchanges by order ID
 */
export const getExchangesByOrderId = async (
  orderId: string,
): Promise<ExchangeRecord[]> => {
  const snapshot = await adminFirestore
    .collection(EXCHANGES_COLLECTION)
    .where("originalOrderId", "==", orderId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as ExchangeRecord;
    return {
      ...data,
      createdAt:
        data.createdAt instanceof admin.firestore.Timestamp
          ? data.createdAt.toDate().toISOString()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof admin.firestore.Timestamp
          ? data.updatedAt.toDate().toISOString()
          : data.updatedAt,
    };
  });
};

/**
 * Get recent exchanges (for listing)
 */
export const getRecentExchanges = async (
  stockId?: string,
  limit: number = 50,
): Promise<ExchangeRecord[]> => {
  let query = adminFirestore
    .collection(EXCHANGES_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (stockId) {
    query = adminFirestore
      .collection(EXCHANGES_COLLECTION)
      .where("stockId", "==", stockId)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as ExchangeRecord;
    return {
      ...data,
      createdAt:
        data.createdAt instanceof admin.firestore.Timestamp
          ? data.createdAt.toDate().toISOString()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof admin.firestore.Timestamp
          ? data.updatedAt.toDate().toISOString()
          : data.updatedAt,
    };
  });
};

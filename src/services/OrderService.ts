import { adminFirestore } from "@/firebase/firebaseAdmin";
import admin from "firebase-admin";
import { Order } from "@/model/Order";
import {
  updateOrAddOrderHash,
  validateDocumentIntegrity,
} from "./IntegrityService";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "@/utils/apiResponse";
import { searchOrders } from "./AlgoliaService";
import { 
  sendOrderStatusUpdateSMS, 
  sendOrderStatusUpdateEmail 
} from "./NotificationService";

import { toSafeLocaleString } from "./UtilService";

const ORDERS_COLLECTION = "orders";

export const getOrders = async (
  page: number = 1,
  size: number = 20,
  startDateStr?: string,
  endDateStr?: string,
  status?: string,
  payment?: string,
  orderId?: string,
  from?: string,
  stockId?: string,
  paymentMethod?: string,
) => {
  try {
    const filters: string[] = [];

    if (startDateStr && endDateStr) {
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      endDate.setHours(23, 59, 59, 999);

      const start = startDate.getTime();
      const end = endDate.getTime();

      filters.push(`createdAt >= ${start} AND createdAt <= ${end}`);
    }
    if (status) filters.push(`status:"${status}"`);
    if (orderId) filters.push(`orderId:"${orderId}"`);
    if (payment) filters.push(`paymentStatus:"${payment}"`);
    if (from) filters.push(`from:"${from}"`);
    if (stockId) filters.push(`stockId:"${stockId}"`);
    if (paymentMethod) filters.push(`paymentMethod:"${paymentMethod}"`);
    // To overcome Algolia's default non-chronological ranking without replica indexes,
    // we fetch a wider net of hits when searching isn't specifically narrowed,
    // and sort them locally to guarantee newest orders are on page 1.
    const fetchAllMode = !orderId && !startDateStr && !endDateStr;
    const { hits, nbHits } = await searchOrders(orderId || "", {
      page: fetchAllMode ? 0 : page - 1,
      hitsPerPage: fetchAllMode ? 1000 : size,
      filters: filters.join(" AND "),
    });

    let sortedHits = hits as any[];
    
    // 1. Sort all raw hits chronologically
    sortedHits.sort((a, b) => {
      const getTime = (dateValue: any) => {
        if (!dateValue) return 0;
        if (typeof dateValue === "number") {
          return dateValue < 10000000000 ? dateValue * 1000 : dateValue;
        }
        if (typeof dateValue === "object") {
          if (dateValue._seconds !== undefined) return dateValue._seconds * 1000;
          if (dateValue.seconds !== undefined) return dateValue.seconds * 1000;
          if (dateValue.toMillis) return dateValue.toMillis();
        }
        return new Date(dateValue).getTime();
      };
      return getTime(b.createdAt) - getTime(a.createdAt);
    });

    // 2. Slice for the current page IF we fetched a wide net
    const pagedHits = fetchAllMode 
      ? sortedHits.slice((page - 1) * size, page * size) 
      : sortedHits;

    // 3. Process integrity checks ONLY for the sliced items (max 20 per request)
    const orders: Order[] = [];
    for (const hit of pagedHits) {
      const integrityResult = await validateDocumentIntegrity(
        ORDERS_COLLECTION,
        hit.objectID || hit.id,
      );

      const order: Order = {
        ...hit,
        userId: hit.userId || null, 
        orderId: hit.objectID || hit.id,
        integrity: integrityResult,
        customer: hit.customer ? { ...hit.customer } : null,
      } as unknown as Order;
      orders.push(order);
    }

    console.log(`Fetched ${sortedHits.length} orders from Algolia, returning page ${page}`);
    return {
      dataList: orders,
      total: fetchAllMode ? Math.min(sortedHits.length, nbHits) : nbHits,
    };
  } catch (error: any) {
    console.error(error);
    throw error;
  }
};

export const getOrder = async (orderId: string): Promise<Order> => {
  try {
    // 1. Changed query to a direct doc.get() for efficiency and consistency
    const doc = await adminFirestore
      .collection(ORDERS_COLLECTION)
      .doc(orderId)
      .get();

    if (!doc.exists) {
      throw new AppError(`Order with ID ${orderId} not found`, 404);
    }

    const data = doc.data() as Order;

    // 2. Passed 'adminFirestore' and used the doc.id for the check
    const integrity = await validateDocumentIntegrity(
      ORDERS_COLLECTION,
      doc.id,
    );

    return {
      ...data,
      orderId: doc.id, // 3. Ensure orderId is the doc ID
      integrity: integrity, // 4. Add integrity result
      customer: data.customer
        ? {
            ...data.customer,
            updatedAt: data.customer.updatedAt
              ? toSafeLocaleString(data.customer.updatedAt)
              : null,
          }
        : null,
      createdAt: toSafeLocaleString(data.createdAt),
      updatedAt: toSafeLocaleString(data.updatedAt),
      restockedAt: data.restockedAt
        ? toSafeLocaleString(data.restockedAt)
        : null,
    };
  } catch (error) {
    console.error("Error fetching order:", error);
    throw error;
  }
};

export const updateOrder = async (order: Order & { sendNotification?: boolean }, orderId: string) => {
  try {
    const orderRef = adminFirestore.collection(ORDERS_COLLECTION).doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists)
      throw new AppError(`Order with ID ${orderId} not found`, 404);

    const existingOrder = orderDoc.data() as Order;

    if (existingOrder.paymentStatus?.toLowerCase() === "refunded") {
      throw new AppError(
        `Order with ID ${orderId} is already refunded can't proceed with update`,
        400,
      );
    }

    // 🧾 Update Firestore order
    const orderUpdate: any = {
      paymentStatus: order.paymentStatus,
      status: order.status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(order.customer && {
        customer: {
          ...order.customer,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
      }),
    };

    if (order.trackingNumber !== undefined) orderUpdate.trackingNumber = order.trackingNumber;
    if (order.courier !== undefined) orderUpdate.courier = order.courier;

    await orderRef.set(orderUpdate, { merge: true });


    // ✅ Fetch the final updated data
    const updatedOrderDoc = await orderRef.get();
    const updatedOrderData = updatedOrderDoc.data();

    if (!updatedOrderData) {
      throw new AppError(
        `Order with ID ${orderId} not found after update`,
        404,
      );
    }

    // 🔒 Update or add hash ledger entry
    await updateOrAddOrderHash(updatedOrderData);

    // 🔔 Unified Customer Notifications
    // Only trigger if status changed, it's a notification-eligible status, AND the user requested it via sendNotification flag.
    const oldStatus = existingOrder.status?.toUpperCase();
    const newStatus = order.status?.toUpperCase();
    const shouldNotify = order.sendNotification === true;

    if (shouldNotify && newStatus && oldStatus !== newStatus) {
      const triggerStatuses = ["PROCESSING", "COMPLETED", "CANCELLED"];
      if (triggerStatuses.includes(newStatus)) {
        console.log(`[Order Service] Triggering consolidated notification for ${orderId} (${newStatus})`);
        
        // Concurrent notification delivery
        Promise.all([
          sendOrderStatusUpdateSMS(orderId, newStatus),
          sendOrderStatusUpdateEmail(orderId, newStatus)
        ]).catch(err => console.error(`[Order Service] Unified notification failure for ${orderId}:`, err));
      }
    }

    console.log(`✅ Order with ID ${orderId} updated and hashed successfully`);
  } catch (error) {
    console.error("❌ Error updating order:", error);
    throw error;
  }
};

export const addOrder = async (order: Partial<Order>) => {
  if (!order.from) throw new AppError("Order source (from) is required", 400);
  const fromSource = order.from.toLowerCase();

  // --- POS DELEGATION ---
  if (fromSource === "store") {
    const { createPOSOrder } = await import("./POSService");
    return await createPOSOrder(order, order.userId || "anonymous");
  }

  // --- WEBSITE DELEGATION (Isolated Route handles this now, but keeping for compatibility) ---
  if (fromSource === "website") {
    const { addWebOrder } = await import("./WebOrderService");
    return await addWebOrder(order);
  }

  // --- ERP / OTHER SOURCES (Original simplified logic) ---
  if (!order.orderId) throw new AppError("Order ID is required", 400);

  const orderRef = adminFirestore.collection("orders").doc(order.orderId);
  const now = admin.firestore.Timestamp.now();
  const orderData: Order = {
    ...order,
    userId: order.userId || null,
    createdAt: now,
    updatedAt: now,
  } as Order;

  try {
    await orderRef.set(orderData);

    // Integrity Update
    const { updateOrAddOrderHash } = await import("./IntegrityService");
    await updateOrAddOrderHash(orderData);

    console.log(`✅ ERP/Other order ${order.orderId} created`);
  } catch (error) {
    console.error("❌ addOrder failed:", error);
    throw error;
  }
};

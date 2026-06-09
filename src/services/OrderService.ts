import { orderRepository } from "@/repositories/OrderRepository";
import { inventoryRepository } from "@/repositories/InventoryRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { FieldValue } from "firebase-admin/firestore";
import { Order } from "@/model/Order";
import {
  updateOrAddOrderHash,
  validateDocumentIntegrity,
  validateManyIntegrity,
} from "./IntegrityService";
import { AppError } from "@/utils/apiResponse";
import { sendOrderStatusUpdateSMS, sendOrderStatusUpdateEmail } from "./NotificationService";
import { toSafeLocaleString, formatListDates, formatEntityDates, parseToDayjs, getNowSL } from "./UtilService";

/**
 * OrderService - Business logic for orders
 * Delegates data access to orderRepository
 */

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
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    if (startDateStr && endDateStr) {
      startDate = parseToDayjs(startDateStr)?.startOf("day").toDate();
      endDate = parseToDayjs(endDateStr)?.endOf("day").toDate();
    }

    const { dataList, total } = await orderRepository.findPaginated({
      page,
      size,
      startDate,
      endDate,
      status,
      paymentStatus: payment,
      orderId,
      from,
      stockId,
      paymentMethod
    });

    // ⚡ Batch validate integrity to avoid N+1 queries
    const integrityMap = await validateManyIntegrity("orders", dataList);

    const ordersWithIntegrity: Order[] = dataList.map((data) => {
      const id = (data as any).id;
      return {
        ...data,
        userId: data.userId || null,
        orderId: id,
        integrity: integrityMap[id] ?? false,
        customer: data.customer ? { ...data.customer } : null,
      } as unknown as Order;
    });

    return { dataList: formatListDates(ordersWithIntegrity), total };
  } catch (error: any) {
    console.error(error);
    throw error;
  }
};

export const getOrder = async (orderId: string): Promise<Order> => {
  const data = await orderRepository.findById(orderId);
  if (!data) throw new AppError(`Order with ID ${orderId} not found`, 404);

  const integrity = await validateDocumentIntegrity("orders", orderId, data);

  return formatEntityDates({
    ...data,
    orderId,
    integrity,
    customer: data.customer ? formatEntityDates(data.customer) : null,
  } as any, ["createdAt", "updatedAt", "restockedAt"]);
};

export const updateOrder = async (order: Order & { sendNotification?: boolean }, orderId: string) => {
  const existingOrder = await orderRepository.findById(orderId);
  if (!existingOrder) throw new AppError(`Order with ID ${orderId} not found`, 404);

  if (existingOrder.paymentStatus?.toLowerCase() === "refunded") {
    throw new AppError(`Order with ID ${orderId} is already refunded can't proceed with update`, 400);
  }

  // Use a transaction to perform all stock adjustments and order updates safely
  await orderRepository.runTransaction(async (tx) => {
    const docRef = orderRepository.getDocRef(orderId);
    const orderDoc = await tx.get(docRef);
    if (!orderDoc.exists) throw new AppError(`Order with ID ${orderId} not found`, 404);
    const currentOrder = orderDoc.data() as Order;

    const stockId = currentOrder.stockId;

    // --- INVENTORY STOCK ADJUSTMENT ---
    if (stockId) {
      // 1. Map current active quantities (0 if order was already Cancelled)
      const oldQtys: Record<string, number> = {};
      const oldStatus = (currentOrder.status || "Pending").toLowerCase();
      if (oldStatus !== "cancelled" && Array.isArray(currentOrder.items)) {
        currentOrder.items.forEach((item) => {
          const key = `${item.itemId}_${item.variantId || ""}_${item.size}`;
          oldQtys[key] = (oldQtys[key] || 0) + item.quantity;
        });
      }

      // 2. Map target active quantities (0 if order is being Cancelled)
      const newQtys: Record<string, number> = {};
      const newStatus = (order.status || "Pending").toLowerCase();
      if (newStatus !== "cancelled" && Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const key = `${item.itemId}_${item.variantId || ""}_${item.size}`;
          newQtys[key] = (newQtys[key] || 0) + item.quantity;
        });
      }

      // 3. Compute net differences and apply stock changes
      const allKeys = new Set([...Object.keys(oldQtys), ...Object.keys(newQtys)]);

      for (const key of allKeys) {
        const [productId, variantId, size] = key.split("_");
        const oldQty = oldQtys[key] || 0;
        const newQty = newQtys[key] || 0;
        const diff = newQty - oldQty;

        if (diff > 0) {
          // Selling more -> deduct stock from inventory, update product totalStock
          await inventoryRepository.deductStock(tx, productId, variantId || null, size, stockId, diff);
          await productRepository.updateTotalStock(tx, productId, diff);
        } else if (diff < 0) {
          // Returning stock -> restore stock to inventory, update product totalStock
          await inventoryRepository.restoreStock(tx, productId, variantId || null, size, stockId, Math.abs(diff));
          await productRepository.updateTotalStock(tx, productId, diff);
        }
      }
    }

    // --- UPDATE ORDER DOCUMENT ---
    const orderUpdate: any = {
      paymentStatus: order.paymentStatus,
      status: order.status,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (order.customer) {
      orderUpdate.customer = {
        ...currentOrder.customer,
        ...order.customer,
        updatedAt: new Date(),
      };
    }

    if (order.trackingNumber !== undefined) orderUpdate.trackingNumber = order.trackingNumber;
    if (order.courier !== undefined) orderUpdate.courier = order.courier;
    if (order.items !== undefined) orderUpdate.items = order.items;
    if (order.total !== undefined) orderUpdate.total = order.total;
    if (order.discount !== undefined) orderUpdate.discount = order.discount;
    if (order.shippingFee !== undefined) orderUpdate.shippingFee = order.shippingFee;
    if (order.paymentReceived !== undefined) orderUpdate.paymentReceived = order.paymentReceived;

    tx.update(docRef, orderUpdate);
  });

  const updatedOrder = await orderRepository.findById(orderId);
  if (!updatedOrder) throw new AppError(`Order with ID ${orderId} not found after update`, 404);

  await updateOrAddOrderHash(updatedOrder);

  // 🔔 Notifications Logic
  const oldStatus = existingOrder.status?.toUpperCase();
  const newStatus = order.status?.toUpperCase();
  if (order.sendNotification === true && newStatus && oldStatus !== newStatus) {
    const triggerStatuses = ["PROCESSING", "COMPLETED", "CANCELLED"];
    if (triggerStatuses.includes(newStatus)) {
      Promise.all([
        sendOrderStatusUpdateSMS(orderId, newStatus),
        sendOrderStatusUpdateEmail(orderId, newStatus)
      ]).catch(err => console.error(`[Order Service] Unified notification failure for ${orderId}:`, err));
    }
  }
};

export const addOrder = async (order: Partial<Order>) => {
  if (!order.from) throw new AppError("Order source (from) is required", 400);
  const fromSource = order.from.toLowerCase();

  if (fromSource === "store") {
    const { createPOSOrder } = await import("./POSService");
    return await createPOSOrder(order, order.userId || "anonymous");
  }

  if (fromSource === "website") {
    const { addWebOrder } = await import("./WebOrderService");
    return await addWebOrder(order);
  }

  if (!order.orderId) throw new AppError("Order ID is required", 400);
  await orderRepository.saveWithRetry(order.orderId, order as Order);
  await updateOrAddOrderHash(order);
};

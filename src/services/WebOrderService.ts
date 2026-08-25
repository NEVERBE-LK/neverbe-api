import { orderRepository } from "@/repositories/OrderRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { inventoryRepository } from "@/repositories/InventoryRepository";
import { promotionRepository } from "@/repositories/PromotionRepository";
import { FieldValue } from "firebase-admin/firestore";
import { settingsRepository } from "@/repositories/SettingsRepository";
import {
  sendOrderConfirmedEmail,
  sendOrderConfirmedSMS,
  isOTPVerifiedRecently,
  consumeOTPVerification,
  createAdminNotification,
} from "./NotificationService";
import { Order } from "@/model/Order";
import { Product } from "@/model/Product";
import { AppError } from "@/utils/apiResponse";
import { formatEntityDates, formatListDates } from "./UtilService";
import {
  validateCoupon,
  trackCouponUsage,
  calculateCartDiscount,
} from "./PromotionService";
import { ShippingRule } from "@/model/ShippingRule";

/**
 * WebOrderService - Business logic for website orders
 * Delegates data access to repositories
 */

export const getOrderByIdForInvoice = async (orderId: string) => {
  const order = await orderRepository.findByOrderId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found.`);
  return formatEntityDates(order);
};

export const updatePayment = async (
  orderId: string,
  paymentId: string,
  status: string,
) => {
  const docId = await orderRepository.findDocIdByOrderId(orderId);
  if (!docId) throw new Error(`Order ${orderId} not found.`);

  const orderData = await orderRepository.updatePaymentStatus(docId, paymentId, status);

  if (status.toLowerCase() === "paid") {
    sendOrderConfirmedSMS(orderId).catch(err => console.error("[Notification] SMS failed:", err));
    sendOrderConfirmedEmail(orderId).catch(err => console.error("[Notification] Email failed:", err));
  }
};

export const addWebOrder = async (order: Partial<Order>) => {
  if (!order.orderId) throw new AppError("Order ID is required", 400);
  if (!order.items?.length) throw new AppError("Order items are required", 400);

  // OTP Check for COD
  const isCOD = order.paymentMethodId === "PM-001";
  const userPhone = order.customer?.phone;
  if (isCOD) {
    if (!userPhone) throw new AppError("Phone number is required for COD", 400);
    const isVerified = await isOTPVerifiedRecently(userPhone);
    if (!isVerified) throw new AppError("Please verify your phone number via OTP", 400);
  }

  // Get online stock ID from settings
  const erpSettings = await settingsRepository.getErpSettings();
  const stockId = erpSettings?.onlineStockId;
  if (!stockId) throw new AppError("Online stock location not configured", 500);

  // Fetch product data in batch (including sensitive data for bPrice)
  const productIds = order.items.map((i) => i.itemId);
  const products = await productRepository.findByIds(productIds, true);
  const productMap = new Map(products.map((p) => [p.id, p]));

  // Business Logic: Enrich items and calculate discounts
  order.items = order.items.map((item) => ({
    ...item,
    bPrice: productMap.get(item.itemId)?.buyingPrice || 0,
  }));

  let finalDiscount = 0;
  let appliedCouponId: string | null = null;
  if (order.couponCode) {
    const cartTotal = order.items.reduce((acc, item) => {
      const prod = productMap.get(item.itemId);
      return acc + ((prod?.sellingPrice || 0) * item.quantity - (item.discount || 0));
    }, 0);

    const validation = await validateCoupon(
      order.couponCode,
      order.customer?.id || "guest",
      cartTotal,
      order.items.map(i => ({
        productId: i.itemId,
        variantId: i.variantId,
        quantity: i.quantity,
        price: productMap.get(i.itemId)?.sellingPrice || 0,
        discount: i.discount,
      })),
    );
    if (!validation.valid) throw new AppError(`Coupon Invalid: ${validation.message}`, 400);
    finalDiscount = validation.discount || 0;
    appliedCouponId = validation.coupon?.id || null;
  }

  // Automatic promotions
  const cartTotal = order.items.reduce((acc, item) => {
    const prod = productMap.get(item.itemId);
    return acc + ((prod?.sellingPrice || 0) * item.quantity - (item.discount || 0));
  }, 0);

  const promoResult = await calculateCartDiscount(
    order.items.map((i) => {
      const prod = productMap.get(i.itemId);
      return {
        productId: i.itemId,
        variantId: i.variantId || "",
        quantity: i.quantity,
        price: prod?.sellingPrice || 0,
        discount: i.discount || 0,
        category: prod?.category,
        brand: prod?.brand,
      };
    }),
    cartTotal,
    order.customer?.id || null,
  );

  let promotionDiscount = promoResult.totalDiscount || 0;
  let appliedPromotionIds = promoResult.promotions?.map(p => p.id) || [];

  // Shipping Logic
  const totalWeight = order.items.reduce((acc, item) => {
    const prod = productMap.get(item.itemId);
    return acc + (((prod?.weight || 1000) / 1000) * item.quantity);
  }, 0);

  let serverShippingFee = 0;
  const shippingRules = await settingsRepository.findActiveShippingRules();
  if (shippingRules.length > 0) {
    const match = shippingRules.find(r => totalWeight >= r.minWeight && totalWeight < r.maxWeight);
    if (match) {
      if (match.isIncremental && match.baseWeight !== undefined && match.perKgRate !== undefined) {
        serverShippingFee = match.rate + Math.ceil(Math.max(0, totalWeight - match.baseWeight)) * match.perKgRate;
      } else {
        serverShippingFee = match.rate;
      }
    }
  }

  if (promoResult.promotions?.some(p => p.type === "FREE_SHIPPING" || p.actions?.[0]?.type === "FREE_SHIPPING")) {
    serverShippingFee = 0;
  }

  // Pre-fetch inventory refs before the transaction to comply with Firestore read-before-write rules
  const invRefs: Record<string, FirebaseFirestore.DocumentReference | null> = {};
  if (order.items) {
    for (const item of order.items) {
      const key = `${item.itemId}_${item.variantId || ""}_${item.size}`;
      invRefs[key] = await inventoryRepository.findBySpecs(item.itemId, item.variantId || null, item.size, stockId);
    }
  }

  // Transaction for stock deduction and order save
  try {
    await orderRepository.runTransaction(async (tx) => {
      if (order.items) {
        for (const item of order.items) {
          const key = `${item.itemId}_${item.variantId || ""}_${item.size}`;
          const invRef = invRefs[key];
          if (!invRef) throw new AppError(`Inventory item not found for ${item.name}`, 404);
          tx.update(invRef, {
            quantity: FieldValue.increment(-item.quantity),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const now = new Date();
      const orderData: Order = {
        ...order,
        from: "Website",
        sourceName: order.sourceName || "Website",
        storeName: order.storeName || "Online Store",
        userId: order.userId || null,
        stockId,
        appliedCouponId,
        appliedPromotionId: appliedPromotionIds[0] || null,
        appliedPromotionIds,
        promotionDiscount,
        discount: finalDiscount,
        createdAt: now as any,
        updatedAt: now as any,
        customer: {
          ...order.customer,
          updatedAt: now as any,
          createdAt: now as any,
        },
      } as Order;

      await orderRepository.create(order.orderId!, orderData, tx);
    });

    // Post-transaction tasks
    if (appliedCouponId) {
      await trackCouponUsage(appliedCouponId, order.customer?.id || "guest", order.orderId!, finalDiscount);
    }
    for (const promoId of appliedPromotionIds) {
      await promotionRepository.incrementUsageCount(promoId);
    }
    if (isCOD && userPhone) await consumeOTPVerification(userPhone);

    // Run notifications asynchronously to avoid blocking the user
    createAdminNotification("ORDER", "New Website Order", `Order #${order.orderId?.toUpperCase()} placed by ${order.customer?.name || "Guest"}.`, { orderId: order.orderId })
      .catch(err => console.error("[Notification] Admin failed:", err));

    if (isCOD) {
      sendOrderConfirmedSMS(order.orderId!).catch(err => console.error("[Notification] COD SMS failed:", err));
      sendOrderConfirmedEmail(order.orderId!).catch(err => console.error("[Notification] COD Email failed:", err));
    }
  } catch (error) {
    console.error("❌ addWebOrder failed:", error);
    throw error;
  }
};

export const getOrdersByUserId = async (userId: string, limit: number = 50) => {
  const orders = await orderRepository.findByUserId(userId, limit);
  return formatListDates(orders);
};

export const markDeliveryFeePaid = async (orderId: string, paymentId: string) => {
  const docId = await orderRepository.findDocIdByOrderId(orderId);
  if (!docId) throw new Error(`Order ${orderId} not found.`);
  await orderRepository.update(docId, { deliveryFeePrepaid: true, deliveryFeeTxnId: paymentId, updatedAt: FieldValue.serverTimestamp() } as any);
  console.log("[WebOrderService] Delivery fee marked as paid for:", orderId);
};

export const getOrderPrepaidStatus = async (orderId: string) => {
  const order = await orderRepository.findByOrderId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found.`);
  return { deliveryFeePrepaid: order.deliveryFeePrepaid || false, riskStatus: order.riskStatus || 'NORMAL', deliveryFeeTxnId: order.deliveryFeeTxnId || null };
};

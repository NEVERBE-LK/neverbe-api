import { adminFirestore } from "@/firebase/firebaseAdmin";
import admin from "firebase-admin";
import { orderRepository } from "@/repositories/OrderRepository";
import {
  sendOrderConfirmedEmail,
  sendOrderConfirmedSMS,
} from "./NotificationService";
import { updateOrAddOrderHash } from "./IntegrityService";
import { Order } from "@/model/Order";
import { Product } from "@/model/Product";
import { AppError } from "@/utils/apiResponse";
import {
  validateCoupon,
  trackCouponUsage,
  calculateCartDiscount,
} from "./PromotionService";
import { ShippingRule } from "@/model/ShippingRule";
import { InventoryItem } from "@/model/InventoryItem";

/**
 * Fetch an order by ID for invoice purposes
 */
export const getOrderByIdForInvoice = async (orderId: string) => {
  const order = await orderRepository.findByOrderId(orderId);
  if (!order) throw new Error(`Order ${orderId} not found.`);
  return order;
};

/**
 * Update payment status and handle post-payment actions
 */
export const updatePayment = async (
  orderId: string,
  paymentId: string,
  status: string,
) => {
  // Find document ID by orderId
  const docId = await orderRepository.findDocIdByOrderId(orderId);
  if (!docId) throw new Error(`Order ${orderId} not found.`);

  // Update payment status
  const orderData = await orderRepository.updatePaymentStatus(
    docId,
    paymentId,
    status,
  );

  // Post-payment actions
  if (status.toLowerCase() === "paid") {
    await sendOrderConfirmedSMS(orderId);
    await sendOrderConfirmedEmail(orderId);
  }

  await updateOrAddOrderHash(orderData);
};

/**
 * Add a new order from the website
 */
export const addWebOrder = async (order: Partial<Order>) => {
  if (!order.orderId) throw new AppError("Order ID is required", 400);
  if (!order.items?.length) throw new AppError("Order items are required", 400);

  const orderRef = adminFirestore.collection("orders").doc(order.orderId);
  const now = admin.firestore.Timestamp.now();

  let finalDiscount = 0;
  let appliedCouponId: string | null = null;
  let promotionDiscount = 0;
  let appliedPromotionId: string | null = null;
  let appliedPromotionIds: string[] = [];

  const orderData: Order = {
    ...order,
    from: "Website", // Force website source
    userId: order.userId || null,
    createdAt: now,
    updatedAt: now,
  } as Order;

  try {
    const productRefs = order.items.map((i) =>
      adminFirestore.collection("products").doc(i.itemId),
    );
    const productSnaps = await adminFirestore.getAll(...productRefs);
    const productMap = new Map(
      productSnaps.map((snap) => [snap.id, snap.data() as Product]),
    );

    // Set bPrice on items from server-side product data
    order.items = order.items.map((item) => {
      const prod = productMap.get(item.itemId);
      return {
        ...item,
        bPrice: prod?.buyingPrice || 0,
      };
    });

    // Validate Coupon if exists
    if (order.couponCode) {
      const cartTotal = order.items.reduce((acc, item) => {
        const prod = productMap.get(item.itemId);
        const price = prod ? prod.sellingPrice : 0;
        const discount = item.discount || 0;
        return acc + (price * item.quantity - discount);
      }, 0);

      const cartItems = order.items.map((i) => ({
        productId: i.itemId,
        variantId: i.variantId,
        quantity: i.quantity,
        price: productMap.get(i.itemId)?.sellingPrice || 0,
        discount: i.discount,
      }));

      const validation = await validateCoupon(
        order.couponCode,
        order.customer?.id || "guest",
        cartTotal,
        cartItems,
      );
      if (!validation.valid) {
        throw new AppError(`Coupon Invalid: ${validation.message}`, 400);
      }

      finalDiscount = validation.discount || 0;
      appliedCouponId = validation.coupon?.id || null;
    }

    // Apply automatic promotions
    const cartTotal = order.items.reduce((acc, item) => {
      const prod = productMap.get(item.itemId);
      const price = prod ? prod.sellingPrice : 0;
      const discount = item.discount || 0;
      return acc + (price * item.quantity - discount);
    }, 0);

    const promoResult = await calculateCartDiscount(
      order.items.map((i) => ({
        productId: i.itemId,
        variantId: i.variantId,
        quantity: i.quantity,
        price: productMap.get(i.itemId)?.sellingPrice || 0,
        discount: i.discount,
      })),
      cartTotal,
      order.customer?.id || null,
    );

    if (promoResult.promotions && promoResult.promotions.length > 0) {
      promotionDiscount = promoResult.totalDiscount;
      appliedPromotionId = promoResult.promotions[0].id;
      appliedPromotionIds = promoResult.promotions.map((p) => p.id);
    }

    // --- SERVER-SIDE TOTAL VALIDATION ---
    const SHIPPING_FLAT_RATE_1 = 380;
    const SHIPPING_FLAT_RATE_2 = 500;
    const TOLERANCE = 1;

    const itemsTotal = order.items.reduce((acc, item) => {
      const prod = productMap.get(item.itemId);
      const price = prod ? prod.sellingPrice : 0;
      return acc + price * item.quantity;
    }, 0);

    const itemDiscounts = order.items.reduce(
      (acc, item) => acc + (item.discount || 0),
      0,
    );

    // Combo validation
    const comboItems = order.items.filter(
      (item) => item.itemType === "combo" && item.comboId,
    );
    if (comboItems.length > 0) {
      const comboGroups = new Map<string, typeof comboItems>();
      for (const item of comboItems) {
        const group = comboGroups.get(item.comboId!) || [];
        group.push(item);
        comboGroups.set(item.comboId!, group);
      }

      for (const [comboId, items] of Array.from(comboGroups)) {
        const comboDoc = await adminFirestore
          .collection("combo_products")
          .doc(comboId)
          .get();
        if (comboDoc.exists) {
          const comboData = comboDoc.data();
          if (comboData) {
            const expectedTotalDiscount =
              (comboData.originalPrice || 0) - (comboData.comboPrice || 0);
            const claimedTotalDiscount = items.reduce(
              (acc, item) => acc + (item.discount || 0),
              0,
            );
            if (Math.abs(claimedTotalDiscount - expectedTotalDiscount) > 2) {
              throw new AppError(
                `Invalid combo discount detected. Please refresh and try again.`,
                400,
              );
            }
          }
        }
      }
    }

    // Shipping calculation
    const totalItems = order.items.reduce(
      (acc, item) => acc + item.quantity,
      0,
    );
    let totalWeight = 0;
    for (const item of order.items) {
      const prod = productMap.get(item.itemId);
      totalWeight += ((prod?.weight || 1000) / 1000) * item.quantity;
    }

    let serverShippingFee = 0;
    const rulesSnapshot = await adminFirestore
      .collection("shipping_rules")
      .where("isActive", "==", true)
      .get();

    if (!rulesSnapshot.empty) {
      const rules = rulesSnapshot.docs.map((doc) => doc.data() as ShippingRule);
      const match = rules.find(
        (r) => totalWeight >= r.minWeight && totalWeight < r.maxWeight,
      );
      if (match) {
        if (
          match.isIncremental &&
          match.baseWeight !== undefined &&
          match.perKgRate !== undefined
        ) {
          const extraWeight = Math.max(0, totalWeight - match.baseWeight);
          serverShippingFee =
            match.rate + Math.ceil(extraWeight) * match.perKgRate;
        } else {
          serverShippingFee = match.rate;
        }
      } else {
        rules.sort((a, b) => b.maxWeight - a.maxWeight);
        if (totalWeight >= rules[0].maxWeight) {
          const maxRule = rules[0];
          if (
            maxRule.isIncremental &&
            maxRule.baseWeight !== undefined &&
            maxRule.perKgRate !== undefined
          ) {
            const extraWeight = Math.max(0, totalWeight - maxRule.baseWeight);
            serverShippingFee =
              maxRule.rate + Math.ceil(extraWeight) * maxRule.perKgRate;
          } else {
            serverShippingFee = maxRule.rate;
          }
        } else {
          serverShippingFee =
            totalItems <= 1 ? SHIPPING_FLAT_RATE_1 : SHIPPING_FLAT_RATE_2;
        }
      }
    } else {
      serverShippingFee =
        totalItems === 0
          ? 0
          : totalItems === 1
            ? SHIPPING_FLAT_RATE_1
            : SHIPPING_FLAT_RATE_2;
    }

    const subtotalBeforeFees = itemsTotal - itemDiscounts;
    const serverPaymentFee = parseFloat(
      (
        (subtotalBeforeFees *
          (order.fee ? (order.fee / subtotalBeforeFees) * 100 : 0)) /
        100
      ).toFixed(2),
    );

    const serverSubtotal =
      itemsTotal - itemDiscounts + serverShippingFee + serverPaymentFee;
    const serverTotalWithPromo =
      serverSubtotal - finalDiscount - promotionDiscount;
    const serverTotalWithoutPromo = serverSubtotal - finalDiscount;

    const frontendTotal = order.total || 0;
    let serverTotal = serverTotalWithPromo;
    if (Math.abs(serverTotalWithoutPromo - frontendTotal) <= TOLERANCE) {
      serverTotal = serverTotalWithoutPromo;
    }

    if (Math.abs(serverTotal - frontendTotal) > TOLERANCE) {
      throw new AppError(
        `Order total mismatch. Expected Rs. ${serverTotal.toFixed(
          2,
        )}, received Rs. ${frontendTotal.toFixed(
          2,
        )}. Please refresh and try again.`,
        400,
      );
    }

    orderData.appliedCouponId = appliedCouponId;
    orderData.appliedPromotionId = appliedPromotionId;
    orderData.appliedPromotionIds = appliedPromotionIds;

    // --- TRANSACTION ---
    let success = false;
    const settingsSnap = await adminFirestore
      .collection("app_settings")
      .doc("erp_settings")
      .get();
    const stockId = settingsSnap.data()?.onlineStockId;
    if (!settingsSnap.exists || !stockId)
      throw new AppError("ERP settings or onlineStockId missing", 500);

    orderData.stockId = stockId;

    for (let attempt = 1; attempt <= 3 && !success; attempt++) {
      try {
        await adminFirestore.runTransaction(async (tx) => {
          const inventoryUpdates = [];
          for (const item of order.items!) {
            const invQuery = adminFirestore
              .collection("stock_inventory")
              .where("productId", "==", item.itemId)
              .where("variantId", "==", item.variantId)
              .where("size", "==", item.size)
              .where("stockId", "==", stockId)
              .limit(1);

            const invSnap = await tx.get(invQuery);
            if (invSnap.empty)
              throw new AppError(`Inventory not found for ${item.name}`, 404);
            inventoryUpdates.push({
              invDoc: invSnap.docs[0],
              invData: invSnap.docs[0].data() as InventoryItem,
              item,
            });
          }

          for (const { invDoc, invData, item } of inventoryUpdates) {
            const prodData = productMap.get(item.itemId);
            if (!prodData)
              throw new AppError(`Product not found: ${item.itemId}`, 404);
            const newInvQty = (invData.quantity ?? 0) - item.quantity;
            const newTotalStock = (prodData.totalStock ?? 0) - item.quantity;
            if (newInvQty < 0 || newTotalStock < 0)
              throw new AppError(`Insufficient stock for ${item.name}`, 400);

            tx.update(invDoc.ref, { quantity: newInvQty });
            tx.update(adminFirestore.collection("products").doc(item.itemId), {
              totalStock: newTotalStock,
              inStock: newTotalStock > 0,
              updatedAt: now,
            });
          }

          tx.set(orderRef, {
            ...orderData,
            customer: {
              ...order.customer,
              updatedAt: now,
              createdAt: now,
            },
          });
        });

        if (appliedCouponId) {
          await trackCouponUsage(
            appliedCouponId,
            order.customer?.id || "guest",
            order.orderId!,
            finalDiscount,
          );
        }
        success = true;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, attempt * 200));
      }
    }

    const orderForHashSnap = await orderRef.get();
    const orderForHash = orderForHashSnap.data();
    if (orderForHash) await updateOrAddOrderHash(orderForHash);
  } catch (error) {
    console.error("❌ addWebOrder failed:", error);
    throw error;
  }
};

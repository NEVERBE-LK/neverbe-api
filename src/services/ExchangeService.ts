import { orderRepository } from "@/repositories/OrderRepository";
import { exchangeRepository } from "@/repositories/ExchangeRepository";
import { inventoryRepository } from "@/repositories/InventoryRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { FieldValue } from "firebase-admin/firestore";
import { ExchangeRecord, ExchangeRequest } from "@/model/ExchangeRecord";
import { Order } from "@/model/Order";
import { AppError } from "@/utils/apiResponse";
import { nanoid } from "nanoid";
import { updateOrAddOrderHash } from "./IntegrityService";
import { formatEntityDates, formatListDates, getNowSL, parseToDayjs } from "./UtilService";
import dayjs from "../utils/dayjs";

const EXCHANGE_WINDOW_DAYS = 14;

/**
 * ExchangeService - Business logic for product exchanges
 * Delegates data access to repositories
 */

export const calculateWorkingDays = (fromDate: any, toDate: any): number => {
  let count = 0;
  let current = parseToDayjs(fromDate)?.startOf("day");
  const end = parseToDayjs(toDate)?.endOf("day");

  if (!current || !end) return 0;

  while (current.isBefore(end) || current.isSame(end, "day")) {
    const dayOfWeek = current.day();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
    current = current.add(1, "day");
  }
  return count;
};

export const getOrderForExchange = async (orderId: string, stockId?: string) => {
  const result = await orderRepository.findStoreOrderByOrderId(orderId, stockId);
  if (!result) return { eligible: false, message: `Order ${orderId} not found or not a POS order` };

  const orderData = result.data;
  const workingDaysElapsed = calculateWorkingDays(orderData.createdAt, getNowSL());
  const eligible = workingDaysElapsed <= EXCHANGE_WINDOW_DAYS;

  if (!eligible) return { eligible: false, workingDaysElapsed, message: `Order is ${workingDaysElapsed} working days old.` };
  if (orderData.status === "CANCELLED" || orderData.status === "REFUNDED") return { eligible: false, message: `Order is ${orderData.status}` };

  return {
    eligible: true,
    order: formatEntityDates({ ...orderData, docId: result.docId }) as Order & { docId: string },
    workingDaysElapsed,
  };
};

export const processExchange = async (request: ExchangeRequest, userId: string, userName?: string): Promise<ExchangeRecord> => {
  const { originalOrderId, stockId, returnedItems, replacementItems, notes, paymentMethod } = request;

  const eligibility = await getOrderForExchange(originalOrderId, stockId);
  if (!eligibility.eligible || !eligibility.order) throw new AppError(eligibility.message || "Not eligible", 400);

  const order = eligibility.order;
  const existingExchanges = await exchangeRepository.findByOrderId(order.orderId);
  
  // Validation: Check return quantities against original and previous exchanges
  const returnedMap: Record<string, number> = {};
  existingExchanges.forEach(ex => ex.returnedItems.forEach(i => {
    const key = `${i.itemId}-${i.variantId}-${i.size}`;
    returnedMap[key] = (returnedMap[key] || 0) + i.quantity;
  }));

  for (const ret of returnedItems) {
    const orig = order.items.find(i => i.itemId === ret.itemId && i.variantId === ret.variantId && i.size === ret.size);
    if (!orig) throw new AppError(`Item ${ret.name} not in order`, 400);
    const key = `${ret.itemId}-${ret.variantId}-${ret.size}`;
    if (ret.quantity + (returnedMap[key] || 0) > orig.quantity) throw new AppError(`Quantity exceeds original`, 400);
    ret.discount = (orig.discount || 0) / orig.quantity * ret.quantity;
    (ret as any).bPrice = orig.bPrice || 0;
  }

  // Fetch replacement product data for bPrice
  const pIds = Array.from(new Set(replacementItems.map(i => i.itemId)));
  const products = await productRepository.findByIds(pIds, true);
  const productMap = new Map(products.map(p => [p.id, p]));

  replacementItems.forEach(rep => {
    const p = productMap.get(rep.itemId);
    (rep as any).bPrice = p?.buyingPrice || 0;
  });

  const returnTotal = returnedItems.reduce((s, i) => s + (i.price * i.quantity - (i.discount || 0)), 0);
  const replacementTotal = replacementItems.reduce((s, i) => s + (i.price * i.quantity - (i.discount || 0)), 0);
  const priceDifference = replacementTotal - returnTotal;

  if (priceDifference < 0) throw new AppError("Refunds not allowed in exchange", 400);
  if (priceDifference > 0 && !paymentMethod) throw new AppError("Payment method required for balance", 400);

  // Pre-fetch all specs/inventory doc references OUTSIDE/BEFORE the transaction to comply with Firestore read-before-write rules
  const retRefs: Record<string, FirebaseFirestore.DocumentReference | null> = {};
  const repRefs: Record<string, FirebaseFirestore.DocumentReference | null> = {};

  for (const ret of returnedItems) {
    const key = `${ret.itemId}_${ret.variantId || ""}_${ret.size}`;
    retRefs[key] = await inventoryRepository.findBySpecs(ret.itemId, ret.variantId || null, ret.size, stockId);
  }

  for (const rep of replacementItems) {
    const key = `${rep.itemId}_${rep.variantId || ""}_${rep.size}`;
    repRefs[key] = await inventoryRepository.findBySpecs(rep.itemId, rep.variantId || null, rep.size, stockId);
  }

  const exchangeId = `EXC-${nanoid(8).toUpperCase()}`;

  await exchangeRepository.runTransaction(async (tx) => {
    // 1. Update Inventory
    for (const ret of returnedItems) {
      const key = `${ret.itemId}_${ret.variantId || ""}_${ret.size}`;
      const invRef = retRefs[key];
      if (invRef) {
        tx.update(invRef, {
          quantity: FieldValue.increment(ret.quantity),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        const newRef = inventoryRepository.getDocRef();
        tx.set(newRef, {
          productId: ret.itemId,
          variantId: ret.variantId || null,
          size: ret.size,
          stockId,
          quantity: ret.quantity,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    for (const rep of replacementItems) {
      const key = `${rep.itemId}_${rep.variantId || ""}_${rep.size}`;
      const invRef = repRefs[key];
      if (!invRef) throw new AppError(`Inventory item not found for replacement item ${rep.name}`, 404);
      tx.update(invRef, {
        quantity: FieldValue.increment(-rep.quantity),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 2. Update Order Items
    const newItems = [...order.items];
    returnedItems.forEach(ret => {
      const idx = newItems.findIndex(i => i.itemId === ret.itemId && i.variantId === ret.variantId && i.size === ret.size);
      if (idx !== -1) {
        newItems[idx].quantity -= ret.quantity;
        if (newItems[idx].quantity <= 0) newItems.splice(idx, 1);
      }
    });
    replacementItems.forEach(rep => {
      const idx = newItems.findIndex(i => i.itemId === rep.itemId && i.variantId === rep.variantId && i.size === rep.size);
      if (idx !== -1) newItems[idx].quantity += rep.quantity;
      else newItems.push({ ...rep, itemType: "PRODUCT" } as any);
    });

    // 3. Save Records
    const exchangeRecord: ExchangeRecord = {
      id: exchangeId,
      originalOrderId: order.orderId,
      originalOrderDocId: order.docId,
      stockId,
      returnedItems,
      replacementItems,
      returnTotal,
      replacementTotal,
      priceDifference,
      paymentMethod,
      status: "completed",
      processedBy: userId,
      processedByName: userName,
      notes,
    } as any;

    await exchangeRepository.create(exchangeId, exchangeRecord, tx);
    await orderRepository.update(order.docId, {
      items: newItems,
      total: (order.total || 0) + priceDifference,
    }, tx);
    await orderRepository.arrayUnionExchangeId(order.docId, exchangeId, tx);
  });

  const updatedOrder = await orderRepository.findById(order.docId);
  if (updatedOrder) await updateOrAddOrderHash(updatedOrder);

  const record = await exchangeRepository.findById(exchangeId);
  return formatEntityDates(record as any);
};

export const getExchangeById = async (id: string) => formatEntityDates((await exchangeRepository.findById(id)) as any);
export const getExchangesByOrderId = async (id: string) => formatListDates((await exchangeRepository.findByOrderId(id)) as any);
export const getRecentExchanges = async (stockId?: string, limit: number = 50) => formatListDates((await exchangeRepository.findRecent({ stockId, limit })) as any);

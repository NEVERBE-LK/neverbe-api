import { Product } from "@/model/Product";
import { Order } from "@/model/Order";
import { AppError } from "@/utils/apiResponse";
import { nanoid } from "nanoid";
import { inventoryRepository } from "@/repositories/InventoryRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { orderRepository } from "@/repositories/OrderRepository";
import { posCartRepository } from "@/repositories/PosCartRepository";
import { pettyCashRepository, stockRepository } from "@/repositories/FinanceRepositories";
import { settingsRepository } from "@/repositories/SettingsRepository";
import { formatEntityDates, formatListDates } from "./UtilService";
import dayjs, { SL_TZ } from "@/utils/dayjs";

// ================================
// 🔹 DATA TYPES
// ================================

export interface POSCartItem {
  itemId: string;
  variantId: string;
  name: string;
  variantName: string;
  thumbnail: string;
  size: string;
  discount: number;
  type: string;
  quantity: number;
  price: number;
  bPrice: number;
  stockId: string;
  createdAt?: FirebaseFirestore.Timestamp;
}

export interface InventoryItem {
  productId: string;
  variantId: string;
  size: string;
  stockId: string;
  quantity: number;
}

export interface StockInventoryItem {
  productId: string;
  variantId: string;
  size: string;
  stockId: string;
  quantity: number;
}

// ================================
// 🔹 POS CART OPERATIONS
// ================================

export const getPosCart = async (stockId: string, userId: string): Promise<POSCartItem[]> => {
  return await posCartRepository.findByStockAndUser(stockId, userId);
};

export const addItemToPosCart = async (item: POSCartItem, userId: string) => {
  await posCartRepository.runTransaction(async (tx) => {
    // 1️⃣ Deduct stock using repository
    await inventoryRepository.deductStock(
      tx,
      item.itemId,
      item.variantId,
      item.size,
      item.stockId,
      item.quantity
    );

    // 2️⃣ Add to POS cart using repository
    await posCartRepository.addItem(tx, item, userId);
  });
};

export const removeFromPosCart = async (item: POSCartItem, userId: string) => {
  await posCartRepository.runTransaction(async (tx) => {
    // 1️⃣ Fetch cart item
    const cartDoc = await posCartRepository.findSpecificItem(tx, {
      itemId: item.itemId,
      variantId: item.variantId,
      size: item.size,
      stockId: item.stockId,
      userId: userId
    });

    if (!cartDoc) throw new AppError("Cart item not found", 404);

    const cartItemData = cartDoc.data() as POSCartItem;

    // 2️⃣ Restore stock using repository
    await inventoryRepository.restoreStock(
      tx,
      item.itemId,
      item.variantId,
      item.size,
      item.stockId,
      cartItemData.quantity
    );

    // 3️⃣ Delete item from POS cart
    await posCartRepository.delete(cartDoc.id, tx);
  });
};

export const clearPosCart = async (stockId: string, userId: string, restock: boolean = true) => {
  try {
    const snap = await posCartRepository.findForClearing(stockId, userId);
    if (snap.empty) return;

    await posCartRepository.runBatch(async (batch) => {
      if (restock) {
        for (const doc of snap.docs) {
          const item = doc.data() as POSCartItem;
          await inventoryRepository.restoreStock(
            batch,
            item.itemId,
            item.variantId,
            item.size,
            item.stockId,
            item.quantity
          );
        }
      }
      for (const doc of snap.docs) {
        await posCartRepository.delete(doc.id, batch);
      }
    });
  } catch (error) {
    console.error("clearPosCart failed:", error);
    throw error;
  }
};

export const updatePosCartItemQuantity = async (item: POSCartItem, newQuantity: number) => {
  await posCartRepository.runTransaction(async (tx) => {
    // 1️⃣ Find the cart item
    const cartDoc = await posCartRepository.findSpecificItem(tx, {
      itemId: item.itemId,
      variantId: item.variantId,
      size: item.size,
      stockId: item.stockId,
      userId: (item as any).userId // userId should be in the item or passed
    });

    if (!cartDoc) throw new AppError("Cart item not found", 404);

    const currentItem = cartDoc.data() as POSCartItem;
    const quantityDiff = newQuantity - currentItem.quantity;

    // 2️⃣ Update inventory
    await inventoryRepository.deductStock(
      tx,
      item.itemId,
      item.variantId,
      item.size,
      item.stockId,
      quantityDiff
    );

    // 3️⃣ Update product global stock using repository
    await productRepository.updateTotalStock(tx, item.itemId, quantityDiff);

    // 4️⃣ Update cart item quantity
    await posCartRepository.update(cartDoc.id, { quantity: newQuantity }, tx);
  });
};

// ================================
// 🔹 POS PRODUCT OPERATIONS
// ================================

export const getProductsByStock = async (stockId: string, page: number = 1, size: number = 20): Promise<Product[]> => {
  if (!stockId) return [];
  const productIds = await inventoryRepository.findProductIdsByStock(stockId);
  if (productIds.length === 0) return [];
  return await productRepository.findByIds(productIds.slice((page - 1) * size, page * size));
};

export const searchProductsByStock = async (stockId: string, query: string): Promise<Product[]> => {
  if (!stockId || !query) return [];
  const productIds = await inventoryRepository.findProductIdsByStock(stockId);
  if (productIds.length === 0) return [];

  // Search filtered products (Business Logic stays in Service)
  const products = await productRepository.searchActive(query, 1000);
  return products.filter((p) => productIds.includes(p.id));
};

export const getStockInventory = async (stockId: string, productId: string, variantId: string, size: string): Promise<InventoryItem | null> => {
  const item = await inventoryRepository.findItem(stockId, productId, variantId, size);
  if (!item) throw new AppError("Inventory item not found", 404);
  return item;
};

export const getProductInventoryByStock = async (stockId: string, productId: string): Promise<InventoryItem[]> => {
  return await inventoryRepository.findByProductAndStock(productId, stockId);
};

export const getAvailableStocks = async () => {
  return await stockRepository.findActiveStocks();
};

// ================================
// 🔹 POS ORDER OPERATIONS
// ================================

export const createPOSOrder = async (order: Partial<Order>, userId: string) => {
  if (!order.orderId) throw new AppError("Order ID is required", 400);
  if (!order.items?.length) throw new AppError("Order items are required", 400);
  if (!order.stockId) throw new AppError("Stock ID is required", 400);

  // Fetch store name if not provided
  let storeName = order.storeName;
  if (!storeName && order.stockId) {
    const stockData = await stockRepository.findById(order.stockId);
    if (stockData) {
      storeName = stockData.name || stockData.label || order.stockId;
    }
  }

  const orderData: Order = {
    ...order,
    from: "Store",
    sourceName: "POS",
    storeName: storeName || "Physical Store",
    userId: userId || order.userId || null,
  } as Order;

  try {
    const productIds = order.items.map((i) => i.itemId);
    const products = await productRepository.findByIds(productIds, true);
    const productMap = new Map(products.map((p) => [p.id, p]));

    order.items = order.items.map((item) => ({
      ...item,
      bPrice: productMap.get(item.itemId)?.buyingPrice || 0,
    }));

    await orderRepository.saveWithRetry(order.orderId, orderData);
    await clearPosCart(order.stockId, userId, false);

    // Integrity Update
    const { updateOrAddOrderHash } = await import("./IntegrityService");
    const savedOrder = await orderRepository.findById(order.orderId);
    if (savedOrder) await updateOrAddOrderHash(savedOrder);

    return formatEntityDates(orderData);
  } catch (error) {
    console.error("Error creating POS order:", error);
    throw error;
  }
};

// ================================
// 🔹 PETTY CASH OPERATIONS
// ================================

export const getPettyCash = async (limit: number = 10) => {
  return await pettyCashRepository.findRecent(limit);
};

export const addPettyCashTransaction = async (data: any) => {
  const pcId = `pc-${nanoid(8)}`;
  return await pettyCashRepository.create(pcId, data);
};

// ================================
// 🔹 PAYMENT METHOD OPERATIONS
// ================================

export const getPaymentMethods = async () => {
  return await settingsRepository.findPaymentMethodsForStore();
};

export const getOrderByOrderId = async (orderId: string) => {
  const order = await orderRepository.findByOrderId(orderId);
  if (!order) throw new AppError(`Order with Order ID ${orderId} not found`, 404);
  return formatEntityDates(order);
};

export const getTodayPOSOrdersCount = async (stockId: string): Promise<number> => {
  if (!stockId) throw new AppError("Stock ID is required", 400);
  const startOfToday = dayjs().tz(SL_TZ).startOf("day").toDate();
  const snapshot = await orderRepository.collection
    .where("stockId", "==", stockId)
    .where("createdAt", ">=", startOfToday)
    .count()
    .get();
  return snapshot.data().count;
};


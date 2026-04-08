import { adminFirestore } from "@/firebase/firebaseAdmin";
import admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { Product } from "@/model/Product";
import { Order } from "@/model/Order";
import { AppError } from "@/utils/apiResponse";
import { searchProducts } from "./AlgoliaService";
import { nanoid } from "nanoid";

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

// ✅ Get all items in POS cart
// ✅ Get all items in POS cart (scoped to user mandatory)
export const getPosCart = async (
  stockId: string,
  userId: string,
): Promise<POSCartItem[]> => {
  let query = adminFirestore
    .collection("pos_cart")
    .orderBy("createdAt", "desc");

  if (stockId) {
    query = query.where("stockId", "==", stockId);
  }
  if (userId) {
    query = query.where("userId", "==", userId);
  }

  const snap = await query.get();
  return snap.docs.map((d) => d.data() as POSCartItem);
};

// ✅ Add item to POS cart using InventoryItem info
export const addItemToPosCart = async (item: POSCartItem, userId: string) => {
  const posCart = adminFirestore.collection("pos_cart");

  await adminFirestore.runTransaction(async (tx) => {
    // 1️⃣ Fetch inventory item using productId, variantId, size, stockId
    const inventoryQuery = await adminFirestore
      .collection("stock_inventory")
      .where("productId", "==", item.itemId)
      .where("variantId", "==", item.variantId)
      .where("size", "==", item.size)
      .where("stockId", "==", item.stockId)
      .limit(1)
      .get();

    if (inventoryQuery.empty)
      throw new AppError("Item not found in inventory", 404);

    const inventoryRef = inventoryQuery.docs[0].ref;
    const inventoryData = inventoryQuery.docs[0].data() as InventoryItem;

    // 2️⃣ Check if requested quantity is bigger than available
    if (item.quantity > inventoryData.quantity) {
      console.warn(
        `Warning: Requested quantity (${item.quantity}) is greater than available stock (${inventoryData.quantity}) for productId: ${item.itemId}, size: ${item.size}, stockId: ${item.stockId}`,
      );
    }

    // 3️⃣ Deduct stock (dont go minus)
    const newInvQty = inventoryData.quantity - item.quantity;
    tx.update(inventoryRef, { quantity: newInvQty });

    // 4️⃣ Update product global stock
    const productRef = adminFirestore.collection("products").doc(item.itemId);
    const productSnap = await tx.get(productRef);
    if (productSnap.exists) {
      const prodData = productSnap.data() as Product;
      const newTotalStock = (prodData.totalStock ?? 0) - item.quantity;
      tx.update(productRef, {
        totalStock: newTotalStock,
        inStock: newTotalStock > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 5️⃣ Add to POS cart
    tx.set(posCart.doc(), {
      ...item,
      userId: userId || "anonymous",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
};

// ✅ Remove item from POS cart and restock
export const removeFromPosCart = async (item: POSCartItem, userId: string) => {
  const posCart = adminFirestore.collection("pos_cart");

  await adminFirestore.runTransaction(async (tx) => {
    // 1️⃣ Fetch inventory item
    const inventoryQuery = await adminFirestore
      .collection("stock_inventory")
      .where("productId", "==", item.itemId)
      .where("variantId", "==", item.variantId)
      .where("size", "==", item.size)
      .where("stockId", "==", item.stockId)
      .limit(1)
      .get();

    if (inventoryQuery.empty)
      throw new AppError("Item not found in inventory", 404);

    const inventoryRef = inventoryQuery.docs[0].ref;
    const inventoryData = inventoryQuery.docs[0].data() as InventoryItem;

    // 2️⃣ Restore stock
    const newInvQty = inventoryData.quantity + item.quantity;
    tx.update(inventoryRef, { quantity: newInvQty });

    // 2.1️⃣ Restore product global stock
    const productRef = adminFirestore.collection("products").doc(item.itemId);
    const productSnap = await tx.get(productRef);
    if (productSnap.exists) {
      const prodData = productSnap.data() as Product;
      const newTotalStock = (prodData.totalStock ?? 0) + item.quantity;
      tx.update(productRef, {
        totalStock: newTotalStock,
        inStock: newTotalStock > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 3️⃣ Delete item from POS cart
    let cartQuery = posCart
      .where("itemId", "==", item.itemId)
      .where("variantId", "==", item.variantId)
      .where("size", "==", item.size)
      .where("stockId", "==", item.stockId);

    if (userId) {
      cartQuery = cartQuery.where("userId", "==", userId);
    }

    const cartSnapshot = await cartQuery.limit(1).get();

    if (!cartSnapshot.empty) {
      tx.delete(cartSnapshot.docs[0].ref);
    }
  });
};

// ✅ Clear entire POS cart (scoped to user/stock mandatory)
export const clearPosCart = async (
  stockId: string,
  userId: string,
  restock: boolean = true,
) => {
  try {
    let query: admin.firestore.Query = adminFirestore.collection("pos_cart").limit(500);

    if (stockId) query = query.where("stockId", "==", stockId);
    if (userId) query = query.where("userId", "==", userId);

    const snap = await query.get();
    if (snap.empty) return;

    const batch = adminFirestore.batch();
    const items = snap.docs.map((d) => d.data() as POSCartItem);

    if (restock) {
      // Group items by product for more efficient product updates
      const productUpdates = new Map<string, number>();

      await Promise.all(
        items.map(async (item) => {
          // 1️⃣ Find inventory item
          const invQuery = await adminFirestore
            .collection("stock_inventory")
            .where("productId", "==", item.itemId)
            .where("variantId", "==", item.variantId)
            .where("size", "==", item.size)
            .where("stockId", "==", item.stockId)
            .limit(1)
            .get();

          if (!invQuery.empty) {
            const invRef = invQuery.docs[0].ref;
            const invData = invQuery.docs[0].data();
            batch.update(invRef, {
              quantity: (invData.quantity || 0) + item.quantity,
            });
          }

          // Accumulate quantity to restore to global product stock
          const currentTotal = productUpdates.get(item.itemId) || 0;
          productUpdates.set(item.itemId, currentTotal + item.quantity);
        }),
      );

      // 2️⃣ Update global product stocks
      for (const [productId, quantity] of productUpdates.entries()) {
        const productRef = adminFirestore.collection("products").doc(productId);
        batch.update(productRef, {
          totalStock: FieldValue.increment(quantity),
          inStock: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // 3️⃣ Delete from cart
    snap.docs.forEach((doc) => batch.delete(doc.ref));

    await batch.commit();
    console.log(
      `POS cart cleared ${restock ? "and stock restored" : "(order complete)"} for user:`,
      userId,
    );
  } catch (error) {
    console.error("clearPosCart failed:", error);
    throw error;
  }
};

// ✅ Update cart item quantity
export const updatePosCartItemQuantity = async (
  item: POSCartItem,
  newQuantity: number,
) => {
  const posCart = adminFirestore.collection("pos_cart");

  await adminFirestore.runTransaction(async (tx) => {
    // 1️⃣ Find the cart item
    const cartQuery = await posCart
      .where("itemId", "==", item.itemId)
      .where("variantId", "==", item.variantId)
      .where("size", "==", item.size)
      .where("stockId", "==", item.stockId)
      .limit(1)
      .get();

    if (cartQuery.empty) throw new AppError("Cart item not found", 404);

    const cartDoc = cartQuery.docs[0];
    const currentItem = cartDoc.data() as POSCartItem;
    const quantityDiff = newQuantity - currentItem.quantity;

    // 2️⃣ Fetch inventory item
    const inventoryQuery = await adminFirestore
      .collection("stock_inventory")
      .where("productId", "==", item.itemId)
      .where("variantId", "==", item.variantId)
      .where("size", "==", item.size)
      .where("stockId", "==", item.stockId)
      .limit(1)
      .get();

    if (inventoryQuery.empty)
      throw new AppError("Item not found in inventory", 404);

    const inventoryRef = inventoryQuery.docs[0].ref;
    const inventoryData = inventoryQuery.docs[0].data() as InventoryItem;

    // 3️⃣ Update inventory (deduct if increasing, restore if decreasing, dont go minus)
    const newInvQty = inventoryData.quantity - quantityDiff;
    tx.update(inventoryRef, { quantity: newInvQty });

    // 3.1️⃣ Update product global stock
    const productRef = adminFirestore.collection("products").doc(item.itemId);
    const productSnap = await tx.get(productRef);
    if (productSnap.exists) {
      const prodData = productSnap.data() as Product;
      const newTotalStock = (prodData.totalStock ?? 0) - quantityDiff;
      tx.update(productRef, {
        totalStock: newTotalStock,
        inStock: newTotalStock > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 4️⃣ Update cart item quantity
    tx.update(cartDoc.ref, { quantity: newQuantity });
  });
};

// ================================
// 🔹 POS PRODUCT OPERATIONS
// ================================

// ✅ Get products available at a specific stock location
export const getProductsByStock = async (
  stockId: string,
  page: number = 1,
  size: number = 20,
): Promise<Product[]> => {
  console.log(`Fetching products for stockId: ${stockId}`);

  try {
    if (!stockId) return [];

    // 1️⃣ Fetch stock inventory items for the given stockId
    const stockSnapshot = await adminFirestore
      .collection("stock_inventory")
      .where("stockId", "==", stockId)
      .get();

    if (stockSnapshot.empty) {
      console.log("No inventory found for stockId:", stockId);
      return [];
    }

    // 2️⃣ Extract unique productIds
    const productIdsSet = new Set<string>();
    stockSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.productId) {
        productIdsSet.add(data.productId);
      }
    });

    const productIds = Array.from(productIdsSet);
    if (productIds.length === 0) return [];

    // 3️⃣ Pagination
    const offset = (page - 1) * size;
    const paginatedProductIds = productIds.slice(offset, offset + size);

    if (paginatedProductIds.length === 0) return [];

    // 4️⃣ Fetch products from `products` collection
    const productsCollection = adminFirestore.collection("products");
    const productsSnapshot = await productsCollection
      .where("isDeleted", "==", false)
      .where("status", "==", true)
      .where("id", "in", paginatedProductIds)
      .get();

    const products: Product[] = productsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Product),
    }));

    console.log("Products retrieved:", products.length);
    return products;
  } catch (error) {
    console.error("Error retrieving inventory products:", error);
    throw error;
  }
};

// ✅ Search products by name with stock filtering using Algolia hybrid approach
export const searchProductsByStock = async (
  stockId: string,
  query: string,
): Promise<Product[]> => {
  try {
    if (!stockId || !query) return [];

    // 1️⃣ Fetch stock inventory items for the given stockId
    const stockSnapshot = await adminFirestore
      .collection("stock_inventory")
      .where("stockId", "==", stockId)
      .get();

    if (stockSnapshot.empty) return [];

    // 2️⃣ Extract unique productIds
    const productIdsSet = new Set<string>();
    stockSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.productId) {
        productIdsSet.add(data.productId);
      }
    });

    const productIds = Array.from(productIdsSet);
    if (productIds.length === 0) return [];

    // Request a large number of hits to ensure we get products that might be in this stock
    const { hits } = await searchProducts(query, {
      hitsPerPage: 1000,
      filters: "status:true AND isDeleted:false",
    });

    // 4️⃣ Filter Algolia results to only include those present in the physical stock location
    const products: Product[] = hits
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((hit: any) => productIds.includes(hit.objectID))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((hit: any) => {
        // Remove Algolia specific fields and map objectID -> id
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { objectID, _highlightResult, ...rest } = hit;
        return {
          id: objectID,
          ...rest,
        } as Product;
      });

    return products;
  } catch (error) {
    console.error("Error searching products:", error);
    throw error;
  }
};

// ✅ Get stock inventory for specific product/variant/size
export const getStockInventory = async (
  stockId: string,
  productId: string,
  variantId: string,
  size: string,
): Promise<StockInventoryItem | null> => {
  try {
    const querySnapshot = await adminFirestore
      .collection("stock_inventory")
      .where("stockId", "==", stockId)
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("size", "==", size)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      throw new AppError("Inventory item not found", 404);
    }

    return querySnapshot.docs[0].data() as StockInventoryItem;
  } catch (error) {
    console.error("Error fetching stock inventory:", error);
    throw error;
  }
};

// ✅ Get all inventory for a product at a stock location
export const getProductInventoryByStock = async (
  stockId: string,
  productId: string,
): Promise<StockInventoryItem[]> => {
  try {
    const querySnapshot = await adminFirestore
      .collection("stock_inventory")
      .where("stockId", "==", stockId)
      .where("productId", "==", productId)
      .get();

    return querySnapshot.docs.map((doc) => doc.data() as StockInventoryItem);
  } catch (error) {
    console.error("Error fetching product inventory:", error);
    throw error;
  }
};

// ✅ Get available stocks list
export const getAvailableStocks = async (): Promise<
  { id: string; name: string; label: string }[]
> => {
  try {
    const stocksSnapshot = await adminFirestore
      .collection("stocks")
      .where("status", "==", true)
      .get();

    return stocksSnapshot.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name || doc.id,
      label: doc.data().label || doc.data().name || doc.id,
    }));
  } catch (error) {
    console.error("Error fetching stocks:", error);
    throw error;
  }
};

// ================================
// 🔹 POS ORDER OPERATIONS
// ================================

// ✅ Create a new POS Order and Update Stock
export const createPOSOrder = async (order: Partial<Order>, userId: string) => {
  if (!order.orderId) throw new AppError("Order ID is required", 400);
  if (!order.items?.length) throw new AppError("Order items are required", 400);
  if (!order.stockId) throw new AppError("Stock ID is required", 400);

  const orderRef = adminFirestore.collection("orders").doc(order.orderId);
  const now = admin.firestore.Timestamp.now();

  // Fetch store name if not provided
  let storeName = order.storeName;
  if (!storeName && order.stockId) {
    const stockDoc = await adminFirestore
      .collection("stocks")
      .doc(order.stockId)
      .get();
    if (stockDoc.exists) {
      storeName =
        stockDoc.data()?.name || stockDoc.data()?.label || order.stockId;
    }
  }

  const orderData: Order = {
    ...order,
    from: "Store",
    sourceName: "POS",
    storeName: storeName || "Physical Store",
    userId: userId || order.userId || null,
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

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const batch = adminFirestore.batch();
        // NOTE: Stock is already deducted when adding items to the POS Cart.
        // POS Checkout simply records the order and clears the cart without double-deduction.
        batch.set(orderRef, orderData);
        await batch.commit();

        console.log(
          `🏬 Store order ${order.orderId} committed (attempt ${attempt})`,
        );
        break;
      } catch (err: any) {
        if (attempt === 3) throw err;
        console.warn(`⚠️ Store order retry #${attempt}: ${err.message}`);
        await new Promise((r) => setTimeout(r, attempt * 200));
      }
    }

    await clearPosCart(order.stockId, userId, false);

    // Integrity Update
    const { updateOrAddOrderHash } = await import("./IntegrityService");
    const orderForHashSnap = await orderRef.get();
    const orderForHash = orderForHashSnap.data();
    if (orderForHash) await updateOrAddOrderHash(orderForHash);

    return {
      ...orderData,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error creating POS order:", error);
    throw error;
  }
};

// ================================
// 🔹 PETTY CASH OPERATIONS
// ================================

// ✅ Get Petty Cash Transactions
export const getPettyCash = async (limit: number = 10) => {
  try {
    const snapshot = await adminFirestore
      .collection("petty_cash")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate().toISOString(),
    }));
  } catch (error) {
    console.error("Error fetching petty cash:", error);
    throw error;
  }
};

// ✅ Add Petty Cash Transaction
export const addPettyCashTransaction = async (data: any) => {
  try {
    const pcId = `pc-${nanoid(8)}`;
    const ref = adminFirestore.collection("petty_cash").doc(pcId);
    const transaction = {
      ...data,
      id: pcId,
      createdAt: Timestamp.now(),
    };
    await ref.set(transaction);
    return transaction;
  } catch (error) {
    console.error("Error adding petty cash transaction:", error);
    throw error;
  }
};

// ================================
// 🔹 PAYMENT METHOD OPERATIONS
// ================================

// ✅ Get Payment Methods
export const getPaymentMethods = async () => {
  try {
    const snapshot = await adminFirestore
      .collection("payment_methods")
      .where("isDeleted", "!=", true)
      .where("status", "==", true)
      .where("available", "array-contains", "Store")
      .get();

    if (snapshot.empty) return [];

    return snapshot.docs.map((doc) => ({
      paymentId: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate().toISOString(),
      updatedAt: doc.data().updatedAt?.toDate().toISOString(),
    }));
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    throw error;
  }
};

export const getOrderByOrderId = async (orderId: string) => {
  try {
    const snapshot = await adminFirestore
      .collection("orders")
      .where("orderId", "==", orderId)
      .where("from", "==", "Store")
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new AppError(`Order with Order ID ${orderId} not found`, 404);
    }

    return {
      orderId: snapshot.docs[0].id,
      ...snapshot.docs[0].data(),
      createdAt: snapshot.docs[0].data().createdAt?.toDate().toISOString(),
      updatedAt: snapshot.docs[0].data().updatedAt?.toDate().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching order by order ID:", error);
    throw error;
  }
};

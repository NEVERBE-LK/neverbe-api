import { adminFirestore } from "@/firebase/firebaseAdmin";
import { InventoryItem } from "@/model/InventoryItem"; // Adjust path if needed
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import { AppError } from "@/utils/apiResponse";

const INVENTORY_COLLECTION = "stock_inventory";
const PRODUCTS_COLLECTION = "products"; // Needed for product-level stock updates
const STOCKS_COLLECTION = "stocks"; // Define stocks collection

export const getInventory = async (
  pageNumber: number = 1,
  size: number = 20,
  productId?: string,
  variantId?: string,
  variantSize?: string,
  stockId?: string
): Promise<{ dataList: any[]; rowCount: number }> => {
  try {
    let query: FirebaseFirestore.Query =
      adminFirestore.collection(INVENTORY_COLLECTION);
    let countQuery: FirebaseFirestore.Query =
      adminFirestore.collection(INVENTORY_COLLECTION);

    // Apply filters
    const applyFilters = (
      q: FirebaseFirestore.Query
    ): FirebaseFirestore.Query => {
      let filteredQuery = q;
      if (productId)
        filteredQuery = filteredQuery.where("productId", "==", productId);
      if (variantId)
        filteredQuery = filteredQuery.where("variantId", "==", variantId);
      if (variantSize)
        filteredQuery = filteredQuery.where("size", "==", variantSize);
      if (stockId)
        filteredQuery = filteredQuery.where("stockId", "==", stockId);
      return filteredQuery;
    };

    query = applyFilters(query);
    countQuery = applyFilters(countQuery);

    // Get total count
    const totalSnapshot = await countQuery.get();
    const rowCount = totalSnapshot.size;

    // 3. --- ADDED: orderBy is REQUIRED for offset() ---
    // You must create composite indexes for your filters + this order.
    // e.g., (productId ASC, variantId ASC)
    // e.g., (stockId ASC, productId ASC, variantId ASC)

    const offset = (pageNumber - 1) * size;
    const inventorySnapshot = await query.offset(offset).limit(size).get();

    // 1. Get all raw inventory data first
    const inventoryData = inventorySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<InventoryItem, "id">),
    }));

    if (inventoryData.length === 0) {
      return { dataList: [], rowCount: rowCount };
    }

    // --- OPTIMIZED PRODUCT FETCH ---
    // 2. Get all unique Product IDs
    const productIds = Array.from(
      new Set(inventoryData.map((item) => item.productId))
    );

    // 3. Fetch all product documents in ONE query
    const productsSnapshot = await adminFirestore
      .collection(PRODUCTS_COLLECTION)
      .where(FieldPath.documentId(), "in", productIds)
      .get();

    // 4. Create a fast lookup map (ProductId -> ProductData)
    const productMap = new Map<string, FirebaseFirestore.DocumentData>();
    productsSnapshot.forEach((doc) => {
      productMap.set(doc.id, doc.data());
    });

    // 4. --- ADDED: OPTIMIZED STOCK FETCH ---
    // 4a. Get all unique Stock IDs
    const stockIds = Array.from(
      new Set(inventoryData.map((item) => item.stockId))
    );

    // 4b. Fetch all stock documents in ONE query
    const stocksSnapshot = await adminFirestore
      .collection(STOCKS_COLLECTION)
      .where(FieldPath.documentId(), "in", stockIds)
      .get();

    // 4c. Create a fast lookup map (StockId -> StockData)
    const stockMap = new Map<string, FirebaseFirestore.DocumentData>();
    stocksSnapshot.forEach((doc) => {
      stockMap.set(doc.id, doc.data());
    });
    // 5. --- REMOVED: Inefficient single stock fetch ---
    // const stock = ...

    // 6. Map the final data using both lookup maps
    const inventoryItems = inventoryData.map((item) => {
      const product = productMap.get(item.productId);
      const variant = product?.variants.find(
        (v: any) => v.variantId === item.variantId
      );
      // 7. --- ADDED: Get stock from the map ---
      const stock = stockMap.get(item.stockId);

      return {
        id: item.id,
        productId: item.productId,
        productName: product?.name || "Unknown Product",
        variantId: item.variantId,
        variantName: variant?.variantName || "Unknown Variant",
        size: item.size,
        stockId: item.stockId,
        // 8. --- ADDED: Use stock name from map ---
        stockName: stock?.name || "Unknown Stock",
        quantity: item.quantity,
      };
    });

    return { dataList: inventoryItems, rowCount: rowCount };
  } catch (error: any) {
    console.error("Get Inventory Error:", error);
    if (error.code === "FAILED_PRECONDITION") {
      console.error(
        "Firestore Error: This query requires a composite index. " +
          "Check the Firestore console logs for a link to create it."
      );
      throw new AppError(
        "A database index is required for this filter combination. " +
          "Please check the server logs for a link to create it.",
        500
      );
    }
    throw error;
  }
};

/**
 * Checks if an inventory item already exists for a specific SKU and location.
 * Returns the document ID if found, otherwise null.
 */
export const findExistingInventoryItem = async (
  productId: string,
  variantId: string,
  itemSize: string,
  stockId: string
): Promise<string | null> => {
  const querySnapshot = await adminFirestore
    .collection(INVENTORY_COLLECTION)
    .where("productId", "==", productId)
    .where("variantId", "==", variantId)
    .where("size", "==", itemSize)
    .where("stockId", "==", stockId)
    .limit(1)
    .get();

  if (!querySnapshot.empty) {
    return querySnapshot.docs[0].id;
  }
  return null;
};

/**
 * Adds a new inventory item or updates quantity if it exists.
 * Also updates the denormalized totalStock/inStock on the product.
 */
export const addInventory = async (
  itemData: Omit<InventoryItem, "id">
): Promise<InventoryItem> => {
  const { productId, variantId, size, stockId, quantity } = itemData;

  if (quantity < 0) {
    throw new AppError("Quantity cannot be negative.", 400);
  }

  // Check if item already exists
  const existingDocId = await findExistingInventoryItem(
    productId,
    variantId,
    size,
    stockId
  );

  if (existingDocId) {
    // If it exists, just update the quantity
    console.log(`Inventory item exists (${existingDocId}), updating quantity.`);
    return updateInventoryQuantity(existingDocId, quantity); // Reuse update logic
  } else {
    // If it doesn't exist, create a new document
    const docId = `inv-${nanoid(10)}`; // Generate a unique ID only for new items
    const newItem: Omit<InventoryItem, "id"> & {
      createdAt: FieldValue;
      updatedAt: FieldValue;
    } = {
      ...itemData,
      quantity: Number(quantity), // Ensure number
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await adminFirestore
      .collection(INVENTORY_COLLECTION)
      .doc(docId)
      .set(newItem);
    console.log(`Added new inventory item ${docId}`);

    // After adding, update the product's denormalized stock count
    await updateProductStockCount(productId);

    return { id: docId, ...itemData, quantity: Number(quantity) };
  }
};

/**
 * Updates the quantity of an existing inventory item.
 * Also updates the denormalized totalStock/inStock on the product.
 */
export const updateInventoryQuantity = async (
  inventoryId: string,
  newQuantity: number
): Promise<InventoryItem> => {
  if (newQuantity < 0) {
    throw new AppError("Quantity cannot be negative.", 400);
  }

  const inventoryRef = adminFirestore
    .collection(INVENTORY_COLLECTION)
    .doc(inventoryId);

  try {
    const docSnap = await inventoryRef.get();
    if (!docSnap.exists) {
      throw new AppError(
        `Inventory item with ID ${inventoryId} not found.`,
        404
      );
    }
    const currentItem = docSnap.data() as InventoryItem;

    await inventoryRef.update({
      quantity: Number(newQuantity), // Ensure number
      updatedAt: FieldValue.serverTimestamp(),
    });

    // After updating, trigger product stock count update
    await updateProductStockCount(currentItem.productId); // Update product based on productId

    return { ...currentItem, id: inventoryId, quantity: Number(newQuantity) };
  } catch (error) {
    console.error(
      `Error updating inventory quantity for ${inventoryId}:`,
      error
    );
    throw error;
  }
};

/**
 * Calculates and updates the totalStock and inStock fields on the parent product document.
 */
export const updateProductStockCount = async (
  productId: string
): Promise<void> => {
  const productRef = adminFirestore
    .collection(PRODUCTS_COLLECTION)
    .doc(productId);
  const inventoryQuery = adminFirestore
    .collection(INVENTORY_COLLECTION)
    .where("productId", "==", productId);

  try {
    const inventorySnapshot = await inventoryQuery.get();
    let totalStock = 0;
    inventorySnapshot.forEach((doc) => {
      totalStock += doc.data().quantity || 0;
    });

    const inStock = totalStock > 0;
    const finalTotalStock = totalStock;

    await productRef.update({
      totalStock: finalTotalStock,
      inStock: inStock,
      updatedAt: FieldValue.serverTimestamp(), // Also update product timestamp
    });
    console.log(
      `Updated stock count for product ${productId}: total=${totalStock}, inStock=${inStock}`
    );
  } catch (error) {
    console.error(
      `Failed to update stock count for product ${productId}:`,
      error
    );
    // Don't re-throw; this is a-denormalization, main op may have succeeded
  }
};

export async function getInventoryQuantity(
  productId: string,
  variantId: string,
  size: string,
  stockId: string
) {
  try {
    // Note: This composite query will likely require you to create
    // a corresponding index in your Firestore database.
    // Firestore will provide a link in the error message to create it.
    const inventoryRef = adminFirestore.collection(INVENTORY_COLLECTION); // Assuming collection is named 'inventory'
    const query = inventoryRef
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("size", "==", size)
      .where("stockId", "==", stockId)
      .limit(1);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return {
        id: null,
        quantity: 0,
      };
    }

    // Return the quantity from the found document
    const docData = snapshot.docs[0].data();
    return {
      id: snapshot.docs[0].id,
      ...docData,
    };
  } catch (error) {
    console.error("Error fetching inventory quantity:", error);
    throw error;
  }
}

/**
 * Adds multiple inventory items at once for all sizes of a variant.
 * This is more efficient than calling addInventory multiple times.
 */
export const addBulkInventory = async (
  productId: string,
  variantId: string,
  stockId: string,
  sizeQuantities: { size: string; quantity: number }[]
): Promise<{ success: number; failed: number; errors: string[] }> => {
  const results = { success: 0, failed: 0, errors: [] as string[] };

  // Filter out entries with 0 or negative quantity
  const validEntries = sizeQuantities.filter((sq) => sq.quantity > 0);

  if (validEntries.length === 0) {
    return results;
  }

  // Process each size entry
  for (const { size, quantity } of validEntries) {
    try {
      // Check if item already exists
      const existingDocId = await findExistingInventoryItem(
        productId,
        variantId,
        size,
        stockId
      );

      if (existingDocId) {
        // Update existing
        await adminFirestore
          .collection(INVENTORY_COLLECTION)
          .doc(existingDocId)
          .update({
            quantity: Number(quantity),
            updatedAt: FieldValue.serverTimestamp(),
          });
        console.log(
          `Updated bulk inventory item ${existingDocId} with quantity ${quantity}`
        );
      } else {
        // Create new
        const docId = `inv-${nanoid(10)}`;
        const newItem = {
          productId,
          variantId,
          size,
          stockId,
          quantity: Number(quantity),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        await adminFirestore
          .collection(INVENTORY_COLLECTION)
          .doc(docId)
          .set(newItem);
        console.log(`Added bulk inventory item ${docId} for size ${size}`);
      }
      results.success++;
    } catch (error: any) {
      console.error(`Failed to add inventory for size ${size}:`, error);
      results.failed++;
      results.errors.push(`Size ${size}: ${error.message}`);
    }
  }

  // Update product stock count once after all entries are processed
  if (results.success > 0) {
    await updateProductStockCount(productId);
  }

  return results;
};

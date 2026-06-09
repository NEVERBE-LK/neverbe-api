import { inventoryRepository } from "@/repositories/InventoryRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { stockRepository } from "@/repositories/FinanceRepositories";
import { InventoryItem } from "@/model/InventoryItem";
import { nanoid } from "nanoid";
import { AppError } from "@/utils/apiResponse";
import { formatEntityDates, formatListDates } from "./UtilService";

/**
 * InventoryService - Business logic for stock management
 * Delegates data access to repositories
 */

export const getInventory = async (
  pageNumber: number = 1,
  size: number = 20,
  productId?: string,
  variantId?: string,
  variantSize?: string,
  stockId?: string
): Promise<{ dataList: any[]; rowCount: number }> => {
  const { dataList, total } = await inventoryRepository.findPaginated({
    page: pageNumber,
    size,
    productId,
    variantId,
    sizeFilter: variantSize,
    stockId
  });

  if (dataList.length === 0) return { dataList: [], rowCount: total };

  // Fetch related data in batch (Business Logic: Aggregation)
  const productIds = Array.from(new Set(dataList.map((item) => item.productId)));
  const products = await productRepository.findByIds(productIds);
  const productMap = new Map(products.map(p => [p.id, p]));

  const stockIds = Array.from(new Set(dataList.map((item) => item.stockId)));
  const stocksSnapshot = await stockRepository.findByIds(stockIds);
  const stockMap = new Map(stocksSnapshot.map(s => [s.id, s]));

  const inventoryItems = dataList.map((item) => {
    const product = productMap.get(item.productId) as any;
    const variant = product?.variants?.find((v: any) => v.variantId === item.variantId);
    const stock = stockMap.get(item.stockId) as any;

    return {
      id: item.id,
      productId: item.productId,
      productName: product?.name || "Unknown Product",
      variantId: item.variantId,
      variantName: variant?.variantName || "Unknown Variant",
      size: item.size,
      stockId: item.stockId,
      stockName: stock?.name || "Unknown Stock",
      quantity: item.quantity,
    };
  });

  return { dataList: formatListDates(inventoryItems), rowCount: total };
};

export const findExistingInventoryItem = async (
  productId: string,
  variantId: string,
  itemSize: string,
  stockId: string
) => inventoryRepository.findDocId(productId, variantId, itemSize, stockId);

export const addInventory = async (
  itemData: Omit<InventoryItem, "id">
): Promise<InventoryItem> => {
  const { productId, variantId, size, stockId, quantity } = itemData;
  if (quantity < 0) throw new AppError("Quantity cannot be negative.", 400);

  const existingDocId = await findExistingInventoryItem(productId, variantId, size, stockId);

  if (existingDocId) {
    return updateInventoryQuantity(existingDocId, quantity);
  } else {
    const docId = `inv-${nanoid(10)}`;
    const newItem = await inventoryRepository.create(docId, itemData);
    await updateProductStockCount(productId);
    return formatEntityDates(newItem) as any;
  }
};

export const updateInventoryQuantity = async (
  inventoryId: string,
  newQuantity: number
): Promise<InventoryItem> => {
  if (newQuantity < 0) throw new AppError("Quantity cannot be negative.", 400);

  const existing = await inventoryRepository.findById(inventoryId);
  if (!existing) throw new AppError(`Inventory item with ID ${inventoryId} not found.`, 404);

  await inventoryRepository.updateQuantity(inventoryId, newQuantity);
  await updateProductStockCount(existing.productId);
  
  return formatEntityDates({
    ...existing,
    id: inventoryId,
    quantity: Number(newQuantity)
  }) as any;
};

export const updateProductStockCount = async (productId: string): Promise<void> => {
  try {
    const inventory = await inventoryRepository.findByProductId(productId);
    const totalStock = inventory.reduce((sum, item) => sum + (item.quantity || 0), 0);

    await productRepository.update(productId, {
      totalStock,
      inStock: totalStock > 0,
    });
  } catch (error) {
    console.error(`Failed to update stock count for product ${productId}:`, error);
  }
};

export const getInventoryQuantity = async (
  productId: string,
  variantId: string,
  size: string,
  stockId: string
) => {
  const item = await inventoryRepository.findItem(stockId, productId, variantId, size);
  return item ? { id: (item as any).id, ...item } : { id: null, quantity: 0 };
};

export const addBulkInventory = async (
  productId: string,
  variantId: string,
  stockId: string,
  sizeQuantities: { size: string; quantity: number }[]
): Promise<{ success: number; failed: number; errors: string[] }> => {
  const results = { success: 0, failed: 0, errors: [] as string[] };
  const validEntries = sizeQuantities.filter((sq) => sq.quantity >= 0);

  for (const { size, quantity } of validEntries) {
    try {
      const existingDocId = await findExistingInventoryItem(productId, variantId, size, stockId);
      if (existingDocId) {
        await inventoryRepository.updateQuantity(existingDocId, quantity);
      } else {
        const docId = `inv-${nanoid(10)}`;
        await inventoryRepository.create(docId, { productId, variantId, size, stockId, quantity });
      }
      results.success++;
    } catch (error: any) {
      results.failed++;
      results.errors.push(`Size ${size}: ${error.message}`);
    }
  }

  await updateProductStockCount(productId);
  return results;
};

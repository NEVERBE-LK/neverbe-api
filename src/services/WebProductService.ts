import { productRepository } from "@/repositories/ProductRepository";
import { purchaseOrderRepository } from "@/repositories/PurchaseOrderRepository";
import { orderRepository } from "@/repositories/OrderRepository";
import { settingsRepository } from "@/repositories/SettingsRepository";
import { brandRepository } from "@/repositories/BrandRepository";
import { categoryRepository } from "@/repositories/CategoryRepository";
// paymentMethodRepository import removed as it's now part of settingsRepository
import { Product } from "@/interfaces/Product";
import { ProductVariant } from "@/interfaces/ProductVariant";
import { formatEntityDates, formatListDates } from "./UtilService";

/**
 * WebProductService - Thin wrapper over ProductRepository for the Website
 * Delegates data access to repository layer, keeps web-specific logic here
 */

// ====================== Enrichment Helpers ======================

const getApprovedPOProductIds = async (): Promise<Set<string>> => {
  return await purchaseOrderRepository.findProductIdsFromApprovedPOs();
};

const enrichProductsWithLabels = async (
  products: Product[],
): Promise<Product[]> => {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const approvedPOProductIds = await getApprovedPOProductIds();

  return products.map((product) => {
    let createdAtDate: Date | null = null;
    if (product.createdAt) {
      if (typeof (product.createdAt as any).toDate === 'function') {
        createdAtDate = (product.createdAt as any).toDate();
      } else {
        createdAtDate = new Date(product.createdAt);
      }
    }

    const isNewArrival = createdAtDate && createdAtDate >= ninetyDaysAgo;
    const isRestockingSoon = !product.inStock && approvedPOProductIds.has(product.id || product.productId);
    const gender = (product.tags || []).filter((t) => ["men", "women", "kids", "unisex"].includes(t.toLowerCase()));

    return formatEntityDates({
      ...product,
      gender,
      isNewArrival: !!isNewArrival,
      isRestockingSoon: !!isRestockingSoon,
    });
  });
};

// ====================== Products ======================

export const getProducts = async (options: {
  tags?: string[];
  brand?: string;
  category?: string;
  inStock?: boolean;
  page?: number;
  size?: number;
}): Promise<{ total: number; dataList: Product[] }> => {
  const result = await productRepository.findAll(options);
  const enriched = await enrichProductsWithLabels(result.dataList);
  return { ...result, dataList: enriched };
};

export interface ProductFilterOptions {
  tags?: string[];
  brand?: string;
  category?: string;
  inStock?: boolean;
  sizes?: string[];
  gender?: string;
  page?: number;
  size?: number;
}

export const getProductsFiltered = async (
  options: ProductFilterOptions,
): Promise<{ total: number; dataList: Product[] }> => {
  const result = await productRepository.findAllFiltered(options);
  const enriched = await enrichProductsWithLabels(result.dataList);
  return { ...result, dataList: enriched };
};

// ====================== New Arrivals ======================

export const getNewArrivals = async (
  options: any = {},
): Promise<{ total: number; dataList: Product[] }> => {
  const result = await productRepository.findNewArrivals(options);
  const enriched = await enrichProductsWithLabels(result.dataList);
  return { ...result, dataList: enriched };
};

// ====================== Recent Items (Just Dropped) ======================

export const getRecentItems = async (limit: number = 8) => {
  // Logic: "Just Dropped" -> Most recently added items that are actually in stock
  const result = await productRepository.findNewArrivals({ page: 1, size: 50 });
  
  // Filter for products that are currently in stock
  const inStockProducts = result.dataList.filter(p => p.inStock === true);
  const sliced = inStockProducts.slice(0, limit);
  
  // If we don't have enough in-stock new items, fallback to the absolute newest items
  const finalProducts = sliced.length >= limit / 2 ? sliced : result.dataList.slice(0, limit);
  
  return enrichProductsWithLabels(finalProducts);
};

// ====================== Get Product By ID ======================

export const getProductById = async (itemId: string) => {
  const product = await productRepository.findById(itemId);
  if (!product) throw new Error(`Product not found: ${itemId}`);
  const enriched = await enrichProductsWithLabels([product]);
  return enriched[0];
};

// ====================== Get Similar Items ======================

export const getSimilarItems = async (itemId: string) => {
  const products = await productRepository.findSimilar(itemId, 8);
  return enrichProductsWithLabels(products);
};

// ====================== Stock & Sitemap ======================

export const getProductStock = async (productId: string, variantId: string, size: string) => {
  const ecomSettings = await settingsRepository.getEcommerceSettings();
  const erpSettings = await settingsRepository.getErpSettings();

  const stockId = ecomSettings?.stockId ||
    ecomSettings?.onlineStockId ||
    erpSettings?.stockId ||
    erpSettings?.onlineStockId ||
    erpSettings?.warehouseId ||
    "MAIN";

  if (stockId === "MAIN" && !ecomSettings?.stockId && !erpSettings?.stockId) {
    console.warn("[WebProductService] stockId missing in settings, falling back to 'MAIN'");
  }

  const vId = variantId === "null" || variantId === "" ? null : variantId;
  return productRepository.getStock(productId, vId, size, stockId);
};

export const getBatchProductStock = async (
  productId: string, variantId: string, sizes: string[]
): Promise<Record<string, number>> => {
  const ecomSettings = await settingsRepository.getEcommerceSettings();
  const erpSettings = await settingsRepository.getErpSettings();

  const stockId = ecomSettings?.stockId ||
    ecomSettings?.onlineStockId ||
    erpSettings?.stockId ||
    erpSettings?.onlineStockId ||
    erpSettings?.warehouseId ||
    "MAIN";

  if (stockId === "MAIN" && !ecomSettings?.stockId && !erpSettings?.stockId) {
    console.warn("[WebProductService] stockId missing in settings, falling back to 'MAIN'");
  }

  const vId = variantId === "null" || variantId === "" ? null : variantId;

  const results = await Promise.all(
    sizes.map(async (size) => ({
      size,
      quantity: await productRepository.getStock(productId, vId, size, stockId),
    })),
  );

  const stockMap: Record<string, number> = {};
  results.forEach(({ size, quantity }) => { stockMap[size] = quantity; });
  return stockMap;
};

export const getProductsForSitemap = async () => {
  const products = await productRepository.findAllForSitemap();
  const baseUrl = process.env.WEB_BASE_URL;
  return products.map((p) => ({
    url: `${baseUrl}/collections/products/${p.id}`,
    lastModified: formatEntityDates({ date: new Date() }).date,
    priority: 0.7,
  }));
};

export const getBrandForSitemap = async () => brandRepository.findForSitemap(process.env.WEB_BASE_URL || "");
export const getCategoriesForSitemap = async () => categoryRepository.findForSitemap(process.env.WEB_BASE_URL || "");
export const getPaymentMethods = async () => settingsRepository.findPaymentMethodsForWebsite();

// ====================== Hot & Deals ======================

export const getHotProducts = async () => {
  // Logic: "Popular Now" -> Same as Dashboard, most sold items in the last 30 days from paid orders
  const endDay = new Date();
  const startDay = new Date();
  startDay.setDate(startDay.getDate() - 30); // Last 30 days

  const orders = await orderRepository.findPaidOrdersInDateRange(startDay, endDay);
  
  const itemsMap = new Map<string, number>();
  orders.forEach((order) => {
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item) => {
        const count = itemsMap.get(item.itemId) || 0;
        itemsMap.set(item.itemId, count + item.quantity);
      });
    }
  });

  const sortedItemIds = Array.from(itemsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([itemId]) => itemId);

  if (sortedItemIds.length === 0) return [];

  const products = await productRepository.findByIds(sortedItemIds);
  const filtered = products.filter((p) => p.listing === true && p.status === true && !p.isDeleted);
  return enrichProductsWithLabels(filtered);
};

export const getDealsProducts = async (
  page: number = 1, size: number = 10, tags?: string[], inStock?: boolean, gender?: string, sizes?: string[]
) => {
  const result = await productRepository.findDiscounted({ page, size, tags, inStock, gender, sizes });
  const enriched = await enrichProductsWithLabels(result.dataList);
  return { ...result, dataList: enriched };
};

export const getDealsProductsFiltered = async (options: ProductFilterOptions) => {
  const { tags, inStock, sizes, gender, page = 1, size = 20 } = options;
  return getDealsProducts(page, size, tags, inStock, gender, sizes);
};

export const searchWebProducts = async (query_string: string, options: any = {}) => {
  const { page = 1, size = 20 } = options;
  const { dataList, total } = await productRepository.findAllPaginated({
    page, size, search: query_string, listing: true, status: true
  });
  const enriched = await enrichProductsWithLabels(dataList);
  return { total, dataList: enriched };
};

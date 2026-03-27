import { productRepository } from "@/repositories/ProductRepository";
import { otherRepository } from "@/repositories/OtherRepository";
import { Product } from "@/interfaces/Product";
import { adminFirestore } from "@/firebase/firebaseAdmin";
import { getActivePromotions } from "./WebPromotionService";
import { ProductVariant } from "@/interfaces/ProductVariant";
import { searchProducts } from "./AlgoliaService";

/**
 * ProductService - Thin wrapper over ProductRepository
 * Delegates data access to repository layer, keeps business logic here
 */

const buildAlgoliaFiltersForWeb = (options: {
  tags?: string[];
  brand?: string;
  category?: string;
  inStock?: boolean;
  sizes?: string[];
  gender?: string;
  createdAtMin?: number;
}): string => {
  const filters: string[] = ["isDeleted:false", "status:true", "listing:true"];

  if (options.inStock !== undefined) {
    if (options.inStock) {
      filters.push("inStock:true");
    } else {
      filters.push("inStock:false");
    }
  }

  if (options.gender) {
    filters.push(`gender:"${options.gender}"`);
  }

  if (options.brand) {
    filters.push(`brand:"${options.brand}"`);
  }

  if (options.category) {
    filters.push(`category:"${options.category}"`);
  }

  if (options.tags && options.tags.length > 0) {
    const tagFilters = options.tags.map((t) => `tags:"${t}"`).join(" OR ");
    filters.push(`(${tagFilters})`);
  }

  if (options.sizes && options.sizes.length > 0) {
    const sizeFilters = options.sizes
      .map((s) => `availableSizes:"${s}"`)
      .join(" OR ");
    filters.push(`(${sizeFilters})`);
  }

  if (options.createdAtMin) {
    filters.push(`createdAt >= ${options.createdAtMin}`);
  }

  return filters.join(" AND ");
};

const mapAlgoliaHitsToProducts = (
  hits: Record<string, unknown>[],
): Product[] => {
  return hits.map((hit: Record<string, unknown>) => {
    const activeVariants = ((hit.variants as ProductVariant[]) || []).filter(
      (v: ProductVariant & { isDeleted?: boolean }) => !v.isDeleted,
    );

    return {
      ...hit,
      id: hit.objectID || hit.id,
      productId: hit.objectID || hit.id,
      variants: activeVariants,
    } as unknown as Product;
  });
};

// ====================== Enrichment Helpers ======================

/**
 * Identify product IDs from all APPROVED purchase orders
 */
const getApprovedPOProductIds = async (): Promise<Set<string>> => {
  const snapshot = await adminFirestore
    .collection("purchase_orders")
    .where("status", "==", "APPROVED")
    .get();

  const productIds = new Set<string>();
  snapshot.forEach((doc) => {
    const po = doc.data();
    if (Array.isArray(po.items)) {
      po.items.forEach((item: any) => {
        if (item.productId) productIds.add(item.productId);
      });
    }
  });
  return productIds;
};

/**
 * Enrich products with "New Arrival" and "Restock Soon" labels
 */
const enrichProductsWithLabels = async (
  products: Product[],
): Promise<Product[]> => {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const approvedPOProductIds = await getApprovedPOProductIds();

  return products.map((product) => {
    let createdAtDate: Date | null = null;

    if (product.createdAt) {
      if (typeof product.createdAt === "number") {
        createdAtDate = new Date(
          product.createdAt < 100000000000
            ? product.createdAt * 1000
            : product.createdAt,
        );
      } else {
        createdAtDate = new Date(product.createdAt);
      }
    }

    const isNewArrival = createdAtDate && createdAtDate >= ninetyDaysAgo;

    const isRestockingSoon =
      !product.inStock &&
      approvedPOProductIds.has(product.id || product.productId);

    return {
      ...product,
      isNewArrival: !!isNewArrival,
      isRestockingSoon: !!isRestockingSoon,
    };
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

/**
 * Get products with filtering for gender and sizes
 */
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
  options: {
    page?: number;
    size?: number;
    tags?: string[];
    brand?: string;
    category?: string;
    inStock?: boolean;
    sizes?: string[];
    gender?: string;
  } = {},
): Promise<{ total: number; dataList: Product[] }> => {
  const result = await productRepository.findNewArrivals(options);
  const enriched = await enrichProductsWithLabels(result.dataList);
  return { ...result, dataList: enriched };
};

// ====================== Recent Items ======================
export const getRecentItems = async (limit: number = 8) => {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const threshold = ninetyDaysAgo.getTime();

  const filtersStr = buildAlgoliaFiltersForWeb({
    createdAtMin: threshold,
  });

  const { hits } = await searchProducts("", {
    page: 0,
    hitsPerPage: limit,
    filters: filtersStr,
  });

  const products = mapAlgoliaHitsToProducts(hits);
  return enrichProductsWithLabels(products);
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

// ====================== Get Product Stock ======================
export const getProductStock = async (
  productId: string,
  variantId: string,
  size: string,
) => {
  const settings = await otherRepository.getSettings();
  if (!settings?.stockId)
    throw new Error("onlineStockId not found in ERP settings");
  return productRepository.getStock(
    productId,
    variantId,
    size,
    settings.stockId,
  );
};

// ====================== Batch Stock (Single Call for All Sizes) ======================
export const getBatchProductStock = async (
  productId: string,
  variantId: string,
  sizes: string[],
): Promise<Record<string, number>> => {
  const settings = await otherRepository.getSettings();
  if (!settings?.stockId)
    throw new Error("onlineStockId not found in ERP settings");

  // Fetch all sizes in parallel at repository level
  const results = await Promise.all(
    sizes.map(async (size) => ({
      size,
      quantity: await productRepository.getStock(
        productId,
        variantId,
        size,
        settings.stockId,
      ),
    })),
  );

  const stockMap: Record<string, number> = {};
  results.forEach(({ size, quantity }) => {
    stockMap[size] = quantity;
  });
  return stockMap;
};

// ====================== Sitemap ======================
export const getProductsForSitemap = async () => {
  const products = await productRepository.findAllForSitemap();
  const baseUrl = process.env.WEB_BASE_URL;
  return products.map((p) => ({
    url: `${baseUrl}/collections/products/${p.id}`,
    lastModified: new Date(),
    priority: 0.7,
  }));
};

export const getBrandForSitemap = async () =>
  otherRepository.getBrandsForSitemap(process.env.WEB_BASE_URL || "");

export const getCategoriesForSitemap = async () =>
  otherRepository.getCategoriesForSitemap(process.env.WEB_BASE_URL || "");

// ====================== Payment Methods ======================
export const getPaymentMethods = async () =>
  otherRepository.getPaymentMethods();

// ====================== Hot Products (Complex Business Logic) ======================
// Kept in service layer - aggregates across orders collection
export const getHotProducts = async () => {
  const ordersSnapshot = await adminFirestore
    .collection("orders")
    .limit(100)
    .get();

  const itemCount: Record<string, number> = {};
  ordersSnapshot.forEach((doc) => {
    const order = doc.data();
    if (Array.isArray(order.items)) {
      order.items.forEach((item) => {
        if (item?.itemId)
          itemCount[item.itemId] = (itemCount[item.itemId] || 0) + 1;
      });
    }
  });

  const sortedItemIds = Object.entries(itemCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([itemId]) => itemId);

  if (sortedItemIds.length === 0) return [];

  const products = await productRepository.findByIds(sortedItemIds);

  // Filter out unlisted, inactive, or deleted products to prevent "leaking"
  const filtered = products.filter(
    (p) => p.listing === true && p.status === true && !p.isDeleted,
  );

  return enrichProductsWithLabels(filtered);
};

// ====================== Deals Products (Complex Business Logic) ======================

/**
 * Helper: Extract targeted product IDs from active promotions
 */
const getPromotedProductIds = (activePromotions: any[]): Set<string> => {
  const promoProductIds = new Set<string>();

  activePromotions.forEach((promo: any) => {
    if (promo.applicableProducts) {
      promo.applicableProducts.forEach((id: string) => promoProductIds.add(id));
    }
    if (promo.applicableProductVariants) {
      promo.applicableProductVariants.forEach((v: any) =>
        promoProductIds.add(v.productId),
      );
    }
    if (promo.conditions && Array.isArray(promo.conditions)) {
      promo.conditions.forEach((cond: any) => {
        if (cond.type === "SPECIFIC_PRODUCT") {
          if (cond.value && typeof cond.value === "string")
            promoProductIds.add(cond.value);
          if (cond.productIds && Array.isArray(cond.productIds)) {
            cond.productIds.forEach((id: string) => promoProductIds.add(id));
          }
        }
      });
    }
  });

  return promoProductIds;
};

/**
 * Helper: Identify if any request-wide promotion exists (no specific products targeted)
 */
const hasGlobalPromotion = (activePromotions: any[]): boolean => {
  return activePromotions.some((promo: any) => {
    const hasProductTargeting =
      (promo.applicableProducts && promo.applicableProducts.length > 0) ||
      (promo.applicableProductVariants &&
        promo.applicableProductVariants.length > 0) ||
      (promo.conditions &&
        promo.conditions.some((c: any) => c.type === "SPECIFIC_PRODUCT"));
    return !hasProductTargeting;
  });
};

export const getDealsProducts = async (
  page: number = 1,
  size: number = 10,
  tags?: string[],
  inStock?: boolean,
  gender?: string,
  sizes?: string[],
): Promise<{ total: number; dataList: Product[] }> => {
  const result = await productRepository.findDiscounted({
    page,
    size,
    tags,
    inStock,
    gender,
    sizes,
  });
  const enriched = await enrichProductsWithLabels(result.dataList);
  return { ...result, dataList: enriched };
};

/**
 * Get deals products with filtering for gender and sizes
 * Optimized: Delegates fully to getDealsProducts
 */
export const getDealsProductsFiltered = async (
  options: ProductFilterOptions,
): Promise<{ total: number; dataList: Product[] }> => {
  const { tags, inStock, sizes, gender, page = 1, size = 20 } = options;
  return getDealsProducts(page, size, tags, inStock, gender, sizes);
};

// ====================== Search Web Products ======================
export const searchWebProducts = async (
  query: string,
  options: {
    page?: number;
    size?: number;
  } = {},
): Promise<{ total: number; dataList: Product[] }> => {
  const { page = 1, size = 20 } = options;
  
  // Apply standard web filters (only active, listed, non-deleted)
  const filtersStr = "status:true AND listing:true AND isDeleted:false";

  const { hits, nbHits } = await searchProducts(query, {
    page: page - 1,
    hitsPerPage: size,
    filters: filtersStr,
  });

  const products = mapAlgoliaHitsToProducts(hits);
  const enriched = await enrichProductsWithLabels(products);

  return { total: nbHits, dataList: enriched };
};

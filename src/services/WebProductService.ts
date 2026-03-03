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
  inStock?: boolean;
  sizes?: string[];
  gender?: string;
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

// ====================== Products ======================
export const getProducts = async (
  tags?: string[],
  inStock?: boolean,
  page: number = 1,
  size: number = 20,
): Promise<{ total: number; dataList: Product[] }> => {
  const filtersStr = buildAlgoliaFiltersForWeb({ tags, inStock });
  const { hits, nbHits } = await searchProducts("", {
    page: page - 1,
    hitsPerPage: size,
    filters: filtersStr,
  });

  return { total: nbHits, dataList: mapAlgoliaHitsToProducts(hits) };
};

/**
 * Get products with filtering for gender and sizes
 */
export interface ProductFilterOptions {
  tags?: string[];
  inStock?: boolean;
  sizes?: string[];
  gender?: string;
  page?: number;
  size?: number;
}

export const getProductsFiltered = async (
  options: ProductFilterOptions,
): Promise<{ total: number; dataList: Product[] }> => {
  const filtersStr = buildAlgoliaFiltersForWeb(options);
  const page = options.page || 1;
  const size = options.size || 20;

  const { hits, nbHits } = await searchProducts("", {
    page: page - 1,
    hitsPerPage: size,
    filters: filtersStr,
  });

  return { total: nbHits, dataList: mapAlgoliaHitsToProducts(hits) };
};

// ====================== New Arrivals ======================
export const getNewArrivals = async (
  page: number = 1,
  size: number = 20,
): Promise<{ total: number; dataList: Product[] }> =>
  productRepository.findNewArrivals({ page, size });

// ====================== Recent Items ======================
export const getRecentItems = async () => productRepository.findRecent(8);

// ====================== Get Product By ID ======================
export const getProductById = async (itemId: string) => {
  const product = await productRepository.findById(itemId);
  if (!product) throw new Error(`Product not found: ${itemId}`);
  return product;
};

// ====================== Get Similar Items ======================
export const getSimilarItems = async (itemId: string) =>
  productRepository.findSimilar(itemId, 8);

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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  return products.map((p) => ({
    url: `${baseUrl}/collections/products/${p.id}`,
    lastModified: new Date(),
    priority: 0.7,
  }));
};

export const getBrandForSitemap = async () =>
  otherRepository.getBrandsForSitemap(process.env.NEXT_PUBLIC_BASE_URL || "");

export const getCategoriesForSitemap = async () =>
  otherRepository.getCategoriesForSitemap(
    process.env.NEXT_PUBLIC_BASE_URL || "",
  );

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
  return products.filter(
    (p) => p.listing === true && p.status === true && !p.isDeleted,
  );
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
  const activePromotions = await getActivePromotions();

  // 1. Check for Global Promotions
  if (hasGlobalPromotion(activePromotions)) {
    return getProductsFiltered({
      tags,
      inStock,
      page,
      size,
      gender,
      sizes,
    });
  }

  // 2. Fetch & Filter Promoted Products (Priority list)
  const promoProductIds = getPromotedProductIds(activePromotions);
  const allPromoIds = Array.from(promoProductIds);
  let promoProducts: Product[] = [];

  if (allPromoIds.length > 0) {
    promoProducts = await productRepository.findByIds(allPromoIds);

    // Apply Filters to Promo Products in Memory

    // Tags
    if (tags && tags.length > 0) {
      const tagsLower = tags.map((t) => t.toLowerCase());
      promoProducts = promoProducts.filter((product) => {
        const productTags = (product.tags || []).map((t: string) =>
          t.toLowerCase(),
        );
        return tagsLower.some((tag) => productTags.includes(tag));
      });
    }

    // InStock
    if (typeof inStock === "boolean") {
      promoProducts = promoProducts.filter(
        (product) => product.inStock === inStock,
      );
    }

    // Gender
    if (gender) {
      promoProducts = promoProducts.filter((product) =>
        (product.gender || []).some(
          (g: string) => g.toLowerCase() === gender.toLowerCase(),
        ),
      );
    }

    // Sizes
    if (sizes && sizes.length > 0) {
      promoProducts = promoProducts.filter((product) => {
        const productSizes = new Set<string>();
        (product.variants || []).forEach((v) => {
          (v.sizes || []).forEach((s: string) => productSizes.add(s));
        });
        return sizes.some((s) => productSizes.has(s));
      });
    }
  }

  const promoCount = promoProducts.length;

  // 3. Get Discounted Products Count
  // We use Algolia for accurate count of "filling" items
  const getDiscountedProductsFromAlgolia = async (
    options: ProductFilterOptions,
  ): Promise<{ total: number; dataList: Product[] }> => {
    const filtersStr = buildAlgoliaFiltersForWeb(options) + " AND discount > 0";
    const p = options.page || 1;
    const s = options.size || 20;

    const { hits, nbHits } = await searchProducts("", {
      page: p - 1,
      hitsPerPage: s,
      filters: filtersStr,
    });

    return { total: nbHits, dataList: mapAlgoliaHitsToProducts(hits) };
  };

  const discountResult = await getDiscountedProductsFromAlgolia({
    tags,
    inStock,
    gender,
    sizes,
    page: 1,
    size: 1, // Minimal fetch for count
  });
  const discountTotal = discountResult.total;
  const total = promoCount + discountTotal;

  // 4. Stitching Strategy
  // Determine which items to return based on the requested page window

  const startIndex = (page - 1) * size;
  let dataList: Product[] = [];

  // A) Add Promoted Products if they fall within the range
  if (startIndex < promoCount) {
    dataList = promoProducts.slice(startIndex, startIndex + size);
  }

  // B) Fill remaining slots with Discounted Products
  if (dataList.length < size) {
    const remainingSlots = size - dataList.length;

    // Calculate how many discounted items we conceptually skipped "behind" the promo items
    // If startIndex > promoCount, we skipped (startIndex - promoCount) discounted items.
    // If startIndex < promoCount, we are just starting to read discounted items from index 0.
    const discountOffset = Math.max(0, startIndex - promoCount);

    // Mapping implicit logic offset to Page/Size for repository
    // We need items from [discountOffset] to [discountOffset + remainingSlots]
    // Since repository is Page-based (size=20 usually), we might span across 2 pages.
    // Note: We use the requested 'size' (default 10 or 20) as the chunk size.

    const pageA = Math.floor(discountOffset / size) + 1;
    const pageB = Math.floor((discountOffset + remainingSlots) / size) + 1;

    const promises = [
      getDiscountedProductsFromAlgolia({
        tags,
        inStock,
        gender,
        sizes,
        page: pageA,
        size: size,
      }),
    ];

    if (pageB !== pageA) {
      promises.push(
        getDiscountedProductsFromAlgolia({
          tags,
          inStock,
          gender,
          sizes,
          page: pageB,
          size: size,
        }),
      );
    }

    const results = await Promise.all(promises);

    // Merge results from potential multiple pages
    let potentialDiscounts = results[0].dataList;
    if (results[1]) {
      potentialDiscounts = [...potentialDiscounts, ...results[1].dataList];
    }

    // Extract the exact slice we need relative to the fetched pages
    const pageAStart = (pageA - 1) * size;
    const relativeStart = discountOffset - pageAStart;

    const neededDiscounts = potentialDiscounts.slice(
      relativeStart,
      relativeStart + remainingSlots,
    );

    // Dedup against Promos (Ensure we don't show a promo item again as a discount item)
    const deduped = neededDiscounts.filter((p) => !promoProductIds.has(p.id));
    dataList = [...dataList, ...deduped];
  }

  return { total, dataList };
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

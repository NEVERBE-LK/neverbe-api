import { productRepository } from "@/repositories/ProductRepository";
import { orderRepository } from "@/repositories/OrderRepository";
import { purchaseOrderRepository } from "@/repositories/PurchaseOrderRepository";
import { settingsRepository } from "@/repositories/SettingsRepository";
import { brandRepository } from "@/repositories/BrandRepository";
import { categoryRepository } from "@/repositories/CategoryRepository";
// paymentMethodRepository import removed as it's now part of settingsRepository
import { Product } from "@/model/Product";
import { ProductVariant } from "@/model/ProductVariant";
import { nanoid } from "nanoid";
import { adminStorageBucket } from "@/firebase/firebaseAdmin";
import { AppError } from "@/utils/apiResponse";
import { uploadCompressedImage } from "./StorageService";
import { Order } from "@/model/Order";
import { PopularItem } from "@/model/PopularItem";
import { getNowSL, parseToDayjs } from "./UtilService";
import dayjs from "../utils/dayjs";

const BUCKET = adminStorageBucket;

// ====================== Helpers ======================

const uploadThumbnail = async (
  file: File,
  id: string,
): Promise<Product["thumbnail"]> => {
  const filePath = `products/${id}/thumbnail/thumb_${getNowSL().valueOf()}.webp`;
  const url = await uploadCompressedImage(file, filePath);

  return {
    url: url,
    file: filePath,
    order: 0,
  } as any;
};

const getApprovedPOProductIds = async (): Promise<Set<string>> => {
  return await purchaseOrderRepository.findProductIdsFromApprovedPOs();
};

const enrichProductsWithLabels = async (
  products: Product[],
): Promise<Product[]> => {
  const ninetyDaysAgo = getNowSL().subtract(90, "day");
  const approvedPOProductIds = await getApprovedPOProductIds();

  return products.map((product) => {
    const createdAt = parseToDayjs(product.createdAt);
    const isNewArrival = createdAt && (createdAt.isAfter(ninetyDaysAgo) || createdAt.isSame(ninetyDaysAgo, "day"));
    const isRestockingSoon = !product.inStock && approvedPOProductIds.has(product.id || product.productId);

    // Dynamically extract gender from tags
    const gender = (product.tags || []).filter((t) => ["men", "women", "kids", "unisex"].includes(t.toLowerCase()));

    return {
      ...product,
      gender,
      isNewArrival: !!isNewArrival,
      isRestockingSoon: !!isRestockingSoon,
    };
  });
};

// ====================== Core Operations ======================

const DEFAULT_PRODUCT_TEMPLATE: Partial<Product> = {
  name: "",
  category: "",
  brand: "",
  description: "",
  thumbnail: { order: 0, url: "", file: "" },
  variants: [],
  weight: 0,
  buyingPrice: 0,
  sellingPrice: 0,
  marketPrice: 0,
  discount: 0,
  listing: true,
  status: true,
  tags: [],
  occasion: [],
  style: [],
  season: [],
  fit: "",
  material: "",
};

export const addProducts = async (product: Partial<Product>, file: File) => {
  const id = `p-${nanoid(8)}`.toLowerCase();
  const thumbnail = await uploadThumbnail(file, id);

  // Merge defaults to ensure no fields are dropped or left undefined in Firestore
  const mergedProduct = {
    ...DEFAULT_PRODUCT_TEMPLATE,
    ...product,
  };

  const allSizes = new Set<string>();
  (mergedProduct.variants || []).forEach((v) => v.sizes?.forEach((s) => allSizes.add(s)));

  // Sync tags with questionnaire fields (including gender)
  const finalTags = syncProductTags(mergedProduct, mergedProduct.tags || []);

  // Remove separate gender field from DB writes
  delete mergedProduct.gender;

  await productRepository.create(id, {
    ...mergedProduct,
    thumbnail,
    nameLower: mergedProduct.name?.toLowerCase(),
    tags: finalTags,
    availableSizes: Array.from(allSizes),
  });

  return await getProductById(id);
};

export const updateProduct = async (
  id: string,
  product: Partial<Product>,
  file?: File | null,
) => {
  const existingProduct = await productRepository.findById(id);

  // Prevent overwriting or corrupting system fields during update
  delete product.createdAt;
  delete product.updatedAt;
  delete product.id;
  delete product.productId;

  // Merge incoming updates with existing product data to ensure NO fields are dropped
  const mergedProduct = {
    ...DEFAULT_PRODUCT_TEMPLATE,
    ...(existingProduct || {}),
    ...product,
  };

  const allSizes = new Set<string>();
  (mergedProduct.variants || []).forEach((v) => v.sizes?.forEach((s) => allSizes.add(s)));

  let thumbnail = mergedProduct.thumbnail;
  if (file) {
    const oldPath = existingProduct?.thumbnail?.file;
    if (oldPath) {
      try { await BUCKET.file(oldPath).delete(); } catch (delError) { console.warn(`Failed to delete old thumbnail`, delError); }
    }
    thumbnail = await uploadThumbnail(file, id);
  }

  // Sync tags with questionnaire fields (including gender)
  const finalTags = syncProductTags(mergedProduct, mergedProduct.tags || []);

  // Remove separate gender field from DB writes
  delete mergedProduct.gender;

  await productRepository.update(id, {
    ...mergedProduct,
    thumbnail,
    nameLower: mergedProduct.name?.toLowerCase(),
    tags: finalTags,
    availableSizes: Array.from(allSizes),
  });

  return await getProductById(id);
};

/**
 * Syncs product attributes from questionnaire fields into the tags array
 */
const syncProductTags = (product: Partial<Product>, existingTags: string[] = []): string[] => {
  const tagSet = new Set<string>(existingTags.map(t => t.toLowerCase()));

  // Standard categorization fields
  if (product.brand) tagSet.add(product.brand.toLowerCase());
  if (product.category) tagSet.add(product.category.toLowerCase());

  // Questionnaire fields from ERP
  const attributes: (keyof any)[] = ["gender", "occasion", "style", "season", "fit", "material"];

  attributes.forEach(attr => {
    const val = (product as any)[attr];
    if (val) {
      const vals = Array.isArray(val) ? val : [val];
      vals.forEach((v: string) => {
        if (v && typeof v === "string") {
          tagSet.add(v.toLowerCase().trim());
        }
      });
    }
  });

  return Array.from(tagSet);
};

// ====================== Retrieval ======================

export const getProducts = async (
  pageNumber = 1,
  size = 20,
  search?: string,
  brand?: string,
  category?: string,
  status?: boolean,
  listing?: boolean,
) => {
  const { dataList, total, stats } = await productRepository.findAllPaginated({
    page: pageNumber, size, search, brand, category, status, listing,
  });

  const processed = dataList.map((p) => {
    // Dynamically derive gender from tags to keep ERP frontend completely intact
    const gender = (p.tags || []).filter((t) => ["men", "women", "kids", "unisex"].includes(t.toLowerCase()));
    return {
      ...p,
      gender,
      variants: p.variants.filter((v) => !v.isDeleted),
    };
  });

  return { dataList: processed, rowCount: total, stats };
};

export const getProductById = async (id: string): Promise<Product> => {
  const product = await productRepository.findById(id, true);
  if (!product) throw new AppError("Product not found", 404);
  
  // Dynamically derive gender from tags for the edit form modal
  const gender = (product.tags || []).filter((t) => ["men", "women", "kids", "unisex"].includes(t.toLowerCase()));

  return {
    ...product,
    gender,
    variants: (product.variants || []).filter((v) => !v.isDeleted),
  } as Product;
};

export const getPopularProducts = async (
  startDate: string,
  endDate: string,
  size: number,
): Promise<PopularItem[]> => {
  const startDay = parseToDayjs(startDate)?.startOf("day").toDate();
  const endDay = parseToDayjs(endDate)?.endOf("day").toDate();

  if (!startDay || !endDay) return [];

  const orders = await orderRepository.findPaidOrdersInDateRange(startDay, endDay);

  const itemsMap = new Map<string, number>();
  orders.forEach((order) => {
    if (order.items) {
      order.items.forEach((item) => {
        const count = itemsMap.get(item.itemId) || 0;
        itemsMap.set(item.itemId, count + item.quantity);
      });
    }
  });

  const sortedEntries = Array.from(itemsMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, size);
  const productIds = sortedEntries.map(([id]) => id);
  const products = await productRepository.findByIds(productIds);
  const productMap = new Map(products.map(p => [p.id, p]));

  return sortedEntries.map(([itemId, count]) => {
    const product = productMap.get(itemId);
    if (!product) return null;
    return { item: product as any, soldCount: count };
  }).filter(Boolean) as PopularItem[];
};

export const getHotProducts = async () => {
  const itemCount = await orderRepository.countOrdersByItem(100);
  const sortedItemIds = Object.entries(itemCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([itemId]) => itemId);
  if (sortedItemIds.length === 0) return [];

  const products = await productRepository.findByIds(sortedItemIds);
  const filtered = products.filter((p) => p.listing === true && p.status === true && !p.isDeleted);
  return enrichProductsWithLabels(filtered);
};

export const getDealsProducts = async (
  page: number = 1,
  size: number = 10,
  tags?: string[],
  inStock?: boolean,
  gender?: string,
  sizes?: string[],
) => {
  const result = await productRepository.findDiscounted({ page, size, tags, inStock, gender, sizes });
  const enriched = await enrichProductsWithLabels(result.dataList);
  return { ...result, dataList: enriched };
};

export const getDealsProductsFiltered = async (options: any) => {
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

// ====================== Stock & Sitemap ======================

export const getBatchProductStock = async (
  productId: string,
  variantId: string,
  sizes: string[],
): Promise<Record<string, number>> => {
  const settings = await settingsRepository.getEcommerceSettings();
  const stockId = settings?.stockId || settings?.onlineStockId || "MAIN";

  const results = await Promise.all(
    sizes.map(async (size) => ({
      size,
      quantity: await productRepository.getStock(productId, variantId, size, stockId),
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
    lastModified: getNowSL().toDate(),
    priority: 0.7,
  }));
};

export const getBrandForSitemap = async () => brandRepository.findForSitemap(process.env.WEB_BASE_URL || "");
export const getCategoriesForSitemap = async () => categoryRepository.findForSitemap(process.env.WEB_BASE_URL || "");
export const getPaymentMethods = async () => settingsRepository.findPaymentMethodsForWebsite();

export const getProductDropdown = async () => {
  const { dataList } = await productRepository.findAllPaginated({ size: 1000, status: true, listing: true });
  return dataList.map(p => ({
    id: p.id, label: p.name, buyingPrice: p.buyingPrice || 0, sellingPrice: p.sellingPrice || 0,
    variants: p.variants || [], availableSizes: p.availableSizes || [],
    thumbnail: p.thumbnail, brand: p.brand, category: p.category,
  }));
};

export const getProductStock = async (productId: string, variantId: string, size: string) => {
  const settings = await settingsRepository.getEcommerceSettings();
  const stockId = settings?.stockId || settings?.onlineStockId || "MAIN";
  return productRepository.getStock(productId, variantId, size, stockId);
};

export const deleteProduct = async (id: string): Promise<void> => {
  await productRepository.delete(id);
};

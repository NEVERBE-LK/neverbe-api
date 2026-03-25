import { adminFirestore, adminStorageBucket } from "@/firebase/firebaseAdmin";
import { Product } from "@/model/Product";
import { ProductVariant } from "@/model/ProductVariant";
import { nanoid } from "nanoid";
import { FieldValue } from "firebase-admin/firestore";
import { toSafeLocaleString } from "./UtilService";
import { Order } from "@/model/Order";
import { PopularItem } from "@/model/PopularItem";
import { Timestamp } from "firebase-admin/firestore";
import { searchProducts } from "./AlgoliaService";
import { AppError } from "@/utils/apiResponse";
import { uploadCompressedImage } from "./StorageService";

const PRODUCTS_COLLECTION = "products";
const BUCKET = adminStorageBucket;
const uploadThumbnail = async (
  file: File,
  id: string,
): Promise<Product["thumbnail"]> => {
  const filePath = `products/${id}/thumbnail/thumb_${Date.now()}.webp`;
  const url = await uploadCompressedImage(file, filePath);

  return {
    url: url,
    file: filePath,
    order: 0,
  };
};

// ... (previous code)

/**
 * Adds a new product to Firestore, now including generated keywords.
 * UPDATED to await generateTags
 */
export const addProducts = async (product: Partial<Product>, file: File) => {
  const id = `p-${nanoid(8)}`.toLowerCase();

  // 1. Upload thumbnail
  const thumbnail = await uploadThumbnail(file, id);

  // Build tags from brand and category (no AI)
  const tags: string[] = [];
  if (product.brand) tags.push(product.brand.toLowerCase());
  if (product.category) tags.push(product.category.toLowerCase());

  // Denormalize sizes from variants for search
  const allSizes = new Set<string>();
  (product.variants || []).forEach((v) =>
    v.sizes?.forEach((s) => allSizes.add(s)),
  );

  const newProductDocument: any = {
    ...(product as Product), // Cast after filling required fields
    id: id,
    productId: id,
    thumbnail: thumbnail,
    nameLower: product.name?.toLowerCase(),
    tags: tags,
    gender: product.gender || [],
    availableSizes: Array.from(allSizes),
    isDeleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await adminFirestore
    .collection(PRODUCTS_COLLECTION)
    .doc(id)
    .set(newProductDocument);

  const doc = await adminFirestore.collection(PRODUCTS_COLLECTION).doc(id).get();
  return { id: doc.id, productId: doc.id, ...(doc.data() as Product) };
};

/**
 * Update product - removed AI tags, added gender and availableSizes
 */
export const updateProduct = async (
  id: string,
  product: Partial<Product>,
  file?: File | null,
) => {
  // Build tags from brand and category (no AI)
  const tags: string[] = [];
  if (product.brand) tags.push(product.brand.toLowerCase());
  if (product.category) tags.push(product.category.toLowerCase());

  // Denormalize sizes from variants for search
  const allSizes = new Set<string>();
  (product.variants || []).forEach((v) =>
    v.sizes?.forEach((s) => allSizes.add(s)),
  );

  let thumbnail = product.thumbnail;

  if (file) {
    const oldProduct = await getProductById(id);
    // getProductById now throws if not found, so we are safe.
    const oldPath = oldProduct?.thumbnail?.file;
    if (oldPath) {
      try {
        await BUCKET.file(oldPath).delete();
      } catch (delError) {
        console.warn(`Failed to delete old thumbnail: ${oldPath}`, delError);
      }
    }
    thumbnail = await uploadThumbnail(file, id);
  }

  const updatedProductDocument = {
    name: product.name,
    category: product.category,
    brand: product.brand,
    description: product.description,
    buyingPrice: product.buyingPrice,
    sellingPrice: product.sellingPrice,
    marketPrice: product.marketPrice,
    discount: product.discount,
    listing: product.listing,
    weight: product.weight,
    variants: product.variants,
    status: product.status,
    thumbnail: thumbnail,
    nameLower: product.name?.toLowerCase(),
    tags: tags,
    gender: product.gender || [],
    availableSizes: Array.from(allSizes),
    updatedAt: new Date(),
  };

  await adminFirestore
    .collection(PRODUCTS_COLLECTION)
    .doc(id)
    .set(updatedProductDocument, { merge: true }); // Use set with merge

  const doc = await adminFirestore.collection(PRODUCTS_COLLECTION).doc(id).get();
  return { id: doc.id, productId: doc.id, ...(doc.data() as Product) };
};

export const getProducts = async (
  pageNumber = 1,
  size = 20,
  search?: string,
  brand?: string,
  category?: string,
  status?: boolean,
  listing?: boolean,
): Promise<{ dataList: Omit<Product, "isDeleted">[]; rowCount: number }> => {
  try {
    const filters: string[] = ["isDeleted:false"];

    if (brand) filters.push(`brand:"${brand}"`);
    if (category) filters.push(`category:"${category}"`);
    if (typeof status === "boolean") filters.push(`status:${status}`);
    if (typeof listing === "boolean") filters.push(`listing:${listing}`);

    const { hits, nbHits } = await searchProducts(search || "", {
      page: pageNumber - 1,
      hitsPerPage: size,
      filters: filters.join(" AND "),
    });

    const products = hits.map((hit: any) => {
      const activeVariants = (hit.variants || []).filter(
        (v: ProductVariant & { isDeleted?: boolean }) => !v.isDeleted,
      );

      return {
        ...hit,
        productId: hit.objectID || hit.id,
        variants: activeVariants,
        createdAt: hit.createdAt, // Switched to raw as per previous refinement logic
        updatedAt: hit.updatedAt,
      } as Omit<Product, "isDeleted">;
    });

    return { dataList: products, rowCount: nbHits };
  } catch (error) {
    console.error("Get Products Error:", error);
    throw error;
  }
};

export const getProductById = async (id: string): Promise<Product> => {
  const docSnap = await adminFirestore
    .collection(PRODUCTS_COLLECTION)
    .doc(id)
    .get();
  if (!docSnap.exists || docSnap.data()?.isDeleted) {
    throw new AppError("Product not found", 404);
  }

  const data = docSnap.data() as any;
  const activeVariants = (data.variants || []).filter(
    (v: ProductVariant & { isDeleted?: boolean }) => !v.isDeleted,
  );

  return {
    ...data,
    productId: docSnap.id,
    variants: activeVariants,
  } as Product;
};

// Get product dropdown for active products
export const getProductDropdown = async () => {
  try {
    const snapshot = await adminFirestore
      .collection(PRODUCTS_COLLECTION)
      .where("isDeleted", "==", false)
      .where("status", "==", true)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        label: data.name,
        buyingPrice: data.buyingPrice || 0,
        variants: data.variants || [],
        availableSizes: data.availableSizes || [],
      };
    });
  } catch (error) {
    console.error("Get Product Dropdown Error:", error);
    throw error;
  }
};

export const getPopularProducts = async (
  startDate: string,
  endDate: string,
  size: number,
): Promise<PopularItem[]> => {
  try {
    // Construct dates using the explicit year provided
    const startDay = new Date(startDate);

    // Setting day to 0 of (month + 1) gets the last day of the target month
    const endDay = new Date(endDate);

    startDay.setHours(0, 0, 0, 0);
    endDay.setHours(23, 59, 59, 999);

    console.log(`Fetching popular items from ${startDay} to ${endDay}`);

    const startTimestamp = Timestamp.fromDate(startDay);
    const endTimestamp = Timestamp.fromDate(endDay);

    // Query orders within the exact start and end timestamps
    const orders = await adminFirestore
      .collection("orders")
      .where("paymentStatus", "==", "Paid")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .get();

    console.log(`Fetched ${orders.size} orders`);

    const itemsMap = new Map<string, number>();

    orders.forEach((doc) => {
      const order = doc.data() as Order;
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const count = itemsMap.get(item.itemId) || 0;
          itemsMap.set(item.itemId, count + item.quantity);
        });
      }
    });

    console.log(`Fetched ${itemsMap.size} unique items sold`);

    // Sort by sales count (descending) and take top 'size' items
    const sortedEntries = Array.from(itemsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, size);

    const popularItems: PopularItem[] = [];

    // Fetch product details for the top items only
    await Promise.all(
      sortedEntries.map(async ([itemId, count]) => {
        try {
          const productDoc = await adminFirestore
            .collection("products")
            .doc(itemId)
            .get();

          if (productDoc.exists) {
            const itemData = productDoc.data() as Product;
            const itemWithStrings = {
              ...itemData,
              createdAt: toSafeLocaleString(itemData.createdAt),
              updatedAt: toSafeLocaleString(itemData.updatedAt),
            } as any;

            popularItems.push({
              item: itemWithStrings,
              soldCount: count,
            });
          }
        } catch (err) {
          console.error(`Failed to fetch product details for ${itemId}`, err);
        }
      }),
    );

    console.log(`Returning ${popularItems.length} popular items`);

    // Ensure final array is sorted by count (Promise.all might mix order)
    return popularItems.sort((a, b) => b.soldCount - a.soldCount);
  } catch (e) {
    console.error("Error getting popular products:", e);
    throw e;
  }
};

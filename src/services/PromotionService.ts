import { adminFirestore, adminStorageBucket } from "@/firebase/firebaseAdmin";
import { Promotion, ProductVariantTarget } from "@/model/Promotion";
import { Coupon } from "@/model/Coupon";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import { toSafeLocaleString } from "./UtilService";
import { AppError } from "@/utils/apiResponse";
import { uploadCompressedImage } from "./StorageService";
import { searchPromotions, searchCoupons } from "./AlgoliaService";

const PROMOTIONS_COLLECTION = "promotions";

const COUPONS_COLLECTION = "coupons";
const COUPON_USAGE_COLLECTION = "coupon_usage";
const BUCKET = adminStorageBucket;

const uploadBanner = async (file: File, id: string): Promise<string> => {
  const filePath = `promotions/${id}/banner/banner_${Date.now()}.webp`;
  const url = await uploadCompressedImage(file, filePath);
  return url;
};

// --- PROMOTIONS CRUD ---

export const getPromotions = async (
  pageNumber: number = 1,
  size: number = 20,
  filterStatus?: string,
  search?: string,
  type?: string,
): Promise<{ dataList: Promotion[]; rowCount: number }> => {
  try {
    const filters: string[] = ["isDeleted:false"];

    if (filterStatus && filterStatus !== "all") {
      filters.push(
        `isActive:${filterStatus === "ACTIVE" || filterStatus === "true"}`,
      );
    }

    if (type && type !== "all") {
      filters.push(`type:"${type}"`);
    }

    const { hits, nbHits } = await searchPromotions(search || "", {
      page: pageNumber - 1,
      hitsPerPage: size,
      filters: filters.join(" AND "),
    });

    const dataList = hits.map((hit: any) => ({
      ...hit,
      id: hit.objectID || hit.id,
      startDate: toSafeLocaleString(hit.startDate) || "",
      endDate: toSafeLocaleString(hit.endDate) || "",
      createdAt: toSafeLocaleString(hit.createdAt) || "",
      updatedAt: toSafeLocaleString(hit.updatedAt) || "",
    })) as Promotion[];

    return { dataList, rowCount: nbHits };
  } catch (error) {
    console.error("Error getting promotions:", error);
    throw error;
  }
};

export const createPromotion = async (
  data: Omit<Promotion, "id" | "updatedAt" | "createdAt" | "usageCount">,
  file?: File | null,
): Promise<Promotion> => {
  const docId = `promo-${nanoid(10)}`;
  const now = FieldValue.serverTimestamp();

  let bannerUrl = data.bannerUrl;
  if (file) {
    bannerUrl = await uploadBanner(file, docId);
  }


  const newPromo = {
    ...data,
    bannerUrl,
    startDate: data.startDate ? new Date(data.startDate as any) : null,
    endDate: data.endDate ? new Date(data.endDate as any) : null,
    usageCount: 0,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };

  await adminFirestore
    .collection(PROMOTIONS_COLLECTION)
    .doc(docId)
    .set(newPromo);

  return { id: docId, ...newPromo } as unknown as Promotion;
};

export const updatePromotion = async (
  id: string,
  data: Partial<Promotion>,
  file?: File | null,
): Promise<Promotion> => {
  const docRef = adminFirestore.collection(PROMOTIONS_COLLECTION).doc(id);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    throw new AppError(`Promotion with ID ${id} not found`, 404);
  }

  const { createdAt, ...updateData } = data;

  console.log("Updating Promotion ID:", id, "With Data:", updateData);


  const payload: any = {
    ...updateData,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (file) {
    const bannerUrl = await uploadBanner(file, id);
    payload.bannerUrl = bannerUrl;
  }

  if (updateData.startDate) {
    payload.startDate = new Date(updateData.startDate as any);
  }
  if (updateData.endDate) {
    payload.endDate = new Date(updateData.endDate as any);
  }

  await docRef.update(payload);
  const updatedDoc = await docRef.get();
  return { id: updatedDoc.id, ...updatedDoc.data() } as Promotion;
};

export const deletePromotion = async (id: string): Promise<{ id: string }> => {
  const docRef = adminFirestore.collection(PROMOTIONS_COLLECTION).doc(id);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    throw new AppError(`Promotion with ID ${id} not found`, 404);
  }

  await docRef.update({
    isDeleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id };
};

export const getPromotionById = async (id: string): Promise<Promotion> => {
  try {
    const doc = await adminFirestore
      .collection(PROMOTIONS_COLLECTION)
      .doc(id)
      .get();
    if (!doc.exists) {
      throw new AppError("Promotion not found", 404);
    }
    return { id: doc.id, ...doc.data() } as Promotion;
  } catch (error) {
    console.error("Error getting promotion by ID:", error);
    throw error;
  }
};

export const updateCoupon = async (
  id: string,
  data: Partial<Coupon>,
): Promise<Coupon> => {
  const docRef = adminFirestore.collection(COUPONS_COLLECTION).doc(id);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    throw new AppError(`Coupon with ID ${id} not found`, 404);
  }

  // Remove createdAt to prevent overwriting with malformed data
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdAt, ...updateData } = data;

  const payload: any = {
    ...updateData,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (updateData.startDate) {
    payload.startDate = new Date(updateData.startDate as any);
  }
  if (updateData.endDate) {
    payload.endDate = new Date(updateData.endDate as any);
  }

  await docRef.update(payload);
  const updatedDoc = await docRef.get();
  return { id: updatedDoc.id, ...updatedDoc.data() } as Coupon;
};

export const deleteCoupon = async (id: string): Promise<{ id: string }> => {
  const docRef = adminFirestore.collection(COUPONS_COLLECTION).doc(id);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    throw new AppError(`Coupon with ID ${id} not found`, 404);
  }

  await docRef.update({
    isDeleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id };
};

export const getCouponByCode = async (code: string): Promise<Coupon | null> => {
  const snapshot = await adminFirestore
    .collection(COUPONS_COLLECTION)
    .where("code", "==", code)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as Coupon;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _, ...rest } = data;
  return {
    id: doc.id,
    ...rest,
    startDate: toSafeLocaleString(data.startDate) || "",
    endDate: toSafeLocaleString(data.endDate) || "",
    createdAt: toSafeLocaleString(data.createdAt) || "",
    updatedAt: toSafeLocaleString(data.updatedAt) || "",
  } as Coupon;
};

export const getCoupons = async (
  pageNumber: number = 1,
  size: number = 20,
  filterStatus?: string,
  search?: string,
): Promise<{ dataList: Coupon[]; rowCount: number }> => {
  try {
    const filters: string[] = ["isDeleted:false"];

    if (filterStatus && filterStatus !== "all") {
      filters.push(
        `isActive:${filterStatus === "ACTIVE" || filterStatus === "true"}`,
      );
    }

    const { hits, nbHits } = await searchCoupons(search || "", {
      page: pageNumber - 1,
      hitsPerPage: size,
      filters: filters.join(" AND "),
    });

    const dataList = hits.map((hit: any) => ({
      ...hit,
      id: hit.objectID || hit.id,
      startDate: toSafeLocaleString(hit.startDate) || "",
      endDate: toSafeLocaleString(hit.endDate) || "",
      createdAt: toSafeLocaleString(hit.createdAt) || "",
      updatedAt: toSafeLocaleString(hit.updatedAt) || "",
    })) as Coupon[];

    return { dataList, rowCount: nbHits };
  } catch (error) {
    console.error("Error getting coupons:", error);
    throw error;
  }
};

export const createCoupon = async (
  data: Omit<Coupon, "id" | "createdAt" | "updatedAt" | "usageCount">,
): Promise<Coupon> => {
  try {
    const id = nanoid(10);
    const now = FieldValue.serverTimestamp();

    const newCoupon = {
      ...data,
      id,
      usageCount: 0,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };

    await adminFirestore.collection(COUPONS_COLLECTION).doc(id).set(newCoupon);

    return {
      ...newCoupon,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Coupon;
  } catch (error) {
    console.error("Error creating coupon:", error);
    throw error;
  }
};

interface CartItem {
  productId: string;
  variantId?: string;
  quantity: number;
  price: number;
  discount?: number;
}

/**
 * Check if cart items are eligible based on variant-level targeting.
 * Returns true if at least one cart item matches the targeting rules.
 */
const checkVariantEligibility = (
  cartItems: CartItem[],
  targets: ProductVariantTarget[],
): boolean => {
  if (!targets || targets.length === 0) {
    return true; // No variant restrictions, all products allowed
  }

  for (const target of targets) {
    const matchingCartItems = cartItems.filter(
      (item) => item.productId === target.productId,
    );

    if (matchingCartItems.length === 0) {
      continue; // This target product is not in cart
    }

    // Check variant mode
    if (target.variantMode === "ALL_VARIANTS") {
      return true; // Any variant of this product qualifies
    }

    if (target.variantMode === "SPECIFIC_VARIANTS" && target.variantIds) {
      // Check if any cart item has a matching variant
      const hasMatchingVariant = matchingCartItems.some(
        (item) => item.variantId && target.variantIds!.includes(item.variantId),
      );
      if (hasMatchingVariant) {
        return true;
      }
    }
  }

  return false; // No matching products/variants found
};

/**
 * Get cart items that match variant-level targeting for discount calculation.
 */
const getEligibleCartItems = (
  cartItems: CartItem[],
  targets: ProductVariantTarget[],
): CartItem[] => {
  if (!targets || targets.length === 0) {
    return cartItems; // All items eligible
  }

  return cartItems.filter((item) => {
    const target = targets.find((t) => t.productId === item.productId);
    if (!target) return false;

    if (target.variantMode === "ALL_VARIANTS") {
      return true;
    }

    if (target.variantMode === "SPECIFIC_VARIANTS" && target.variantIds) {
      return item.variantId && target.variantIds.includes(item.variantId);
    }

    return false;
  });
};

/**
 * Validates a coupon against the current cart and user context.
 */
export const validateCoupon = async (
  code: string,
  userId: string | null,
  cartTotal: number,
  cartItems: CartItem[],
): Promise<{
  valid: boolean;
  discount: number;
  message?: string;
  coupon?: Coupon;
}> => {
  const coupon = await getCouponByCode(code);

  if (!coupon) {
    return { valid: false, discount: 0, message: "Invalid coupon code" };
  }

  // 1. Status Check
  if (coupon.isActive !== true) {
    return { valid: false, discount: 0, message: "Coupon is not active" };
  }

  // 2. Date Check
  const now = new Date();
  const startDate =
    coupon.startDate instanceof Timestamp
      ? coupon.startDate.toDate()
      : new Date(coupon.startDate as string);
  const endDate = coupon.endDate
    ? coupon.endDate instanceof Timestamp
      ? coupon.endDate.toDate()
      : new Date(coupon.endDate as string)
    : null;

  if (now < startDate) {
    return { valid: false, discount: 0, message: "Coupon has not started yet" };
  }
  if (endDate && now > endDate) {
    return { valid: false, discount: 0, message: "Coupon has expired" };
  }

  // 3. Usage Limits
  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, discount: 0, message: "Coupon usage limit reached" };
  }

  // 4. User Restriction
  if (coupon.restrictedToUsers && coupon.restrictedToUsers.length > 0) {
    if (!userId || !coupon.restrictedToUsers.includes(userId)) {
      return {
        valid: false,
        discount: 0,
        message: "This coupon is not valid for your account",
      };
    }
  }

  // 5. Per User Limit (Requires checking Usage History - skipped for now unless user provides usage history)
  if (userId && coupon.perUserLimit) {
    const userUsageCount = await getUserCouponUsageCount(coupon.id, userId);
    if (userUsageCount >= coupon.perUserLimit) {
      return {
        valid: false,
        discount: 0,
        message: "You have already used this coupon",
      };
    }
  }

  // 6. Minimum Order Amount
  if (coupon.minOrderAmount && cartTotal < coupon.minOrderAmount) {
    return {
      valid: false,
      discount: 0,
      message: `Minimum order amount of Rs. ${coupon.minOrderAmount.toLocaleString()} required`,
    };
  }

  // 7. Minimum Quantity Check
  if (coupon.minQuantity) {
    const totalQuantity = cartItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    if (totalQuantity < coupon.minQuantity) {
      return {
        valid: false,
        discount: 0,
        message: `Minimum ${coupon.minQuantity} items required to use this coupon`,
      };
    }
  }

  // 8a. Variant-Level Products Check (new)
  if (
    coupon.applicableProductVariants &&
    coupon.applicableProductVariants.length > 0
  ) {
    const variantEligible = checkVariantEligibility(
      cartItems,
      coupon.applicableProductVariants,
    );
    if (!variantEligible) {
      return {
        valid: false,
        discount: 0,
        // @ts-ignore - Adding restricted property to return type dynamically
        restricted: true,
        message:
          "This coupon is not valid for the product variants in your cart",
      };
    }
  }

  // 8b. Applicable Products Check (legacy - product-level only)
  if (
    coupon.applicableProducts &&
    coupon.applicableProducts.length > 0 &&
    (!coupon.applicableProductVariants ||
      coupon.applicableProductVariants.length === 0)
  ) {
    const hasApplicableProduct = cartItems.some((item) =>
      coupon.applicableProducts!.includes(item.productId),
    );
    if (!hasApplicableProduct) {
      return {
        valid: false,
        discount: 0,
        // @ts-ignore
        restricted: true,
        message: "This coupon is not valid for items in your cart",
      };
    }
  }

  // 9. Applicable Categories Check
  if (coupon.applicableCategories && coupon.applicableCategories.length > 0) {
    // Get product details to check categories
    const productIds = cartItems.map((item) => item.productId);
    const productsSnapshot = await adminFirestore
      .collection("products")
      .where("__name__", "in", productIds.slice(0, 10)) // Firestore 'in' limit is 10
      .get();

    const productCategories = productsSnapshot.docs.map(
      (doc) => doc.data().category,
    );
    const hasApplicableCategory = productCategories.some((cat) =>
      coupon.applicableCategories!.includes(cat),
    );

    if (!hasApplicableCategory) {
      return {
        valid: false,
        discount: 0,
        // @ts-ignore
        restricted: true,
        message: "This coupon is not valid for the categories in your cart",
      };
    }
  }

  // 10. Excluded Products Check
  if (coupon.excludedProducts && coupon.excludedProducts.length > 0) {
    const allExcluded = cartItems.every((item) =>
      coupon.excludedProducts!.includes(item.productId),
    );
    if (allExcluded) {
      return {
        valid: false,
        discount: 0,
        message: "This coupon cannot be applied to the items in your cart",
      };
    }
  }

  // 11. First Order Only Check
  if (coupon.firstOrderOnly) {
    if (!userId) {
      return {
        valid: false,
        discount: 0,
        message: "Please sign in to use this coupon",
      };
    }
    const ordersSnapshot = await adminFirestore
      .collection("orders")
      .where("userId", "==", userId)
      .where("status", "!=", "CANCELLED")
      .limit(1)
      .get();
    if (!ordersSnapshot.empty) {
      return {
        valid: false,
        discount: 0,
        message: "This coupon is only valid for first-time orders",
      };
    }
  }

  // 12. Calculate Discount
  let discountAmount = 0;
  if (coupon.discountType === "FIXED") {
    discountAmount = coupon.discountValue;
  } else if (coupon.discountType === "PERCENTAGE") {
    // Calculate applicable total respecting targeting and exclusions
    let applicableTotal = cartTotal;
    let eligibleItems = cartItems;

    // If variant-level targeting is specified, use that first
    if (
      coupon.applicableProductVariants &&
      coupon.applicableProductVariants.length > 0
    ) {
      eligibleItems = getEligibleCartItems(
        cartItems,
        coupon.applicableProductVariants,
      );
      applicableTotal = eligibleItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
    }
    // Fallback to legacy product-level targeting
    else if (
      coupon.applicableProducts &&
      coupon.applicableProducts.length > 0
    ) {
      eligibleItems = cartItems.filter((item) =>
        coupon.applicableProducts!.includes(item.productId),
      );
      applicableTotal = eligibleItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
    }

    // Exclude excluded products from discount calculation
    if (coupon.excludedProducts && coupon.excludedProducts.length > 0) {
      const excludedTotal = eligibleItems
        .filter((item) => coupon.excludedProducts!.includes(item.productId))
        .reduce((sum, item) => sum + item.price * item.quantity, 0);
      applicableTotal = applicableTotal - excludedTotal;
    }

    discountAmount = (applicableTotal * coupon.discountValue) / 100;
    if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
      discountAmount = coupon.maxDiscount;
    }
  } else if (coupon.discountType === "FREE_SHIPPING") {
    // Logic for free shipping usually handled separately or returns specific flag
    // Here we act as if shipping cost is separate, so maybe discount is 0 on cartItems but flag is set
    // For simplicity, returning 0 discount value but valid coupon
    discountAmount = 0;
  }

  return { valid: true, discount: discountAmount, coupon };
};

/**
 * Helper to check how many times a user used a coupon.
 */
const getUserCouponUsageCount = async (
  couponId: string,
  userId: string,
): Promise<number> => {
  const snapshot = await adminFirestore
    .collection(COUPON_USAGE_COLLECTION)
    .where("couponId", "==", couponId)
    .where("userId", "==", userId)
    .count()
    .get();
  return snapshot.data().count;
};

/**
 * Tracks the usage of a coupon after a successful order.
 */
export const trackCouponUsage = async (
  couponId: string,
  userId: string,
  orderId: string,
  discountApplied: number,
) => {
  const usageRef = adminFirestore.collection(COUPON_USAGE_COLLECTION).doc();
  await usageRef.set({
    id: usageRef.id,
    couponId,
    userId,
    orderId,
    discountApplied,
    usedAt: FieldValue.serverTimestamp(),
  });

  // Increment global usage count atomically
  await adminFirestore
    .collection(COUPONS_COLLECTION)
    .doc(couponId)
    .update({
      usageCount: FieldValue.increment(1),
    });
};

/**
 * Result of cart discount calculation supporting both single and stacked promotions
 */
interface CartDiscountResult {
  // New stacking support
  promotions: Promotion[]; // All applied promotions
  totalDiscount: number; // Combined discount from all promotions

  // Legacy fields for backward compatibility
  promotion?: Promotion; // First/primary promotion
  discount: number; // Same as totalDiscount
}

/**
 * Calculates the cart discount, supporting stacking for promotions marked as stackable.
 *
 * Stacking Logic:
 * 1. All eligible promotions are sorted by priority (high to low)
 * 2. If the highest-priority eligible promotion is NOT stackable, only that one applies
 * 3. If the highest-priority eligible promotion IS stackable, all stackable promotions are combined
 * 4. Discounts are summed (each respecting its own maxDiscount cap if percentage-based)
 */
export const calculateCartDiscount = async (
  cartItems: CartItem[],
  cartTotal: number,
  userId?: string | null,
): Promise<CartDiscountResult> => {
  // Fetch ACTIVE promotions (excluding soft-deleted)
  const promotionsSnap = await adminFirestore
    .collection(PROMOTIONS_COLLECTION)
    .where("isActive", "==", true)
    .where("isDeleted", "!=", true)
    .get();

  const promotions = promotionsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as Promotion,
  );

  // Sort by priority (high to low)
  promotions.sort((a, b) => b.priority - a.priority);

  const now = new Date();
  const eligiblePromotions: { promo: Promotion; discount: number }[] = [];

  console.log(
    `[PromotionService] Found ${promotions.length} active promotions`,
  );

  for (const promo of promotions) {
    console.log(
      `[PromotionService] Checking promo: ${promo.id} (${promo.name})`,
    );

    // Date Checks
    const startDate =
      promo.startDate instanceof Timestamp
        ? promo.startDate.toDate()
        : new Date(promo.startDate as string);
    const endDate =
      promo.endDate instanceof Timestamp
        ? promo.endDate.toDate()
        : new Date(promo.endDate as string);

    if (now < startDate) {
      console.log(
        `[PromotionService] Skipped ${promo.id}: Not started (Starts: ${startDate})`,
      );
      continue;
    }
    if (now > endDate) {
      console.log(
        `[PromotionService] Skipped ${promo.id}: Expired (Ends: ${endDate})`,
      );
      continue;
    }

    // Check variant-level targeting first (if defined)
    if (
      promo.applicableProductVariants &&
      promo.applicableProductVariants.length > 0
    ) {
      const variantEligible = checkVariantEligibility(
        cartItems,
        promo.applicableProductVariants,
      );
      if (!variantEligible) {
        console.log(
          `[PromotionService] Skipped ${promo.id}: Variant eligibility check failed`,
        );
        continue;
      }
    } else if (
      promo.applicableProducts &&
      promo.applicableProducts.length > 0
    ) {
      // Legacy applicableProducts eligibility check
      const hasApplicableProduct = cartItems.some((item) =>
        promo.applicableProducts!.includes(item.productId),
      );
      if (!hasApplicableProduct) {
        console.log(
          `[PromotionService] Skipped ${promo.id}: Applicable products check failed`,
        );
        continue;
      }
    }

    // Condition Checks
    let conditionsMet = true;

    // Collect all SPECIFIC_PRODUCT values into one array for easier checking (Frontend parity)
    const specificProductIds: string[] = [];
    if (promo.conditions) {
      promo.conditions.forEach((condition: any) => {
        if (condition.type === "SPECIFIC_PRODUCT") {
          if (condition.value) specificProductIds.push(condition.value);
          if (condition.productIds)
            specificProductIds.push(...condition.productIds);
        }
      });
    }

    if (promo.conditions) {
      for (const condition of promo.conditions) {
        if (condition.type === "MIN_AMOUNT") {
          if (cartTotal < Number(condition.value)) {
            console.log(
              `[PromotionService] Condition Failed ${promo.id}: MIN_AMOUNT ${cartTotal} < ${condition.value}`,
            );
            conditionsMet = false;
          }
        } else if (condition.type === "MIN_QUANTITY") {
          // If there are specific products, count only those, otherwise count all (Frontend parity)
          const applicableItems =
            specificProductIds.length > 0
              ? cartItems.filter((item) =>
                specificProductIds.includes(item.productId),
              )
              : cartItems;

          const totalQty = applicableItems.reduce(
            (sum, item) => sum + item.quantity,
            0,
          );
          if (totalQty < Number(condition.value)) {
            console.log(
              `[PromotionService] Condition Failed ${promo.id}: MIN_QUANTITY ${totalQty} < ${condition.value}`,
            );
            conditionsMet = false;
          }
        } else if (condition.type === "SPECIFIC_PRODUCT") {
          // Check variant restrictions if defined
          if (
            condition.variantMode === "SPECIFIC_VARIANTS" &&
            condition.variantIds
          ) {
            const productId = condition.value as string;
            const productIds = condition.productIds || [productId];

            const hasMatchingVariant = cartItems.some(
              (item) =>
                productIds.includes(item.productId) &&
                item.variantId &&
                condition.variantIds!.includes(item.variantId),
            );
            if (!hasMatchingVariant) {
              console.log(
                `[PromotionService] Condition Failed ${promo.id}: SPECIFIC_VARIANTS not found`,
              );
              // NOTE: Frontend treats variant checks strictly if they exist on the condition being iterated.
              // However, for pure product IDs, it effectively uses the aggregated list.
              // If we have mixed strict-variant and loose-product conditions, this might be tricky.
              // Given the logs, the failing conditions are simple product checks.

              // If this condition failed strict variant check, we fail.
              conditionsMet = false;
            }
          } else {
            // General product check - use the aggregated list (OR logic)
            // Frontend: if (specificProductIds.length > 0) return items.some(...)
            const hasProduct = cartItems.some((item) =>
              specificProductIds.includes(item.productId),
            );

            if (!hasProduct) {
              console.log(
                `[PromotionService] Condition Failed ${promo.id}: SPECIFIC_PRODUCT not found (checked aggregated list)`,
              );
              conditionsMet = false;
            }
          }
        } else if (condition.type === "CUSTOMER_TAG") {
          // Validate customer has required tag
          if (!userId) {
            console.log(
              `[PromotionService] Condition Failed ${promo.id}: CUSTOMER_TAG requires authenticated user`,
            );
            conditionsMet = false;
          } else {
            try {
              const userDoc = await adminFirestore
                .collection("users")
                .doc(userId)
                .get();

              if (!userDoc.exists) {
                console.log(
                  `[PromotionService] Condition Failed ${promo.id}: User ${userId} not found`,
                );
                conditionsMet = false;
              } else {
                const userData = userDoc.data();
                const customerTags = userData?.tags || [];
                const requiredTag = condition.value as string;

                if (!customerTags.includes(requiredTag)) {
                  console.log(
                    `[PromotionService] Condition Failed ${promo.id}: Customer missing tag "${requiredTag}"`,
                  );
                  conditionsMet = false;
                } else {
                  console.log(
                    `[PromotionService] CUSTOMER_TAG validated for ${promo.id}: Customer has tag "${requiredTag}"`,
                  );
                }
              }
            } catch (error) {
              console.error(
                `[PromotionService] Error checking CUSTOMER_TAG for ${promo.id}:`,
                error,
              );
              conditionsMet = false;
            }
          }
        }
      }
    }

    if (!conditionsMet) {
      console.log(`[PromotionService] Skipped ${promo.id}: Conditions not met`);
      continue;
    }

    // Calculate Discount for this promo
    let currentDiscount = 0;
    const action = promo.actions[0]; // Assuming single action for now

    // Get eligible cart items for discount calculation
    let eligibleItems = cartItems;

    if (
      promo.applicableProductVariants &&
      promo.applicableProductVariants.length > 0
    ) {
      eligibleItems = getEligibleCartItems(
        cartItems,
        promo.applicableProductVariants,
      );
    } else if (specificProductIds.length > 0) {
      // Filter by SPECIFIC_PRODUCT conditions
      eligibleItems = cartItems.filter((item) =>
        specificProductIds.includes(item.productId),
      );
    } else if (
      promo.applicableProducts &&
      promo.applicableProducts.length > 0
    ) {
      // Fallback for legacy applicableProducts
      eligibleItems = cartItems.filter((item) =>
        promo.applicableProducts!.includes(item.productId),
      );
    }

    if (promo.excludedProducts && promo.excludedProducts.length > 0) {
      eligibleItems = eligibleItems.filter(
        (item) => !promo.excludedProducts!.includes(item.productId),
      );
    }

    const eligibleTotal = eligibleItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    if (action.type === "PERCENTAGE_OFF") {
      currentDiscount = (eligibleTotal * action.value) / 100;
      if (action.maxDiscount && currentDiscount > action.maxDiscount) {
        currentDiscount = action.maxDiscount;
      }
    } else if (action.type === "FIXED_OFF") {
      currentDiscount = action.value;
    }

    if (currentDiscount > 0) {
      console.log(
        `[PromotionService] Eligible ${promo.id}: Discount ${currentDiscount}`,
      );
      eligiblePromotions.push({ promo, discount: currentDiscount });
    } else {
      console.log(`[PromotionService] Skipped ${promo.id}: Discount was 0`);
    }
  }

  // No eligible promotions
  if (eligiblePromotions.length === 0) {
    return {
      promotions: [],
      totalDiscount: 0,
      promotion: undefined,
      discount: 0,
    };
  }

  // Check the highest-priority eligible promotion
  const firstEligible = eligiblePromotions[0];

  // If the first (highest priority) promotion is NOT stackable, return only that one
  if (!firstEligible.promo.stackable) {
    return {
      promotions: [firstEligible.promo],
      totalDiscount: firstEligible.discount,
      promotion: firstEligible.promo,
      discount: firstEligible.discount,
    };
  }

  // First promotion IS stackable - collect all stackable promotions
  const stackedPromotions: Promotion[] = [];
  let totalDiscount = 0;

  for (const { promo, discount } of eligiblePromotions) {
    if (promo.stackable) {
      stackedPromotions.push(promo);
      totalDiscount += discount;
    }
  }

  // Return stacked results
  return {
    promotions: stackedPromotions,
    totalDiscount,
    promotion: stackedPromotions[0], // Primary for backward compat
    discount: totalDiscount,
  };
};

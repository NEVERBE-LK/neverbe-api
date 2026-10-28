import { couponRepository } from "@/repositories/CouponRepository";
import { comboRepository } from "@/repositories/ComboRepository";
import { promotionRepository } from "@/repositories/PromotionRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { Timestamp } from "firebase-admin/firestore";
import { Coupon } from "@/interfaces/Coupon";
import dayjs from "../utils/dayjs";
import { parseToDayjs } from "./UtilService";

/**
 * PromotionService - Business logic for promotions, coupons, and combos
 * Data access delegated to repository layer
 */

interface CartItem {
  itemId?: string;
  productId?: string;
  variantId: string;
  quantity: number;
  price: number;
  discount?: number;
  category?: string;
  brand?: string;
}

// ====================== Simple Delegations ======================

export const getCouponByCode = (code: string) =>
  couponRepository.findByCode(code);
export const getActivePromotions = () => promotionRepository.findActive();
export const getActiveCoupons = () => couponRepository.findActivePublic();
export const getActiveCombos = () => comboRepository.findActive();
export const getComboById = (id: string) => comboRepository.findById(id);
export const getActiveCombosWithProducts = () =>
  comboRepository.findActiveWithThumbnails();
export const getPaginatedCombos = (page: number = 1, pageSize: number = 6) =>
  comboRepository.findPaginated(page, pageSize);

export const validateComboSelection = (
  combo: any,
  selections: { productId: string; variantId: string; size: string }[]
) => comboRepository.validateSelection(combo, selections);

// ====================== Business Logic ======================

/**
 * Validate coupon against cart - complex business logic stays in service
 */
export const validateCoupon = async (
  code: string,
  userId: string | null,
  cartTotal: number,
  cartItems: CartItem[],
  customerInfo?: { phone?: string; email?: string }
): Promise<{
  valid: boolean;
  discount: number;
  message?: string;
  coupon?: Coupon;
  conditionFeedback?: {
    type: string;
    met: boolean;
    current?: number;
    required?: number;
    message: string;
  }[];
}> => {
  const coupon = await couponRepository.findByCode(code);

  if (!coupon) {
    return { valid: false, discount: 0, message: "Invalid coupon code" };
  }

  // 1. Status Check
  if (!coupon.isActive) {
    return { valid: false, discount: 0, message: "Coupon is not active" };
  }

  // 2. Date Check
  const now = dayjs();
  const startDate = parseToDayjs(coupon.startDate);
  const endDate = parseToDayjs(coupon.endDate);

  if (startDate && now.isBefore(startDate)) {
    return { valid: false, discount: 0, message: "Coupon has not started yet" };
  }
  if (endDate && now.isAfter(endDate.endOf("day"))) {
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

  // 5. Per User Limit
  if (coupon.perUserLimit) {
    const identifiersToCheck = [
      userId && userId !== "guest" ? userId : null,
      customerInfo?.phone || null,
      customerInfo?.email || null,
    ].filter(Boolean) as string[];

    for (const identifier of identifiersToCheck) {
      const usageCount = await couponRepository.getUserUsageCount(
        coupon.id,
        identifier
      );
      if (usageCount >= coupon.perUserLimit) {
        return {
          valid: false,
          discount: 0,
          message: "You have already used this coupon",
        };
      }
    }
  }

  // 6. First Order Only Check
  if (coupon.firstOrderOnly) {
    const activeUserId = userId && userId !== "guest" ? userId : null;
    const activePhone = customerInfo?.phone || null;
    const activeEmail = customerInfo?.email || null;

    if (activeUserId || activePhone || activeEmail) {
      const isFirst = await couponRepository.isFirstOrder(
        activeUserId,
        activeEmail,
        activePhone
      );
      if (!isFirst) {
        return {
          valid: false,
          discount: 0,
          message: "This coupon is only valid for first-time orders",
        };
      }
    }
  }

  // 7. Minimum Order Amount
  if (coupon.minOrderAmount && cartTotal < coupon.minOrderAmount) {
    return {
      valid: false,
      discount: 0,
      message: `Minimum order amount of Rs. ${coupon.minOrderAmount.toLocaleString()} required`,
    };
  }

  // 8. Minimum Quantity Check
  if (coupon.minQuantity) {
    const totalQuantity = cartItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    if (totalQuantity < coupon.minQuantity) {
      return {
        valid: false,
        discount: 0,
        message: `Minimum ${coupon.minQuantity} items required to use this coupon`,
      };
    }
  }

  const getItemId = (item: CartItem) => item.itemId || item.productId || "";

  // 9a. Variant-Level Products Check
  if (
    coupon.applicableProductVariants &&
    coupon.applicableProductVariants.length > 0
  ) {
    const variantEligible = couponRepository.checkVariantEligibility(
      cartItems,
      coupon.applicableProductVariants
    );
    if (!variantEligible) {
      return {
        valid: false,
        discount: 0,
        message:
          "This coupon is not valid for the product variants in your cart",
      };
    }
  }

  // 9b. Applicable Products Check (legacy)
  if (
    coupon.applicableProducts &&
    coupon.applicableProducts.length > 0 &&
    (!coupon.applicableProductVariants ||
      coupon.applicableProductVariants.length === 0)
  ) {
    const hasApplicableProduct = cartItems.some((item) =>
      coupon.applicableProducts!.includes(getItemId(item))
    );
    if (!hasApplicableProduct) {
      return {
        valid: false,
        discount: 0,
        message: "This coupon is not valid for items in your cart",
      };
    }
  }

  // 10. Applicable Categories Check
  if (coupon.applicableCategories && coupon.applicableCategories.length > 0) {
    const productIds = cartItems.map(getItemId).filter(Boolean);

    if (productIds.length > 0) {
      const products = await productRepository.findByIds(productIds.slice(0, 10));
      const productCategories = products.map((p) => p.category);
      const hasApplicableCategory = productCategories.some(
        (cat) => cat && coupon.applicableCategories!.includes(cat)
      );

      if (!hasApplicableCategory) {
        return {
          valid: false,
          discount: 0,
          message: "This coupon is not valid for the categories in your cart",
        };
      }
    } else {
      return {
        valid: false,
        discount: 0,
        message: "This coupon is not valid for the items in your cart",
      };
    }
  }

  // 11. Excluded Products Check
  if (coupon.excludedProducts && coupon.excludedProducts.length > 0) {
    const allExcluded = cartItems.every((item) =>
      coupon.excludedProducts!.includes(getItemId(item))
    );
    if (allExcluded) {
      return {
        valid: false,
        discount: 0,
        message: "This coupon cannot be applied to the items in your cart",
      };
    }
  }

  // 12. Calculate Discount
  let discountAmount = 0;
  if (coupon.discountType === "FIXED") {
    discountAmount = coupon.discountValue;
  } else if (coupon.discountType === "PERCENTAGE") {
    let applicableTotal = cartTotal;
    let eligibleItems = cartItems;

    if (
      coupon.applicableProductVariants &&
      coupon.applicableProductVariants.length > 0
    ) {
      eligibleItems = couponRepository.getEligibleCartItems(
        cartItems,
        coupon.applicableProductVariants
      );
      applicableTotal = eligibleItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );
    } else if (
      coupon.applicableProducts &&
      coupon.applicableProducts.length > 0
    ) {
      eligibleItems = cartItems.filter((item) =>
        coupon.applicableProducts!.includes(getItemId(item))
      );
      applicableTotal = eligibleItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );
    }

    if (coupon.excludedProducts && coupon.excludedProducts.length > 0) {
      const excludedTotal = eligibleItems
        .filter((item) => coupon.excludedProducts!.includes(getItemId(item)))
        .reduce((sum, item) => sum + item.price * item.quantity, 0);
      applicableTotal = applicableTotal - excludedTotal;
    }

    discountAmount = (applicableTotal * (coupon.discountValue || 0)) / 100;
    if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
      discountAmount = coupon.maxDiscount;
    }
  } else if (coupon.discountType === "FREE_SHIPPING") {
    discountAmount = 0;
  }

  // Final safety check for NaN
  if (isNaN(discountAmount)) discountAmount = 0;

  // Build condition feedback
  const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const conditionFeedback: {
    type: string;
    met: boolean;
    current?: number;
    required?: number;
    message: string;
  }[] = [];

  if (coupon.minOrderAmount) {
    const met = cartTotal >= coupon.minOrderAmount;
    conditionFeedback.push({
      type: "MIN_ORDER_AMOUNT",
      met,
      current: cartTotal,
      required: coupon.minOrderAmount,
      message: met
        ? `✓ Minimum order of Rs. ${coupon.minOrderAmount.toLocaleString()} met`
        : `Add Rs. ${(
          coupon.minOrderAmount - cartTotal
        ).toLocaleString()} more to use this coupon`,
    });
  }

  if (coupon.minQuantity) {
    const met = totalQuantity >= coupon.minQuantity;
    conditionFeedback.push({
      type: "MIN_QUANTITY",
      met,
      current: totalQuantity,
      required: coupon.minQuantity,
      message: met
        ? `✓ Minimum ${coupon.minQuantity} items in cart`
        : `Add ${coupon.minQuantity - totalQuantity} more item${coupon.minQuantity - totalQuantity > 1 ? "s" : ""
        } to use this coupon`,
    });
  }

  if (coupon.firstOrderOnly) {
    conditionFeedback.push({
      type: "FIRST_ORDER_ONLY",
      met: true,
      message: "✓ First order only coupon",
    });
  }

  if (coupon.applicableProducts && coupon.applicableProducts.length > 0) {
    conditionFeedback.push({
      type: "APPLICABLE_PRODUCTS",
      met: true,
      message: `Applies to ${coupon.applicableProducts.length
        } specific product${coupon.applicableProducts.length > 1 ? "s" : ""}`,
    });
  }

  if (coupon.applicableCategories && coupon.applicableCategories.length > 0) {
    conditionFeedback.push({
      type: "APPLICABLE_CATEGORIES",
      met: true,
      message: `Applies to: ${coupon.applicableCategories.join(", ")}`,
    });
  }

  if (coupon.excludedProducts && coupon.excludedProducts.length > 0) {
    const hasExcluded = cartItems.some((item) =>
      coupon.excludedProducts!.includes(item.itemId)
    );
    if (hasExcluded) {
      conditionFeedback.push({
        type: "EXCLUDED_PRODUCTS",
        met: false,
        message: "Some items in your cart are excluded from this coupon",
      });
    }
  }

  if (coupon.discountType === "FREE_SHIPPING") {
    conditionFeedback.push({
      type: "FREE_SHIPPING",
      met: true,
      message: "🚚 Free shipping on your order!",
    });
  }

  return { valid: true, discount: discountAmount, coupon, conditionFeedback };
};

import { promotionRepository } from "@/repositories/PromotionRepository";
import { couponRepository } from "@/repositories/CouponRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { Promotion, ProductVariantTarget } from "@/model/Promotion";
import { Coupon } from "@/model/Coupon";
import { nanoid } from "nanoid";
import { formatEntityDates, formatListDates } from "./UtilService";
import { AppError } from "@/utils/apiResponse";
import { uploadCompressedImage } from "./StorageService";

/**
 * PromotionService - Business logic for promotions and coupons
 * Delegates data access to repositories
 */

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
  const { dataList, total } = await promotionRepository.findPaginated({
    page: pageNumber,
    size,
    filterStatus,
    search,
    type
  });

  return { dataList: formatListDates(dataList, ["startDate", "endDate", "createdAt", "updatedAt"]), rowCount: total };
};

export const createPromotion = async (
  data: Omit<Promotion, "id" | "updatedAt" | "createdAt" | "usageCount">,
  file?: File | null,
): Promise<Promotion> => {
  const docId = `promo-${nanoid(10)}`;
  let bannerUrl = data.bannerUrl;
  if (file) bannerUrl = await uploadBanner(file, docId);

  const created = await promotionRepository.create({
    ...data,
    bannerUrl,
    startDate: data.startDate ? (new Date(data.startDate as any) as any) : null,
    endDate: data.endDate ? (new Date(data.endDate as any) as any) : null,
    usageCount: 0,
  });
  return formatEntityDates(created, ["startDate", "endDate", "createdAt", "updatedAt"]);
};

export const updatePromotion = async (
  id: string,
  data: Partial<Promotion>,
  file?: File | null,
): Promise<Promotion> => {
  const exists = await promotionRepository.findById(id);
  if (!exists) throw new AppError(`Promotion with ID ${id} not found`, 404);

  const payload: any = { ...data };
  if (file) payload.bannerUrl = await uploadBanner(file, id);
  if (data.startDate) payload.startDate = new Date(data.startDate as any);
  if (data.endDate) payload.endDate = new Date(data.endDate as any);

  const updated = await promotionRepository.update(id, payload);
  return formatEntityDates(updated, ["startDate", "endDate", "createdAt", "updatedAt"]);
};

export const deletePromotion = async (id: string) => {
  const exists = await promotionRepository.findById(id);
  if (!exists) throw new AppError(`Promotion with ID ${id} not found`, 404);
  await promotionRepository.delete(id);
  return { id };
};

export const getPromotionById = async (id: string) => {
  const promo = await promotionRepository.findById(id);
  if (!promo) throw new AppError("Promotion not found", 404);
  return formatEntityDates(promo);
};

// --- COUPONS CRUD ---

export const getCoupons = async (
  pageNumber: number = 1,
  size: number = 20,
  filterStatus?: string,
  search?: string,
) => {
  const { dataList, total } = await couponRepository.findPaginated({
    page: pageNumber,
    size,
    filterStatus,
    search
  });

  return { dataList: formatListDates(dataList, ["startDate", "endDate", "createdAt", "updatedAt"]), rowCount: total };
};

export const createCoupon = async (
  data: Omit<Coupon, "id" | "createdAt" | "updatedAt" | "usageCount">,
) => {
  const id = nanoid(10);
  const created = await couponRepository.create(id, {
    ...data,
    usageCount: 0,
    isDeleted: false,
  } as any);
  return formatEntityDates(created, ["startDate", "endDate", "createdAt", "updatedAt"]);
};

export const updateCoupon = async (id: string, data: Partial<Coupon>) => {
  const exists = await couponRepository.findById(id);
  if (!exists) throw new AppError(`Coupon with ID ${id} not found`, 404);

  const payload: any = { ...data };
  if (data.startDate) payload.startDate = new Date(data.startDate as any);
  if (data.endDate) payload.endDate = new Date(data.endDate as any);

  const updated = await couponRepository.update(id, payload);
  return formatEntityDates(updated, ["startDate", "endDate", "createdAt", "updatedAt"]);
};

export const deleteCoupon = async (id: string) => {
  const exists = await couponRepository.findById(id);
  if (!exists) throw new AppError(`Coupon with ID ${id} not found`, 404);
  await couponRepository.softDelete(id);
  return { id };
};

export const getCouponByCode = async (code: string) => couponRepository.findByCode(code);

// --- BUSINESS LOGIC: ELIGIBILITY & CALCULATION ---

export interface CartItem {
  productId: string;
  variantId: string;
  quantity: number;
  price: number;
  discount?: number;
  category?: string;
  brand?: string;
}

const checkVariantEligibility = (cartItems: CartItem[], targets: ProductVariantTarget[]): boolean => {
  if (!targets || targets.length === 0) return true;
  for (const target of targets) {
    const matching = cartItems.filter((i) => i.productId === target.productId);
    if (matching.length === 0) continue;
    if (target.variantMode === "ALL_VARIANTS") return true;
    if (target.variantMode === "SPECIFIC_VARIANTS" && target.variantIds) {
      if (matching.some((i) => i.variantId && target.variantIds!.includes(i.variantId))) return true;
    }
  }
  return false;
};

const getEligibleCartItems = (cartItems: CartItem[], targets: ProductVariantTarget[]): CartItem[] => {
  if (!targets || targets.length === 0) return cartItems;
  return cartItems.filter((item) => {
    const target = targets.find((t) => t.productId === item.productId);
    if (!target) return false;
    if (target.variantMode === "ALL_VARIANTS") return true;
    return target.variantMode === "SPECIFIC_VARIANTS" && target.variantIds?.includes(item.variantId);
  });
};

// Re-export validateCoupon from WebPromotionService for single unified logic
export { validateCoupon } from "./WebPromotionService";

export const trackCouponUsage = async (couponId: string, userId: string, orderId: string, discount: number) => {
  await couponRepository.trackUsage(couponId, userId, orderId, discount);
};

export const calculateCartDiscount = async (cartItems: any[], cartTotal: number, userId?: string | null) => {
  const promotions = await promotionRepository.findActive();
  promotions.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const eligible: { promo: Promotion; discount: number }[] = [];

  for (const promo of promotions) {
    if (userId && userId !== "guest" && promo.perUserLimit) {
      const count = await promotionRepository.getUserUsageCount(promo.id, userId);
      if (count >= promo.perUserLimit) continue;
    }

    if (!couponRepository.checkVariantEligibility(cartItems, promo.applicableProductVariants || [])) continue;

    let discount = 0;
    const action = promo.actions?.[0];
    const promoValue = action?.value ?? (promo as any).value ?? (promo as any).discountValue ?? 0;
    const promoMaxDiscount = action?.maxDiscount ?? (promo as any).maxDiscount;

    if (promo.type === "PERCENTAGE" || action?.type === "DISCOUNT_PERCENTAGE") {
      const eligibleItems = couponRepository.getEligibleCartItems(cartItems, promo.applicableProductVariants || []);
      const total = eligibleItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
      discount = (total * promoValue) / 100;
      if (promoMaxDiscount && discount > promoMaxDiscount) discount = promoMaxDiscount;
    } else if (promo.type === "FIXED" || action?.type === "DISCOUNT_FIXED") {
      discount = promoValue;
    }

    eligible.push({ promo, discount });
    if (!promo.stackable) break;
  }

  const totalDiscount = eligible.reduce((sum, e) => sum + e.discount, 0);
  return {
    promotions: eligible.map(e => e.promo),
    totalDiscount,
    discount: totalDiscount,
  };
};

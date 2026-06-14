import { settingsRepository } from "@/repositories/SettingsRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { TaxSettings } from "@/model/TaxSettings";
import { PaymentMethod } from "@/model/PaymentMethod";
import { ShippingRule } from "@/model/ShippingRule";
import { AppError } from "@/utils/apiResponse";
import { nanoid } from "nanoid";

/**
 * SettingsService - Unified business logic for all application settings
 * Handles ERP settings, shipping calculations, tax calculations, payment methods, and SMS templates
 */

// --- ERP & Ecommerce Settings ---

export const getERPSettings = async () => {
  const settings = await settingsRepository.getErpSettings();
  if (!settings) {
    return {
      defaultStockId: "",
      onlineStockId: "",
      ecommerce: { enable: false },
      pos: { enable: false },
    };
  }
  return settings;
};

export const updateERPSettings = async (data: any) => {
  await settingsRepository.updateErpSettings(data);
  return { success: true };
};

// --- Tax Settings & Calculations ---

export const getTaxSettings = async (): Promise<TaxSettings> => {
  return await settingsRepository.getTaxSettings();
};

export const updateTaxSettings = async (
  settings: Partial<TaxSettings>
): Promise<TaxSettings> => {
  await settingsRepository.updateTaxSettings(settings);
  return await getTaxSettings();
};

export const calculateTax = async (
  orderTotal: number,
  shippingFee: number = 0
): Promise<{
  taxableAmount: number;
  taxAmount: number;
  taxRate: number;
  taxName: string;
}> => {
  const settings = await getTaxSettings();

  if (!settings.taxEnabled || settings.taxRate <= 0) {
    return {
      taxableAmount: 0,
      taxAmount: 0,
      taxRate: 0,
      taxName: settings.taxName,
    };
  }

  if (settings.minimumOrderForTax && orderTotal < settings.minimumOrderForTax) {
    return {
      taxableAmount: 0,
      taxAmount: 0,
      taxRate: settings.taxRate,
      taxName: settings.taxName,
    };
  }

  let taxableAmount = orderTotal;
  if (settings.applyToShipping) taxableAmount += shippingFee;

  let taxAmount: number;
  if (settings.taxIncludedInPrice) {
    taxAmount = taxableAmount - taxableAmount / (1 + settings.taxRate / 100);
  } else {
    taxAmount = (taxableAmount * settings.taxRate) / 100;
  }

  return {
    taxableAmount,
    taxAmount: Math.round(taxAmount * 100) / 100,
    taxRate: settings.taxRate,
    taxName: settings.taxName,
  };
};

// --- Payment Method Management ---

export const getPaymentMethods = async (): Promise<PaymentMethod[]> => {
  return await settingsRepository.findAllActivePaymentMethods();
};

export const getPaymentMethodById = async (id: string): Promise<PaymentMethod> => {
  const method = await settingsRepository.findPaymentMethodById(id);
  if (!method || method.isDeleted) {
    throw new AppError(`Payment Method with ID ${id} not found`, 404);
  }
  return method;
};

export const createPaymentMethod = async (
  data: Omit<PaymentMethod, "id" | "createdAt" | "updatedAt" | "isDeleted">,
): Promise<PaymentMethod> => {
  const id = `pm-${nanoid(8)}`;
  await settingsRepository.createPaymentMethod(id, data);
  const created = await settingsRepository.findPaymentMethodById(id);
  if (!created) throw new AppError("Failed to create payment method", 500);
  return created;
};

export const updatePaymentMethod = async (
  id: string,
  updates: Partial<PaymentMethod>,
): Promise<void> => {
  const exists = await settingsRepository.findPaymentMethodById(id);
  if (!exists) throw new AppError(`Payment Method with ID ${id} not found`, 404);
  await settingsRepository.updatePaymentMethod(id, updates);
};

export const deletePaymentMethod = async (id: string): Promise<void> => {
  const exists = await settingsRepository.findPaymentMethodById(id);
  if (!exists) throw new AppError(`Payment Method with ID ${id} not found`, 404);
  await settingsRepository.softDeletePaymentMethod(id);
};

// --- Shipping Rules & Calculations ---

export const getShippingRules = async () => {
  const rules = await settingsRepository.findAllShippingRules();
  return rules.map((r) => ({
    ...r,
    createdAt: (r.createdAt as any)?.toDate?.() || r.createdAt,
    updatedAt: (r.updatedAt as any)?.toDate?.() || r.updatedAt,
  }));
};

export const createShippingRule = async (data: Partial<ShippingRule>) => {
  const id = `sr-${nanoid(8)}`;
  await settingsRepository.createShippingRule(id, data);
  return id;
};

export const updateShippingRule = async (
  id: string,
  data: Partial<ShippingRule>,
) => {
  const exists = await settingsRepository.findShippingRuleById(id);
  if (!exists) throw new AppError(`Shipping rule with ID ${id} not found`, 404);

  const updateData = { ...data };
  delete (updateData as any).id;

  await settingsRepository.updateShippingRule(id, updateData);
  return id;
};

export const deleteShippingRule = async (id: string) => {
  const exists = await settingsRepository.findShippingRuleById(id);
  if (!exists) throw new AppError(`Shipping rule with ID ${id} not found`, 404);
  await settingsRepository.deleteShippingRule(id);
  return id;
};

export const calculateShippingCost = async (items: any[]) => {
  if (!items || items.length === 0) return 0;

  const SHIPPING_FLAT_RATE_1 = 380;
  const SHIPPING_FLAT_RATE_2 = 500;

  // 1. Calculate Total Weight
  let totalWeight = 0;

  for (const item of items) {
    const product = await productRepository.findById(item.itemId);
    if (product) {
      const weightInGrams = product.weight || 1000;
      const weightInKg = weightInGrams / 1000;
      totalWeight += weightInKg * item.quantity;
    } else {
      totalWeight += 1 * item.quantity;
    }
  }

  // 2. Fetch Active Shipping Rules
  const rules = await settingsRepository.findActiveShippingRules();
  const totalItems = items.reduce((acc, item) => acc + item.quantity, 0);
  let cost = 0;

  if (rules.length > 0) {
    // Find matching rule
    const match = rules.find(
      (r) => totalWeight >= r.minWeight && totalWeight < r.maxWeight
    );

    if (match) {
      if (match.isIncremental && match.baseWeight !== undefined && match.perKgRate !== undefined) {
        const extraWeight = Math.max(0, totalWeight - match.baseWeight);
        const extraCost = Math.ceil(extraWeight) * match.perKgRate;
        cost = match.rate + extraCost;
      } else {
        cost = match.rate;
      }
    } else {
      // Fallback: Max rule or standard logic?
      rules.sort((a, b) => b.maxWeight - a.maxWeight);
      if (totalWeight >= rules[0].maxWeight) {
        const maxRule = rules[0];
        if (maxRule.isIncremental && maxRule.baseWeight !== undefined && maxRule.perKgRate !== undefined) {
          const extraWeight = Math.max(0, totalWeight - maxRule.baseWeight);
          const extraCost = Math.ceil(extraWeight) * maxRule.perKgRate;
          cost = maxRule.rate + extraCost;
        } else {
          cost = maxRule.rate;
        }
      } else {
        cost = totalItems <= 1 ? SHIPPING_FLAT_RATE_1 : SHIPPING_FLAT_RATE_2;
      }
    }
  } else {
    cost = totalItems === 0 ? 0 : totalItems === 1 ? SHIPPING_FLAT_RATE_1 : SHIPPING_FLAT_RATE_2;
  }

  return cost;
};

// --- SMS Templates ---

export const getSMSTemplates = async () => {
  const templates = await settingsRepository.findAllSmsTemplates();
  
  if (templates.length === 0) {
    const defaults = [
      {
        id: "ORDER_CONFIRMED",
        name: "Order Confirmation",
        en: "Neverbe: Got it, {{customerName}}. Order #{{orderId}} is confirmed.",
        si: "Neverbe: ස්තූතියි, {{customerName}}. ඔබගේ ඇණවුම #{{orderId}} තහවුරු කරන ලදී.",
        ta: "Neverbe: நன்றி, {{customerName}}. உங்கள் ஆர்டர் #{{orderId}} உறுதிப்படுத்தப்பட்டது.",
        variables: ["customerName", "orderId"]
      },
      {
        id: "STATUS_COMPLETED",
        name: "Order Shipped (Completed)",
        en: "Neverbe: Great news {{name}}! Your order #{{orderId}} is completed & shipped.",
        si: "Neverbe: සුභ ආරංචියක් {{name}}! ඔබගේ ඇණවුම #{{orderId}} දැන් සම්පූර්ණ කර එවා ඇත.",
        ta: "Neverbe: நற்செய்தி {{name}}! உங்கள் ஆர்டர் #{{orderId}} முடிக்கப்பட்டு அனுப்பப்பட்டது.",
        common: "{{trackingInfo}}",
        variables: ["name", "orderId", "trackingInfo"]
      },
      {
        id: "STATUS_CANCELLED",
        name: "Order Cancelled",
        en: "Neverbe: Hi {{name}}, your order #{{orderId}} has been cancelled. Please contact us for details.",
        si: "Neverbe: ආයුබෝවන් {{name}}, ඔබගේ ඇණවුම #{{orderId}} අවලංගු කර ඇත. විස්තර සඳහා අප අමතන්න.",
        ta: "Neverbe: வணக்கம் {{name}}, உங்கள் ஆர்டர் #{{orderId}} ரத்து செய்யப்பட்டுள்ளது. விவரங்களுக்கு எங்களைத் தொடர்பு கொள்ளவும்.",
        variables: ["name", "orderId"]
      },
      {
        id: "STATUS_UPDATE",
        name: "General Status Update",
        en: "Neverbe: Hi {{name}}, your order #{{orderId}} status has been updated to {{status}}.",
        si: "Neverbe: ආයුබෝවන් {{name}}, ඔබගේ ඇණවුමේ #{{orderId}} තත්වය {{status}} ලෙස යාවත්කාලීන කර ඇත.",
        ta: "Neverbe: வணக்கம் {{name}}, உங்கள் ஆர்டர் #{{orderId}} நிலை {{status}} என மாற்றப்பட்டுள்ளது.",
        variables: ["name", "orderId", "status"]
      },
      {
        id: "EBILL_SENT",
        name: "POS eBill SMS",
        en: "Neverbe: Thank you for your purchase!",
        si: "Neverbe: ඔබගේ මිලදී ගැනීමට ස්තූතියි!",
        ta: "உங்கள் கொள்முதலுக்கு நன்றி!",
        common: "View & download your eBill here: {{ebillUrl}}",
        variables: ["ebillUrl"]
      }
    ];

    await settingsRepository.seedSmsTemplates(defaults);
    return { data: defaults };
  }

  return { data: templates };
};

export const updateSMSTemplate = async (id: string, data: any) => {
  const template = await settingsRepository.getSmsTemplate(id);
  if (!template) throw new AppError("Template not found", 404);
  await settingsRepository.updateSmsTemplate(id, data);
  return { success: true };
};

// --- Email Templates ---

export const getEmailTemplates = async () => {
  const templates = await settingsRepository.findAllMailTemplates();
  return { data: templates };
};

export const updateEmailTemplate = async (id: string, data: any) => {
  const template = await settingsRepository.getMailTemplate(id);
  if (!template) throw new AppError("Email Template not found", 404);
  await settingsRepository.updateMailTemplate(id, data);
  return { success: true };
};

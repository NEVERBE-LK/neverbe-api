import { Order } from "@/interfaces/Order";
import { OrderItem } from "@/interfaces/BaseItem";
import crypto from "crypto";
import { getOrderByIdForInvoice } from "./WebOrderService";
import { verifyCaptchaToken } from "./CapchaService";
import { notificationRepository } from "@/repositories/NotificationRepository";
import { settingsRepository } from "@/repositories/SettingsRepository";
import { getNowSL, parseToDayjs, formatPhoneForSMS } from "./UtilService";
import dayjs from "../utils/dayjs";
import { MailService } from "./MailService";

/**
 * NotificationService - Business logic for multi-channel messaging
 * Delegates data access to notificationRepository
 */

const OTP_EXPIRY_MINUTES = 5;
const OTP_TTL_DAYS = 1;
const COOLDOWN_SECONDS = 60;

const generateOTP = (): string => Math.floor(100000 + Math.random() * 900000).toString();
const hashOTP = (otp: string): string => crypto.createHash("sha256").update(otp).digest("hex");
const generateHash = (input: string): string => crypto.createHash("sha256").update(input).digest("hex");

const formatMoney = (amount: number = 0): string => {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(amount);
};

export const calculateTotal = (items: OrderItem[]): number =>
  items.reduce((total, item) => total + item.price * item.quantity, 0);

export const sendCODVerificationOTP = async (phone: string, captchaToken: string) => {
  try {
    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (!TEXT_API_KEY) throw new Error("Missing TEXT_API_KEY");
    if (!phone || !captchaToken) throw new Error("Missing phone number or CAPTCHA token");

    const captchaResponse = await verifyCaptchaToken(captchaToken);
    if (!captchaResponse) return { success: false, message: "Security verification failed. Please try again." };

    const now = getNowSL();
    const lastOtp = await notificationRepository.findLatestOTP(phone);

    if (lastOtp) {
      const lastRequestTime = parseToDayjs(lastOtp.createdAt);
      const secondsSinceLastRequest = lastRequestTime ? now.diff(lastRequestTime, "second") : Infinity;

      if (secondsSinceLastRequest < COOLDOWN_SECONDS) {
        return { success: false, message: `Please wait ${Math.ceil(COOLDOWN_SECONDS - secondsSinceLastRequest)} seconds.` };
      }

      const expiresAt = parseToDayjs(lastOtp.expiresAt);
      if (!lastOtp.verified && expiresAt && expiresAt.isAfter(now)) {
        return { success: false, message: "An active OTP already exists." };
      }
    }

    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = now.add(OTP_EXPIRY_MINUTES, "minute").toDate();

    await notificationRepository.createOTP({
      phone,
      otpHash,
      createdAt: now.toDate(),
      expiresAt,
      verified: false,
      attempts: 0,
      ttl: now.add(OTP_TTL_DAYS, "day").toDate(),
    });

    const text = `Your verification code is ${otp}. Valid for 5 minutes.`;
    const response = await fetch("https://api.textit.biz/", {
      method: "POST",
      headers: { Authorization: `Basic ${TEXT_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, text }),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return { success: true, message: "OTP sent successfully." };
  } catch (error) {
    console.error(`[OTP Service] Failed to send OTP:`, error);
    return { success: false, message: "Failed to send OTP." };
  }
};

export const verifyCODOTP = async (phone: string, otp: string) => {
  try {
    const lastOtp = await notificationRepository.findLatestOTP(phone);
    if (!lastOtp) return { success: false, message: "No OTP found." };

    const now = getNowSL();
    const expiresAt = parseToDayjs(lastOtp.expiresAt);
    if (lastOtp.verified) return { success: false, message: "OTP already verified." };
    if (!expiresAt || now.isAfter(expiresAt)) return { success: false, message: "OTP expired." };

    if (lastOtp.otpHash !== hashOTP(otp)) {
      const newAttempts = (lastOtp.attempts || 0) + 1;
      await notificationRepository.updateOTP(lastOtp.id, { attempts: newAttempts });
      return { success: false, message: "Invalid OTP." };
    }

    await notificationRepository.updateOTP(lastOtp.id, { verified: true, verifiedAt: now.toDate() });
    return { success: true, message: "OTP verified successfully." };
  } catch (error) {
    console.error(`[OTP Service] OTP verification failed:`, error);
    return { success: false, message: "OTP verification failed." };
  }
};

export const isOTPVerifiedRecently = async (phone: string): Promise<boolean> => {
  try {
    const cutoffDate = getNowSL().subtract(15, "minute").toDate();
    const data = await notificationRepository.findRecentVerifiedOTP(phone, cutoffDate);
    return !!data && !data.consumed;
  } catch (error) {
    return false;
  }
};

export const consumeOTPVerification = async (phone: string): Promise<void> => {
  try {
    const lastOtp = await notificationRepository.findLatestOTP(phone);
    if (lastOtp && lastOtp.verified) {
      await notificationRepository.updateOTP(lastOtp.id, { consumed: true, consumedAt: getNowSL().toDate() });
    }
  } catch (error) {
    console.error(`[OTP Service] Error consuming OTP verification:`, error);
  }
};

const processTemplate = (content: string, data: Record<string, any>) => {
  let processed = content;
  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    processed = processed.replace(regex, data[key] || '');
  });
  return processed;
};

export const renderMultilingualSMS = async (templateId: string, data: Record<string, any>) => {
  try {
    const template = await settingsRepository.getSmsTemplate(templateId);
    if (!template) {
      if (templateId === "ORDER_CONFIRMED") return `Neverbe: Order #${data.orderId?.toUpperCase()} confirmed.`;
      if (templateId === "STATUS_COMPLETED") return `Neverbe: Order #${data.orderId?.toUpperCase()} shipped.`;
      return `Neverbe: Update for order #${data.orderId?.toUpperCase()}.`;
    }

    const parts = [];
    if (template.en) parts.push(processTemplate(template.en, data));

    let message = parts.join("\n\n");
    if (template.common) {
      const processedCommon = processTemplate(template.common, data);
      if (processedCommon.trim()) message += "\n\n" + processedCommon;
    }
    return message;
  } catch (error) {
    return `Neverbe: Update for Order #${data.orderId?.toUpperCase()}`;
  }
};

export const sendOrderConfirmedSMS = async (orderId: string) => {
  try {
    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (!TEXT_API_KEY) return false;

    const order: Order = await getOrderByIdForInvoice(orderId);
    if (!order?.customer?.phone) return false;

    // 🛑 Payment Guard: Suppress SMS for failed payment orders
    if (order.paymentStatus?.toLowerCase() === "failed") {
      console.log(`[Notification Service] Suppressing Order Confirmed SMS for order #${orderId} due to FAILED payment status.`);
      return false;
    }

    const phone = formatPhoneForSMS(order.customer.phone);
    if (!phone) return false;
    const customerName = order.customer.name.split(" ")[0];
    const text = await renderMultilingualSMS("ORDER_CONFIRMED", { customerName, orderId });
    const hashValue = generateHash(phone + text);

    const exists = await notificationRepository.findSentNotification(orderId, hashValue, "sms");
    if (exists) return false;

    await fetch("https://api.textit.biz/", {
      method: "POST",
      headers: { Authorization: `Basic ${TEXT_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, text }),
    });

    await notificationRepository.logNotification({ orderId, type: "sms", to: phone, hashValue });
    return true;
  } catch (error) {
    return false;
  }
};

export const sendeBillSMS = async (orderId: string, rawPhone: string) => {
  try {
    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (!TEXT_API_KEY || !rawPhone || !orderId) return false;

    const cleanPhone = formatPhoneForSMS(rawPhone);
    if (!cleanPhone) return false;
    const ebillUrl = `https://neverbe.lk/ebill/${orderId}`;
    const text = await renderMultilingualSMS("EBILL_SENT", { ebillUrl, orderId });
    const hashValue = generateHash(cleanPhone + "EBILL" + orderId);

    const exists = await notificationRepository.findSentNotification(orderId, hashValue, "ebill_sms");
    if (exists) return false;

    await fetch("https://api.textit.biz/", {
      method: "POST",
      headers: { Authorization: `Basic ${TEXT_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: cleanPhone, text }),
    });

    await notificationRepository.logNotification({ orderId, type: "ebill_sms", to: cleanPhone, hashValue });
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Seed the order success template into Firestore
 */
export const seedOrderSuccessTemplate = async () => {
  const templateHtml = `<div style="font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8faf5; color: #111827; margin: 0; padding: 16px 8px; width: 100%; box-sizing: border-box;">

    <div style="max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(46, 158, 91, 0.08); border: 1px solid #e0e8d8;">
        
        <!-- Header / Logo -->
        <div style="text-align: center; padding: 28px 16px 16px 16px;">
            <img src="https://neverbe.lk/mail-logo.png" alt="Neverbe" width="120" style="display: block; margin: 0 auto;" />
        </div>

        <!-- Order Confirmation Title -->
        <div style="padding: 0 24px; text-align: center;">
            <h1 style="font-size: 28px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.03em; margin: 0 0 8px 0; color: #0e331c; line-height: 1.1;">
                Got It. Thanks, {{customerName}}.
            </h1>
            <p style="color: #2e9e5b; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 20px 0;">
                ORDER #{{orderId}}
            </p>

            <p style="font-size: 15px; line-height: 1.6; color: #374151; margin: 0 auto 28px auto; max-width: 100%;">
                We've received your order and are working on it now. We'll email you an update when it ships.
            </p>
        </div>

        <!-- Items Ordered Section -->
        <div style="padding: 0 24px 28px 24px;">
            <div style="font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #f0f5eb; padding-bottom: 12px; margin-bottom: 20px; color: #0e331c;">
                Items Ordered
            </div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                {{#each items}}
                <tr>
                    <td width="80" style="padding-bottom: 20px; vertical-align: top;">
                        <div style="width: 80px; height: 80px; border-radius: 10px; overflow: hidden; background-color: #f8faf5; border: 1px solid #e0e8d8;">
                            <img src="{{this.thumbnail}}" alt="{{this.name}}" width="80" height="80" style="width: 80px; height: 80px; object-fit: cover; display: block;" />
                        </div>
                    </td>
                    <td style="padding-left: 16px; padding-bottom: 20px; vertical-align: top;">
                        <span style="display: block; font-weight: 700; font-size: 15px; margin-bottom: 4px; color: #111827; line-height: 1.3;">
                            {{this.name}}
                        </span>
                        <div style="font-size: 13px; color: #6b7280; line-height: 1.5; font-weight: 500;">
                            {{#if this.variantName}}<span style="color: #374151;">Variant:</span> {{this.variantName}}<br>{{/if}}
                            <span style="color: #374151;">Size:</span> {{this.size}} &nbsp; | &nbsp; <span style="color: #374151;">Qty:</span> {{this.quantity}}<br>
                            <span style="display: block; margin-top: 6px; font-weight: 700; color: #111827; font-size: 14px;">{{this.formattedPrice}}</span>
                        </div>
                    </td>
                </tr>
                {{/each}}
            </table>

            <!-- Summary Table -->
            <div style="background-color: #f8faf5; border-radius: 12px; padding: 16px; margin-top: 4px; border: 1px solid #e0e8d8;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                    <tr>
                        <td style="padding: 4px 0; font-size: 13px; color: #4b5563; font-weight: 500;">Subtotal</td>
                        <td align="right" style="padding: 4px 0; font-size: 13px; color: #111827; font-weight: 600;">{{subtotal}}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; font-size: 13px; color: #4b5563; font-weight: 500;">Shipping</td>
                        <td align="right" style="padding: 4px 0; font-size: 13px; color: #111827; font-weight: 600;">{{shippingFee}}</td>
                    </tr>
                    {{#if discount}}
                    <tr>
                        <td style="padding: 4px 0; font-size: 13px; color: #2e9e5b; font-weight: 600;">Discount</td>
                        <td align="right" style="padding: 4px 0; font-size: 13px; color: #2e9e5b; font-weight: 600;">-{{discount}}</td>
                    </tr>
                    {{/if}}
                    <tr>
                        <td style="padding-top: 14px; font-weight: 800; font-size: 18px; color: #0e331c; border-top: 1px solid #cbd5e1;">Total</td>
                        <td align="right" style="padding-top: 14px; font-weight: 800; font-size: 18px; color: #0e331c; border-top: 1px solid #cbd5e1;">{{total}}</td>
                    </tr>
                </table>
            </div>
        </div>

        <!-- Delivery Details -->
        <div style="background-color: #fdfdfd; padding: 24px; border-top: 1px solid #e0e8d8;">
            <div style="font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #f0f5eb; padding-bottom: 12px; margin-bottom: 20px; color: #0e331c;">
                Delivery Details
            </div>
            
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td width="50%" valign="top" style="padding-right: 12px;">
                        <strong style="font-size: 12px; text-transform: uppercase; color: #2e9e5b; letter-spacing: 0.05em;">Shipping Address</strong>
                        <div style="font-size: 13px; color: #4b5563; line-height: 1.6; margin-top: 8px; font-weight: 500;">
                            {{customer.address}}<br>
                            {{customer.city}}<br>
                            {{customer.phone}}
                        </div>
                    </td>
                    <td width="50%" valign="top">
                        <strong style="font-size: 12px; text-transform: uppercase; color: #2e9e5b; letter-spacing: 0.05em;">Payment Info</strong>
                        <div style="font-size: 13px; color: #4b5563; line-height: 1.6; margin-top: 8px; font-weight: 500;">
                            {{paymentMethod}}<br>
                            <span style="color: #0e331c; font-weight: 700;">{{paymentStatus}}</span>
                        </div>
                    </td>
                </tr>
            </table>
        </div>

        <!-- Footer -->
        <div style="background-color: #0e331c; padding: 28px 24px; text-align: center; color: #ffffff;">
            <p style="margin: 0 0 20px 0;">
                <a href="https://www.neverbe.lk/contact" style="color: #ffffff; text-decoration: none; margin: 0 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Get Help</a>
                <a href="https://www.neverbe.lk/policies/shipping-return-policy" style="color: #ffffff; text-decoration: none; margin: 0 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Returns</a>
            </p>
            <div style="font-size: 11px; color: #a1ceb4; line-height: 1.8; font-weight: 400;">
                <strong style="color: #ffffff; font-size: 13px; display: block; margin-bottom: 8px;">Neverbe, Inc.</strong>
                330/4/10 New Kandy Road, Delgoda<br>
                Hotline: 070 520 8990 | 072 924 9999
            </div>
        </div>
    </div>

</div>`;

  await notificationRepository.saveMailTemplate("order_success", {
    subject: "Got it. Order {{orderId}}",
    html: templateHtml
  });

  return { success: true };
};

export const sendOrderConfirmedEmail = async (orderId: string) => {
  try {
    if (!orderId) return false;
    const order: Order = await getOrderByIdForInvoice(orderId);
    if (!order) return false;

    const email = order?.customer?.email?.trim();
    if (!email) return false;

    const hashValue = generateHash(email + "ORDER_CONFIRMATION" + orderId);
    const exists = await notificationRepository.findSentNotification(orderId, hashValue, "email");
    if (exists) return false;

    const safeItems = Array.isArray(order.items) ? order.items : [];
    const subtotalRaw = safeItems.reduce((acc, item) => acc + (item.price || 0) * (item.quantity || 1), 0);
    const totalRaw = (order as any).total || 0;
    const shippingRaw = order.shippingFee || 0;
    const itemDiscountsRaw = safeItems.reduce((acc, item) => acc + (item.discount || 0), 0);
    const promotionDiscountRaw = (order as any).promotionDiscount || 0;
    const discountRaw = (order.discount || 0) + promotionDiscountRaw + itemDiscountsRaw;

    const templateData = {
      customerName: order.customer?.name || "Customer",
      orderId: (order.orderId || orderId).toUpperCase(),
      items: safeItems.map((item) => {
        const netPrice = (item.price || 0) - (item.discount || 0);
        return {
          name: item.name || "Unknown Item",
          variantName: item.variantName || "",
          size: item.size || "-",
          quantity: item.quantity || 1,
          thumbnail: item.thumbnail || "https://placehold.co/100x100?text=No+Img",
          formattedPrice: formatMoney(netPrice),
          originalPrice: (item.discount || 0) > 0 ? formatMoney(item.price || 0) : null,
        };
      }),
      customer: {
        address: order.customer?.address || "N/A",
        city: order.customer?.city || "",
        phone: order.customer?.phone || "",
      },
      paymentMethod: order.paymentMethod || "N/A",
      paymentStatus: order.paymentStatus || "Pending",
      subtotal: formatMoney(subtotalRaw),
      shippingFee: formatMoney(shippingRaw),
      discount: discountRaw > 0 ? formatMoney(discountRaw) : null,
      total: formatMoney(totalRaw),
    };

    const result = await MailService.sendTemplateEmail([email], "order_success", templateData);

    if (result.success) {
      await notificationRepository.logNotification({ orderId, type: "email", to: email, hashValue });
    }

    return result.success;
  } catch (error) {
    console.error("[NotificationService] sendOrderConfirmedEmail Error:", error);
    return false;
  }
};

export const createAdminNotification = async (
  type: string,
  title: string,
  message: string,
  metadata: Record<string, any> = {}
) => {
  try {
    const now = getNowSL();
    const docId = `${type}_${now.valueOf()}_${Math.random().toString(36).substring(7)}`;
    const notification = { type, title, message, metadata, read: false, createdAt: now.toDate() };
    await notificationRepository.createAdminNotification(docId, notification);

    const payload = {
      topic: "admin_alerts",
      notification: { title, body: message },
      data: { ...metadata },
      webpush: { fcmOptions: { link: metadata.orderId ? `/orders/${metadata.orderId}` : "/dashboard" } }
    };

    const { getMessaging } = await import("firebase-admin/messaging");
    await getMessaging().send(payload);
    return true;
  } catch (error) {
    return false;
  }
};

export const subscribeToAdminAlerts = async (token: string) => {
  try {
    const { getMessaging } = await import("firebase-admin/messaging");
    await getMessaging().subscribeToTopic([token], "admin_alerts");
    return true;
  } catch (error) {
    return false;
  }
};

export const sendOrderStatusUpdateSMS = async (orderId: string, status: string) => {
  try {
    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (!TEXT_API_KEY) return false;

    const order: Order = await getOrderByIdForInvoice(orderId);
    if (!order?.customer?.phone) return false;

    // 🛑 Payment Guard: Suppress SMS for failed payment orders
    if (order.paymentStatus?.toLowerCase() === "failed") {
      console.log(`[Notification Service] Suppressing Status Update SMS for order #${orderId} due to FAILED payment status.`);
      return false;
    }

    const phone = formatPhoneForSMS(order.customer.phone);
    if (!phone) return false;
    const name = order.customer.name.split(" ")[0];
    let text = "";
    const s = status.toUpperCase();

    if (s === "COMPLETED") {
      const trackingInfo = order.trackingNumber ? ` Track your package: ${order.trackingNumber}${order.courier ? ` via ${order.courier}` : ""}` : "";
      text = await renderMultilingualSMS("STATUS_COMPLETED", { name, orderId, trackingInfo });
    } else if (s === "CANCELLED") {
      text = await renderMultilingualSMS("STATUS_CANCELLED", { name, orderId });
    } else {
      text = await renderMultilingualSMS("STATUS_UPDATE", { name, orderId, status });
    }

    const hashValue = generateHash(phone + text + "STATUS_UPDATE");
    const exists = await notificationRepository.findSentNotification(orderId, hashValue, "sms_status");
    if (exists) return false;

    await fetch("https://api.textit.biz/", {
      method: "POST",
      headers: { Authorization: `Basic ${TEXT_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, text }),
    });

    await notificationRepository.logNotification({ orderId, type: "sms_status", to: phone, content: text, status: s, hashValue });
    return true;
  } catch (error) {
    return false;
  }
};

export const sendOrderStatusUpdateEmail = async (orderId: string, status: string) => {
  try {
    const order: Order = await getOrderByIdForInvoice(orderId);
    const email = order?.customer?.email?.trim();
    if (!email) return false;

    // 🛑 Payment Guard: Suppress Email for failed payment orders
    if (order.paymentStatus?.toLowerCase() === "failed") {
      console.log(`[Notification Service] Suppressing Status Update Email for order #${orderId} due to FAILED payment status.`);
      return false;
    }

    const name = order.customer.name || "Customer";
    const s = status.toUpperCase();
    let message = `Your order status has been updated to ${s}.`;

    if (s === "COMPLETED") {
      const tracking = order.trackingNumber ? `Your order has been shipped via ${order.courier || "our courier partner"}. Tracking Number: ${order.trackingNumber}.` : "Your order is now complete and has been shipped.";
      message = `Great news! ${tracking} Thank you for choosing Neverbe!`;
    } else if (s === "CANCELLED") {
      message = `Your order has been cancelled. If this was a mistake, please reach out to us.`;
    }

    const templateData = {
      customerName: name,
      orderId: orderId.toUpperCase(),
      status: s,
      message: message
    };

    const result = await MailService.sendTemplateEmail([email], "order_status_update", templateData);

    if (result.success) {
      await notificationRepository.logNotification({ orderId, type: "email_status", to: email, status: s });
    }

    return result.success;
  } catch (error) {
    return false;
  }
};

export const sendManualNotification = async (
  orderId: string | null,
  type: "sms" | "email",
  content: string,
  subject?: string,
  toOverride?: string
) => {
  try {
    let to = toOverride;
    if (orderId && !to) {
      const order: Order = await getOrderByIdForInvoice(orderId);
      if (!order) return false;
      to = type === "sms" ? order.customer?.phone?.trim() : order.customer?.email?.trim();
    }
    if (!to) return false;

    if (type === "sms") {
      const TEXT_API_KEY = process.env.TEXT_API_KEY;
      if (!TEXT_API_KEY) return false;
      await fetch("https://api.textit.biz/", {
        method: "POST",
        headers: { Authorization: `Basic ${TEXT_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to, text: content }),
      });
    } else {
      const subjectLine = subject || `Update regarding your order #${orderId?.toUpperCase() || 'Neverbe'}`;
      const htmlContent = content.replace(/\n/g, '<br/>');
      
      await MailService.sendTemplateEmail([to], "generic_notification", {
        subject: subjectLine,
        content: htmlContent
      });
    }

    await notificationRepository.logNotification({ orderId: orderId || "CUSTOM", type: `manual_${type}`, to, content });
    return true;
  } catch (error) {
    return false;
  }
};


export const getNotificationLogs = async (orderId: string) => {
  const logs = await notificationRepository.findLogsForOrder(orderId);
  return logs.map(data => {
    const timestamp = parseToDayjs(data.createdAt)?.valueOf() || 0;
    return { ...data, createdAt: timestamp };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
};

export const getAllNotificationLogs = async (page: number = 1, pageSize: number = 20, search?: string) => {
  const { logs, total } = await notificationRepository.findAllLogs({ page, pageSize, search });
  const formattedLogs = logs.map(data => {
    const timestamp = parseToDayjs(data.createdAt)?.valueOf() || 0;
    return { ...data, createdAt: timestamp };
  });
  return { logs: formattedLogs, total };
};

import { adminFirestore } from "@/firebase/firebaseAdmin";
import { Order } from "@/interfaces/Order";
import { OrderItem } from "@/interfaces/BaseItem";

import crypto from "crypto";
import { getOrderByIdForInvoice } from "./WebOrderService";
import { verifyCaptchaToken } from "./CapchaService";

const OTP_COLLECTION = "otp_verifications";
const OTP_EXPIRY_MINUTES = 5;
const NOTIFICATION_TRACKER = "notifications_sent";
const OTP_TTL_DAYS = 1;
const COOLDOWN_SECONDS = 60;
const MAIL_COLLECTION = "mail";

/** Generate a 6-digit OTP */
const generateOTP = (): string => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  console.log("[OTP] Generated OTP:", otp);
  return otp;
};

/** Hash OTP using SHA256 */
const hashOTP = (otp: string): string => {
  const hashed = crypto.createHash("sha256").update(otp).digest("hex");
  console.log("[OTP] Hashed OTP:", hashed);
  return hashed;
};

/** Helper to format currency (LKR) */
const formatMoney = (amount: number = 0): string => {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    minimumFractionDigits: 2,
  }).format(amount);
};

/** Generate SHA256 hash for content (duplicate prevention) */
const generateHash = (input: string): string => {
  const hashed = crypto.createHash("sha256").update(input).digest("hex");
  console.log("[Hash] Generated hash for input:", input, "Hash:", hashed);
  return hashed;
};

/** Calculate subtotal */
export const calculateTotal = (items: OrderItem[]): number =>
  items.reduce((total, item) => total + item.price * item.quantity, 0);

/** Send COD verification OTP with CAPTCHA and rate limiting */
export const sendCODVerificationOTP = async (
  phone: string,
  captchaToken: string,
) => {
  try {
    console.log(`[OTP Service] sendCODVerificationOTP called for ${phone}`);

    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (!TEXT_API_KEY) throw new Error("Missing TEXT_API_KEY");
    if (!phone || !captchaToken)
      throw new Error("Missing phone number or CAPTCHA token");

    const captchaResponse = await verifyCaptchaToken(captchaToken);
    console.log("[OTP Service] CAPTCHA verification result:", captchaResponse);
    if (!captchaResponse) {
      console.warn(`[OTP Service] CAPTCHA verification failed for ${phone}`);
      return {
        success: false,
        message: "CAPTCHA verification failed. Please try again.",
      };
    }

    const now = new Date();

    const latestOtpQuery = await adminFirestore
      .collection(OTP_COLLECTION)
      .where("phone", "==", phone)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (!latestOtpQuery.empty) {
      const lastOtpData = latestOtpQuery.docs[0].data();
      const lastRequestTime = lastOtpData.createdAt.toDate();
      const secondsSinceLastRequest =
        (now.getTime() - lastRequestTime.getTime()) / 1000;

      if (secondsSinceLastRequest < COOLDOWN_SECONDS) {
        console.warn(`[OTP Service] Cooldown active for ${phone}`);
        return {
          success: false,
          message: `Please wait ${Math.ceil(
            COOLDOWN_SECONDS - secondsSinceLastRequest,
          )} seconds before requesting a new code.`,
        };
      }

      if (!lastOtpData.verified && lastOtpData.expiresAt.toDate() > now) {
        console.warn(`[OTP Service] Active OTP already exists for ${phone}`);
        return {
          success: false,
          message:
            "An active OTP has already been sent. Please check your SMS.",
        };
      }
    }

    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60000);

    console.log(`[OTP Service] Storing OTP in Firestore for ${phone}`);
    await adminFirestore.collection(OTP_COLLECTION).add({
      phone,
      otpHash,
      createdAt: now,
      expiresAt,
      verified: false,
      attempts: 0,
      ttl: new Date(now.getTime() + OTP_TTL_DAYS * 24 * 60 * 60 * 1000),
    });

    const text = `Your verification code is ${otp}. Valid for 5 minutes.`;
    console.log(`[OTP Service] Sending SMS via API to ${phone}: ${text}`);

    const response = await fetch("https://api.textit.biz/", {
      method: "POST",
      headers: {
        Authorization: `Basic ${TEXT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: phone, text }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log(`[OTP Service] OTP sent successfully to ${phone}`);
    return { success: true, message: "OTP sent successfully." };
  } catch (error) {
    console.error(`[OTP Service] Failed to send OTP for ${phone}:`, error);
    return { success: false, message: "Failed to send OTP." };
  }
};

/** Verify the latest OTP for a phone */
export const verifyCODOTP = async (phone: string, otp: string) => {
  try {
    console.log(`[OTP Service] verifyCODOTP called for ${phone}`);

    if (!phone || !otp) throw new Error("Missing phone or OTP");

    const otpHash = hashOTP(otp);
    const now = new Date();

    const snapshot = await adminFirestore
      .collection(OTP_COLLECTION)
      .where("phone", "==", phone)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.warn(`[OTP Service] No OTP found for ${phone}`);
      return { success: false, message: "No OTP found for this number." };
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (data.verified) {
      console.warn(`[OTP Service] OTP already verified for ${phone}`);
      return { success: false, message: "OTP already verified." };
    }
    if (now > data.expiresAt.toDate()) {
      console.warn(`[OTP Service] OTP expired for ${phone}`);
      return { success: false, message: "OTP expired." };
    }
    if (data.otpHash !== otpHash) {
      const newAttempts = (data.attempts || 0) + 1;
      await doc.ref.update({ attempts: newAttempts });
      console.warn(
        `[OTP Service] Invalid OTP entered for ${phone}, attempts: ${newAttempts}`,
      );
      return { success: false, message: "Invalid OTP." };
    }

    await doc.ref.update({ verified: true, verifiedAt: now });
    console.log(`[OTP Service] OTP verified successfully for ${phone}`);
    return { success: true, message: "OTP verified successfully." };
  } catch (error) {
    console.error(`[OTP Service] OTP verification failed for ${phone}:`, error);
    return { success: false, message: "OTP verification failed." };
  }
};

/**
 * Check if a phone number has a verified OTP within the last 15 minutes.
 * This ensures that a COD order can only be placed after a successful OTP verification.
 */
export const isOTPVerifiedRecently = async (phone: string): Promise<boolean> => {
  try {
    const verifiedWindowMinutes = 15;
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - verifiedWindowMinutes * 60000);

    const snapshot = await adminFirestore
      .collection(OTP_COLLECTION)
      .where("phone", "==", phone)
      .where("verified", "==", true)
      .where("verifiedAt", ">=", cutoffDate)
      .orderBy("verifiedAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.warn(`[OTP Service] No recently verified OTP found for ${phone}`);
      return false;
    }

    const data = snapshot.docs[0].data();
    if (data.consumed) {
      console.warn(`[OTP Service] Verified OTP already consumed for ${phone}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[OTP Service] Error checking recently verified OTP:`, error);
    return false;
  }
};

/**
 * Mark the latest verified OTP for a phone number as consumed to prevent replay attacks.
 */
export const consumeOTPVerification = async (phone: string): Promise<void> => {
  try {
    const snapshot = await adminFirestore
      .collection(OTP_COLLECTION)
      .where("phone", "==", phone)
      .where("verified", "==", true)
      .orderBy("verifiedAt", "desc")
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      await doc.ref.update({ consumed: true, consumedAt: new Date() });
      console.log(`[OTP Service] OTP verified state consumed for ${phone}`);
    }
  } catch (error) {
    console.error(`[OTP Service] Error consuming OTP verification:`, error);
  }
};

/** Send Predefined Order Confirmation SMS (Prevents duplicates using hash) */
export const sendOrderConfirmedSMS = async (orderId: string) => {
  try {
    console.log(
      `[Notification Service] sendOrderConfirmedSMS called for order: ${orderId}`,
    );

    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (!TEXT_API_KEY) {
      console.warn(`[Notification Service] Missing TEXT_API_KEY`);
      return false;
    }

    const order: Order = await getOrderByIdForInvoice(orderId);
    if (!order?.customer?.phone) {
      console.warn(
        `[Notification Service] Missing customer phone for order: ${orderId}`,
      );
      return false;
    }

    const phone = order.customer.phone.trim();
    const customerName = order.customer.name.split(" ")[0];
    const text = `NEVERBE: Got it, ${customerName}. Order #${orderId.toUpperCase()} is confirmed.`;
    const hashValue = generateHash(phone + text);

    const existing = await adminFirestore
      .collection(NOTIFICATION_TRACKER)
      .where("orderId", "==", orderId)
      .where("hashValue", "==", hashValue)
      .where("type", "==", "sms")
      .get();

    if (!existing.empty) {
      console.warn(
        `[Notification Service] Duplicate SMS detected for order: ${orderId}`,
      );
      return false;
    }

    const response = await fetch("https://api.textit.biz/", {
      method: "POST",
      headers: {
        Authorization: `Basic ${TEXT_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify({ to: phone, text }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    console.log(
      `[Notification Service] SMS sent for order ${orderId} to ${phone}`,
    );

    await adminFirestore.collection(NOTIFICATION_TRACKER).add({
      orderId,
      type: "sms",
      to: phone,
      hashValue,
      createdAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error(
      `[Notification Service] Failed to queue SMS for order ${orderId}:`,
      error,
    );
    return false;
  }
};

/** Send POS eBill SMS */
export const sendeBillSMS = async (orderId: string, phone: string) => {
  try {
    console.log(`[Notification Service] sendeBillSMS called for order: ${orderId} to phone: ${phone}`);

    const TEXT_API_KEY = process.env.TEXT_API_KEY;
    if (!TEXT_API_KEY) {
      console.warn(`[Notification Service] Missing TEXT_API_KEY`);
      return false;
    }

    if (!phone || !orderId) {
      console.warn(`[Notification Service] Missing phone or orderId for eBill SMS`);
      return false;
    }

    const cleanPhone = phone.trim();
    const ebillUrl = `https://neverbe.lk/ebill/${orderId}`;
    const text = `NEVERBE: Thank you for your purchase! View & download your eBill here: ${ebillUrl}`;
    
    // We can use a hash to prevent sending the exact same eBill SMS to the same phone within a short time.
    const hashValue = generateHash(cleanPhone + "EBILL" + orderId);

    const existing = await adminFirestore
      .collection(NOTIFICATION_TRACKER)
      .where("orderId", "==", orderId)
      .where("hashValue", "==", hashValue)
      .where("type", "==", "ebill_sms")
      .get();

    if (!existing.empty) {
      const lastSentTime = existing.docs[0].data().createdAt.toDate();
      const now = new Date();
      // Allow resending if it's been more than 5 minutes, in case they requested it again.
      if ((now.getTime() - lastSentTime.getTime()) / 1000 < 300) {
        console.warn(`[Notification Service] Duplicate eBill SMS detected within 5 mins for order: ${orderId}`);
        return false;
      }
    }

    const response = await fetch("https://api.textit.biz/", {
      method: "POST",
      headers: {
        Authorization: `Basic ${TEXT_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify({ to: cleanPhone, text }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    console.log(`[Notification Service] eBill SMS sent for order ${orderId} to ${cleanPhone}`);

    await adminFirestore.collection(NOTIFICATION_TRACKER).add({
      orderId,
      type: "ebill_sms",
      to: cleanPhone,
      hashValue,
      createdAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error(`[Notification Service] Failed to send eBill SMS for order ${orderId}:`, error);
    return false;
  }
};

/** * Send Order Confirmation Email via Firebase Extension
 * Robust error handling prevents crashes if order data is incomplete.
 * Uses stored totals directly instead of re-calculating.
 */
export const sendOrderConfirmedEmail = async (orderId: string) => {
  try {
    console.log(
      `[Notification Service] sendOrderConfirmedEmail called for order: ${orderId}`,
    );

    if (!orderId) {
      console.warn("[Notification Service] Missing orderId.");
      return false;
    }

    // 1. Fetch Order Data
    const order: Order = await getOrderByIdForInvoice(orderId);

    // CRASH PROOF: Check if order exists before proceeding
    if (!order) {
      console.warn(`[Notification Service] Order not found: ${orderId}`);
      return false;
    }

    // CRASH PROOF: Safely access email with optional chaining
    const email = order.customer?.email?.trim();

    if (!email) {
      console.warn(
        `[Notification Service] No valid email found for order: ${orderId}`,
      );
      return false;
    }

    // 2. Prevent Duplicate Emails (Idempotency)
    const hashValue = generateHash(email + "ORDER_CONFIRMATION" + orderId);

    const existing = await adminFirestore
      .collection(NOTIFICATION_TRACKER)
      .where("orderId", "==", orderId)
      .where("hashValue", "==", hashValue)
      .where("type", "==", "email")
      .get();

    if (!existing.empty) {
      console.warn(
        `[Notification Service] Duplicate Email detected for order: ${orderId}`,
      );
      return false;
    }

    // 3. Prepare Data for Handlebars Template

    // CRASH PROOF: Default to empty array if items is missing
    const safeItems = Array.isArray(order.items) ? order.items : [];

    // Calculate 'subtotal' only for display purposes (sum of items)
    // We keep this calculation because 'subtotal' is rarely stored explicitly on the root
    const subtotalRaw = safeItems.reduce(
      (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
      0,
    );

    // USE STORED VALUES (No Recalculation)
    // We cast to 'any' for total in case it's missing from your strict Order interface
    const totalRaw = (order as any).total || 0;
    const shippingRaw = order.shippingFee || 0;
    
    // Total discount = Item Discounts + Promotion Discount + Coupon Discount
    const itemDiscountsRaw = safeItems.reduce((acc, item) => acc + (item.discount || 0), 0);
    const promotionDiscountRaw = (order as any).promotionDiscount || 0;
    const discountRaw = (order.discount || 0) + promotionDiscountRaw + itemDiscountsRaw;

    const emailPayload = {
      to: [email],
      template: {
        name: "order_confirmation",
        data: {
          // CRASH PROOF: Fallbacks for all string fields
          customerName: order.customer?.name || "Customer",
          orderId: (order.orderId || orderId).toUpperCase(),

          items: safeItems.map((item) => {
            const netPrice = (item.price || 0) - (item.discount || 0);
            return {
              name: item.name || "Unknown Item",
              variantName: item.variantName || "",
              size: item.size || "-",
              quantity: item.quantity || 1,
              thumbnail:
                item.thumbnail || "https://placehold.co/100x100?text=No+Img",
              formattedPrice: formatMoney(netPrice),
              originalPrice: (item.discount || 0) > 0 ? formatMoney(item.price || 0) : null,
            };
          }),

          customer: {
            address: order.customer?.address || "N/A",
            city: order.customer?.city || "",
            phone: order.customer?.phone || "",
            shippingAddress: {
              line1: order.customer?.address || "N/A",
              city: order.customer?.city || "",
              postalCode: "",
              country: "Sri Lanka",
            },
          },

          paymentMethod: order.paymentMethod || "N/A",
          paymentStatus: order.paymentStatus || "Pending",

          // Formatted Values
          subtotal: formatMoney(subtotalRaw),
          shippingFee: formatMoney(shippingRaw),
          discount: discountRaw > 0 ? formatMoney(discountRaw) : null,
          total: formatMoney(totalRaw), // Uses the database total directly
        },
      },
    };

    // 4. Trigger Email
    console.log(`[Notification Service] Queuing email for ${email}`);
    await adminFirestore.collection(MAIL_COLLECTION).add(emailPayload);

    // 5. Log Notification
    await adminFirestore.collection(NOTIFICATION_TRACKER).add({
      orderId,
      type: "email",
      to: email,
      hashValue,
      createdAt: new Date(),
    });

    console.log(
      `[Notification Service] Email queued successfully for ${orderId}`,
    );
    return true;
  } catch (error) {
    console.error(
      `[Notification Service] CRITICAL ERROR sending email for order ${orderId}:`,
      error,
    );
    return false;
  }
};

/**
 * --- ERP INTERNAL NOTIFICATIONS ---
 */

export type AdminNotificationType = "ORDER" | "STOCK" | "SYSTEM" | "AI";

/**
 * Create a new notification for ERP administrators
 */
export const createAdminNotification = async (
  type: AdminNotificationType,
  title: string,
  message: string,
  metadata: Record<string, any> = {}
) => {
  try {
    const notification = {
      type,
      title,
      message,
      metadata,
      read: false,
      createdAt: new Date(),
    };

    const docId = `${type}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await adminFirestore.collection("erp_notifications").doc(docId).set(notification);
    
    // Send Native Push Notification via FCM Topic
    const payload = {
      topic: "admin_alerts",
      notification: {
        title: title,
        body: message,
      },
      data: {
        type,
        click_action: "FLUTTER_NOTIFICATION_CLICK", // Standard for some handlers, but we use web handlers
        ...Object.keys(metadata).reduce((acc: any, key) => {
          acc[key] = String(metadata[key]);
          return acc;
        }, {})
      },
      webpush: {
        fcmOptions: {
          link: metadata.orderId ? `/orders/${metadata.orderId}` : "/dashboard"
        }
      }
    };

    const { getMessaging } = await import("firebase-admin/messaging");
    await getMessaging().send(payload);

    console.log(`[Notification Service] Admin Notification & Push Sent: ${title}`);
    return true;
  } catch (error) {
    console.error("[Notification Service] Failed to create admin notification:", error);
    return false;
  }
};

/**
 * Subscribe a token to the admin alerts topic
 */
export const subscribeToAdminAlerts = async (token: string) => {
  try {
    const { getMessaging } = await import("firebase-admin/messaging");
    await getMessaging().subscribeToTopic([token], "admin_alerts");
    console.log(`[Notification Service] Token subscribed to admin_alerts.`);
    return true;
  } catch (error: any) {
    console.error("[Notification Service] Topic subscription failed:", error);
    return false;
  }
};

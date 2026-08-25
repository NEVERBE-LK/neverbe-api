import { NextRequest, NextResponse } from "next/server";
import { checkSpammer } from "@/services/SpammerService";
import { adminFirestore } from "@/firebase/firebaseAdmin";
import { decryptOrderCustomer } from "@/services/EncryptionService";
import { formatPhoneForSMS } from "@/services/UtilService";
import { verifyCaptchaToken } from "@/services/CapchaService";

/**
 * Validate reCAPTCHA v3 Token Guard
 */
async function validateCaptchaGuard(req: NextRequest, bodyToken?: string): Promise<{ valid: boolean; message?: string }> {
  // If secret key is not set (e.g. dev environment), log and pass
  if (!process.env.RECAPTCHA_SECRET_KEY) {
    return { valid: true };
  }

  // Allow authenticated admin requests to bypass captcha
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return { valid: true };
  }

  const { searchParams } = new URL(req.url);
  const token =
    req.headers.get("x-recaptcha-token") ||
    req.headers.get("g-recaptcha-response") ||
    searchParams.get("recaptchaToken") ||
    searchParams.get("captchaToken") ||
    searchParams.get("token") ||
    bodyToken;

  if (!token) {
    return { valid: false, message: "Security verification required: Missing reCAPTCHA token." };
  }

  const isHuman = await verifyCaptchaToken(token);
  if (!isHuman) {
    return { valid: false, message: "Security verification failed: Invalid reCAPTCHA response." };
  }

  return { valid: true };
}

export async function processCustomerRisk(query: {
  phone?: string;
  email?: string;
  name?: string;
  address?: string;
  city?: string;
  zip?: string;
}) {
  const { phone, email, name, address, city } = query;

  let isBlacklisted = false;
  let blacklistReason = "";
  let matchedFields = {
    phoneMatch: false,
    emailMatch: false,
    nameMatch: false,
    addressMatch: false,
  };

  const spammerCheck = await checkSpammer({ phone, email, name, address });
  if (spammerCheck.isBlacklisted) {
    isBlacklisted = true;
    blacklistReason = spammerCheck.reason || "Blacklisted Spammer";
    if (spammerCheck.matchField === "phone") matchedFields.phoneMatch = true;
    if (spammerCheck.matchField === "email") matchedFields.emailMatch = true;
    if (spammerCheck.matchField === "name") matchedFields.nameMatch = true;
    if (spammerCheck.matchField === "address") matchedFields.addressMatch = true;
  }

  let totalOrders = 0;
  let successfulOrders = 0;
  let refusedCodCount = 0;
  let exchangeCount = 0;
  let returnedOrders = 0;
  let pendingCodCount = 0;
  let addressMatchCount = 0;

  try {
    const snapshot = await adminFirestore.collection("orders").limit(500).get();
    const targetPhone = phone ? formatPhoneForSMS(phone) : "";
    const targetEmail = (email || "").toLowerCase().trim();
    const targetName = (name || "").toLowerCase().trim();
    const targetAddress = (address || "").toLowerCase().trim();

    snapshot.docs.forEach((doc) => {
      const rawData = doc.data();
      const orderId = doc.id;
      const decryptedCustomer = decryptOrderCustomer(rawData.customer, orderId);

      const custPhone = formatPhoneForSMS(decryptedCustomer?.phone);
      const custEmail = (decryptedCustomer?.email || "").toLowerCase().trim();
      const custName = (decryptedCustomer?.name || "").toLowerCase().trim();
      const custAddr = (decryptedCustomer?.address || "").toLowerCase().trim();

      const isPhoneMatch = targetPhone && custPhone && (custPhone === targetPhone || custPhone.endsWith(targetPhone.slice(-9)));
      const isEmailMatch = targetEmail && custEmail && custEmail === targetEmail;
      const isNameMatch = targetName && custName && custName === targetName && targetName.length > 2;
      const isAddrMatch = targetAddress && custAddr && custAddr.length > 5 && (custAddr === targetAddress || custAddr.includes(targetAddress) || targetAddress.includes(custAddr));

      if (isPhoneMatch) matchedFields.phoneMatch = true;
      if (isEmailMatch) matchedFields.emailMatch = true;
      if (isNameMatch) matchedFields.nameMatch = true;
      if (isAddrMatch) {
        matchedFields.addressMatch = true;
        addressMatchCount++;
      }

      if (isPhoneMatch || isEmailMatch || isNameMatch || isAddrMatch) {
        totalOrders++;
        const status = (rawData.status || "").toUpperCase();
        const returnReason = (rawData.returnReason || "").toUpperCase();

        if (status === "COMPLETED") {
          successfulOrders++;
        } else if (status === "REFUSED (RTO)" || status === "REFUSED" || returnReason === "REFUSED_COD_DELIVERY") {
          refusedCodCount++;
        } else if (status === "EXCHANGED" || returnReason === "EXCHANGE" || returnReason === "SIZE_FIT") {
          exchangeCount++;
        } else if (status === "RETURNED") {
          returnedOrders++;
        } else if (status === "PENDING" || status === "PROCESSING") {
          pendingCodCount++;
        }
      }
    });
  } catch (err) {
    console.warn("[Customer Risk History] Order query error:", err);
  }

  // 📊 Calculate Risk Score & Risk Level
  let score = 0;
  if (isBlacklisted) score += 75;
  if (refusedCodCount > 0) score += Math.min(refusedCodCount * 40, 80);
  if (addressMatchCount > 0 && refusedCodCount > 0) score += 30;

  const nonExchangeReturns = Math.max(0, returnedOrders - exchangeCount);
  if (totalOrders >= 3 && nonExchangeReturns >= 2 && (nonExchangeReturns / totalOrders) > 0.5) {
    score += 35;
  }
  if (pendingCodCount >= 2) score += 30;
  if (successfulOrders >= 2 && refusedCodCount === 0) {
    score = Math.max(0, score - 35);
  }

  let riskLevel = "LOW";
  if (score >= 75 || isBlacklisted) {
    riskLevel = "CRITICAL";
  } else if (score >= 50) {
    riskLevel = "HIGH";
  } else if (score >= 25) {
    riskLevel = "MEDIUM";
  }

  return {
    score,
    riskLevel,
    riskStatus: riskLevel,
    isBlacklisted,
    blacklistReason,
    totalOrders,
    successfulOrders,
    refusedCodCount,
    exchangeCount,
    returnedOrders,
    pendingCodCount,
    addressMatch: matchedFields.addressMatch,
    matchedFields,
  };
}

/**
 * GET: Retrieve customer risk history & blacklist status for Fraud Engine
 */
export async function GET(req: NextRequest) {
  try {
    const captchaCheck = await validateCaptchaGuard(req);
    if (!captchaCheck.valid) {
      return NextResponse.json({ success: false, message: captchaCheck.message }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const query = {
      phone: searchParams.get("phone") || undefined,
      email: searchParams.get("email") || undefined,
      name: searchParams.get("name") || undefined,
      address: searchParams.get("address") || undefined,
      city: searchParams.get("city") || undefined,
      zip: searchParams.get("zip") || undefined,
    };

    const res = await processCustomerRisk(query);
    return NextResponse.json(res);
  } catch (error: any) {
    console.error("[Customer Risk History Error]", error);
    return NextResponse.json({
      score: 0,
      riskLevel: "LOW",
      riskStatus: "LOW",
      isBlacklisted: false,
      blacklistReason: "",
      totalOrders: 0,
      successfulOrders: 0,
      refusedCodCount: 0,
      exchangeCount: 0,
      returnedOrders: 0,
      pendingCodCount: 0,
      addressMatch: false,
      matchedFields: { phoneMatch: false, emailMatch: false, nameMatch: false, addressMatch: false },
    });
  }
}

/**
 * POST: Evaluate customer risk with full customer JSON payload
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const captchaCheck = await validateCaptchaGuard(req, body.recaptchaToken || body.captchaToken || body.token);
    if (!captchaCheck.valid) {
      return NextResponse.json({ success: false, message: captchaCheck.message }, { status: 400 });
    }

    const res = await processCustomerRisk(body);
    return NextResponse.json(res);
  } catch (error: any) {
    console.error("[Customer Risk History POST Error]", error);
    return NextResponse.json({
      score: 0,
      riskLevel: "LOW",
      riskStatus: "LOW",
      isBlacklisted: false,
      blacklistReason: "",
      totalOrders: 0,
      successfulOrders: 0,
      refusedCodCount: 0,
      exchangeCount: 0,
      returnedOrders: 0,
      pendingCodCount: 0,
      addressMatch: false,
      matchedFields: { phoneMatch: false, emailMatch: false, nameMatch: false, addressMatch: false },
    });
  }
}

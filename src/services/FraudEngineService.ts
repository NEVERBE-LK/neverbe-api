import axios from "axios";
import { processCustomerRisk } from "@/app/api/v1/erp/orders/customer-risk-history/route";

export interface CustomerFormData {
  phone?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  address?: string;
  city?: string;
  zip?: string;
}

export interface ThirdPartyRiskResult {
  isHighRisk: boolean;
  fraudScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isValid: boolean;
  isActive: boolean;
  isDisposable: boolean;
  isSpammer: boolean;
  lineType: string;
  reasons: string[];
  actionRequired: string;
  noticeMessage: string;
}

export interface FraudEngineResult {
  finalScore: number;
  isHighRisk: boolean;
  probability: number;
  entropyScore: number;
  subScores: {
    phoneScore: number;
    emailScore: number;
    addressScore: number;
    nameScore: number;
    historyScore: number;
    entropyPenalty: number;
    trustBonus: number;
  };
  reasons: string[];
  matchedFields: any;
  algorithm: string;
}

export interface CompositeRiskResult {
  isHighRisk: boolean;
  fraudScore: number;
  probability: number;
  ipqsScore: number;
  localScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isValid: boolean;
  isActive: boolean;
  isDisposable: boolean;
  isSpammer: boolean;
  lineType: string;
  reasons: string[];
  actionRequired: string;
  noticeMessage: string;
  algorithm: string;
}

const DISPOSABLE_EMAIL_DOMAINS = new Set(["mailinator.com", "10minutemail.com", "tempmail.com", "guerrillamail.com", "throwawaymail.com", "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "mailnesia.com", "maildrop.cc", "sharklasers.com", "binkmail.com", "safetymail.info", "temp-mail.org", "fakemailgenerator.com", "emailondeck.com"]);
const TYPO_EMAIL_DOMAINS: Record<string, string> = { "gmal.com": "gmail.com", "gamil.com": "gmail.com", "gmial.com": "gmail.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "hotmal.com": "hotmail.com", "outlok.com": "outlook.com" };
const JUNK_NAME_PATTERNS = [/^test$/i, /^asdf$/i, /^admin$/i, /^user$/i, /^fake$/i, /^demo$/i, /^sample$/i, /^null$/i, /^undefined$/i, /^\w$/, /^\d+$/, /[!@#$%^&*()_+={}\[\]:;<>?,]/];
const DUMMY_PHONE_PATTERNS = [/07[0-8]1234567/, /07[0-8]7654321/, /07[0-8]0000000/, /(\d)\1{7,}/];
const VALID_SL_MOBILE_PREFIXES = ["070", "071", "072", "074", "075", "076", "077", "078"];

function calculateShannonEntropy(str: string): number {
  if (!str) return 0;
  const chars = str.toLowerCase().replace(/\s+/g, "").split("");
  if (chars.length === 0) return 0;
  const freqMap: Record<string, number> = {};
  for (const char of chars) { freqMap[char] = (freqMap[char] || 0) + 1; }
  let entropy = 0;
  const len = chars.length;
  for (const char in freqMap) {
    const p = freqMap[char] / len;
    entropy -= p * Math.log2(p);
  }
  return parseFloat(entropy.toFixed(3));
}

function evaluateTextNaturalness(text: string): { anomalyScore: number; reason?: string } {
  if (!text) return { anomalyScore: 0.8, reason: "Empty input string" };
  const clean = text.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length < 3) return { anomalyScore: 0.6, reason: "Input string too short (< 3 letters)" };
  const vowels = (clean.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowels / clean.length;
  if (vowelRatio < 0.15 || vowelRatio > 0.70) return { anomalyScore: 0.75, reason: `Unusual vowel distribution (${(vowelRatio * 100).toFixed(0)}% vowels)` };
  return { anomalyScore: 0.0 };
}

function calculateLogisticProbability(rawScore: number): { probability: number; scaledScore: number } {
  const offset = 40; const scale = 14;
  const z = (rawScore - offset) / scale;
  const probability = parseFloat((1 / (1 + Math.exp(-z))).toFixed(4));
  const scaledScore = Math.min(100, Math.max(0, Math.round(probability * 100)));
  return { probability, scaledScore };
}

function normalizePhoneDigits(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("94")) cleaned = "0" + cleaned.substring(2);
  return cleaned;
}

function formatSriLankaPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("94")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+94${cleaned.substring(1)}`;
  if (cleaned.length === 9) return `+94${cleaned}`;
  return `+${cleaned}`;
}

export async function evaluateThirdPartyPhoneRisk(rawPhone: string, thresholdScore = 60, actionMode: "PREPAY_DELIVERY_FEE" | "FULL_PREPAYMENT_ONLY" | "FLAG_FOR_MANUAL_REVIEW" = "PREPAY_DELIVERY_FEE"): Promise<ThirdPartyRiskResult> {
  const defaultResult: ThirdPartyRiskResult = { isHighRisk: false, fraudScore: 0, riskLevel: "LOW", isValid: true, isActive: true, isDisposable: false, isSpammer: false, lineType: "Mobile", reasons: [], actionRequired: "NONE", noticeMessage: "" };
  if (!rawPhone || rawPhone.trim().length < 8) return defaultResult;
  const apiKey = "UXyahAsjd1X9os7l0tzrQbJwrG4RepQb";
  try {
    const formattedPhone = formatSriLankaPhone(rawPhone);
    const url = `https://www.ipqualityscore.com/api/json/phone/${encodeURIComponent(apiKey)}/${encodeURIComponent(formattedPhone)}?strictness=1`;
    const response = await axios.get(url, { timeout: 5000 });
    const data = response.data;
    if (!data || data.success === false) return defaultResult;
    const fraudScore = Number(data.fraud_score || 0);
    const isValid = Boolean(data.valid !== false);
    const isActive = Boolean(data.active !== false);
    const isDisposable = Boolean(data.disposable || data.temporary);
    const isSpammer = Boolean(data.spammer || data.leaked);
    const lineType = String(data.line_type || "Mobile");
    const reasons: string[] = [];
    if (fraudScore >= thresholdScore) reasons.push(`High IPQS Fraud Score (${fraudScore}/100)`);
    if (!isValid) reasons.push("Invalid or unreachable mobile number");
    if (!isActive) reasons.push("Inactive / Disconnected line status");
    if (isDisposable) reasons.push("Disposable or temporary VOIP virtual line");
    if (isSpammer) reasons.push("Identified in global spammer / fraud databases");
    const isHighRisk = fraudScore >= thresholdScore || !isValid || isDisposable || isSpammer;
    let riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
    if (fraudScore >= 85 || isSpammer) riskLevel = "CRITICAL";
    else if (fraudScore >= 60 || isDisposable) riskLevel = "HIGH";
    else if (fraudScore >= 40) riskLevel = "MEDIUM";
    const noticeMessage = isHighRisk ? "Due to high return/spam risk on past network activity, delivery fee prepayment (Rs. 450) is required for COD orders." : "";
    return { isHighRisk, fraudScore, riskLevel, isValid, isActive, isDisposable, isSpammer, lineType, reasons, actionRequired: isHighRisk ? actionMode : "NONE", noticeMessage };
  } catch (error: any) {
    return defaultResult;
  }
}

export async function calculateCentralizedFraudRisk(data: CustomerFormData, thresholdScore = 50): Promise<FraudEngineResult> {
  let phoneScore = 0, emailScore = 0, addressScore = 0, nameScore = 0, historyScore = 0, entropyPenalty = 0, trustBonus = 0;
  const reasons: string[] = [];
  const matchedFields = { phoneMatch: false, emailMatch: false, addressMatch: false, junkAddress: false, junkName: false, invalidCarrier: false };
  const normPhone = normalizePhoneDigits(data.phone || "");
  const normEmail = (data.email || "").trim().toLowerCase();
  const normAddress = (data.address || "").trim().toLowerCase();
  const normCity = (data.city || "").trim().toLowerCase();
  const firstName = (data.first_name || "").trim();
  const lastName = (data.last_name || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();

  if (normPhone) {
    if (normPhone.length !== 10) { phoneScore += 35; reasons.push("Invalid mobile number length"); }
    else {
      const prefix = normPhone.substring(0, 3);
      if (!VALID_SL_MOBILE_PREFIXES.includes(prefix)) { phoneScore += 30; matchedFields.invalidCarrier = true; reasons.push(`Non-mobile / fixed landline prefix (${prefix}) used for mobile delivery SMS`); }
    }
    if (DUMMY_PHONE_PATTERNS.some((pattern) => pattern.test(normPhone))) { phoneScore += 45; reasons.push("Sequential or repeated dummy phone number pattern"); }
  } else { phoneScore += 50; reasons.push("Missing customer phone number"); }

  if (normEmail) {
    const domain = normEmail.split("@")[1];
    if (domain) {
      if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) { emailScore += 40; matchedFields.emailMatch = true; reasons.push("Disposable or temporary burner email domain"); }
      if (TYPO_EMAIL_DOMAINS[domain]) { emailScore += 20; reasons.push(`Suspicious email domain typo (${domain} -> ${TYPO_EMAIL_DOMAINS[domain]})`); }
    }
    if (normEmail.includes("test@") || normEmail.includes("fake@")) { emailScore += 35; reasons.push("Test / placeholder email address"); }
  }

  if (!firstName) { nameScore += 20; reasons.push("Missing first name"); }
  if (!lastName) { nameScore += 15; reasons.push("Single-word name provided (missing last name)"); }
  if (fullName) {
    if (JUNK_NAME_PATTERNS.some((pattern) => pattern.test(firstName) || pattern.test(lastName))) { nameScore += 35; matchedFields.junkName = true; reasons.push("Suspicious or fake name pattern detected"); }
    const nameNaturalness = evaluateTextNaturalness(fullName);
    if (nameNaturalness.anomalyScore > 0) { nameScore += Math.round(nameNaturalness.anomalyScore * 25); reasons.push(`Name perplexity anomaly (${nameNaturalness.reason})`); }
  }

  if (normAddress) {
    const addressEntropy = calculateShannonEntropy(normAddress);
    if (normAddress.length < 12) { addressScore += 35; matchedFields.junkAddress = true; reasons.push("Extremely short or incomplete street address (< 12 characters)"); }
    else if (!/\d/.test(normAddress) && !/no|#|house|flat|road|street|lane/i.test(normAddress)) { addressScore += 20; matchedFields.junkAddress = true; reasons.push("Street address missing house number or landmark identifier"); }
    if (addressEntropy < 2.0 && normAddress.length > 15) { entropyPenalty += 30; matchedFields.junkAddress = true; reasons.push(`Low information entropy in street address (H=${addressEntropy})`); }
    if (normCity && normAddress === normCity) { addressScore += 30; matchedFields.junkAddress = true; reasons.push("City name duplicated as street address"); }
  } else { addressScore += 50; reasons.push("Missing street address"); }

  try {
    const history = await processCustomerRisk({
      phone: normPhone,
      email: normEmail,
      name: fullName,
      address: normAddress,
      city: normCity
    });

    if (history) {
      const totalOrders = Number(history.totalOrders || 0);
      const successCount = Number(history.successfulOrders || 0);
      const refusedCodCount = Number(history.refusedCodCount || 0);
      if (history.isBlacklisted) { matchedFields.phoneMatch = true; historyScore += 75; reasons.push(`Flagged in NEVERBE Internal Spammer Blacklist (${history.blacklistReason || "Manual Blacklist"})`); }
      if (refusedCodCount > 0) { matchedFields.phoneMatch = true; historyScore += Math.min(refusedCodCount * 45, 90); reasons.push(`Customer has ${refusedCodCount} past refused COD / uncollected parcel RTO record(s)`); }
      if (history.addressMatch && refusedCodCount > 0) { matchedFields.addressMatch = true; historyScore += 25; reasons.push("Street address matches past refused COD delivery location"); }
      if (successCount >= 2 && refusedCodCount === 0) { trustBonus = Math.min(successCount * 20, 50); reasons.push(`Verified repeat customer with ${successCount} successfully delivered orders`); }
    }
  } catch (err) { }

  const rawFeatureSum = phoneScore + emailScore + addressScore + nameScore + historyScore + entropyPenalty - trustBonus;
  const { probability, scaledScore } = calculateLogisticProbability(rawFeatureSum);
  const isHighRisk = scaledScore >= thresholdScore;
  const overallEntropy = calculateShannonEntropy(`${fullName} ${normAddress} ${normEmail}`);

  return { finalScore: scaledScore, isHighRisk, probability, entropyScore: overallEntropy, subScores: { phoneScore, emailScore, addressScore, nameScore, historyScore, entropyPenalty, trustBonus }, reasons, matchedFields, algorithm: "LOGISTIC_SIGMOID_SHANNON_ENTROPY_V2" };
}

export async function evaluateUnifiedFraudRisk(customerData: CustomerFormData, thresholdScore = 50): Promise<CompositeRiskResult> {
  const [thirdPartyResult, localResult] = await Promise.all([
    evaluateThirdPartyPhoneRisk(customerData.phone || "", thresholdScore, "PREPAY_DELIVERY_FEE"),
    calculateCentralizedFraudRisk(customerData, thresholdScore),
  ]);

  const compositeRawScore = Math.max(thirdPartyResult.fraudScore, localResult.finalScore);
  const { probability, scaledScore } = calculateLogisticProbability(compositeRawScore);
  const isHighRisk = scaledScore >= thresholdScore || thirdPartyResult.isHighRisk || localResult.isHighRisk;

  let riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
  if (scaledScore >= 80 || thirdPartyResult.riskLevel === "CRITICAL") riskLevel = "CRITICAL";
  else if (scaledScore >= 60 || thirdPartyResult.riskLevel === "HIGH") riskLevel = "HIGH";
  else if (scaledScore >= 35) riskLevel = "MEDIUM";

  const allReasons = Array.from(new Set([...thirdPartyResult.reasons, ...localResult.reasons]));
  const noticeMessage = isHighRisk ? "Due to high return/spam risk on past network activity, delivery fee prepayment (Rs. 450) is required for COD orders." : "";

  return { isHighRisk, fraudScore: scaledScore, probability, ipqsScore: thirdPartyResult.fraudScore, localScore: localResult.finalScore, riskLevel, isValid: thirdPartyResult.isValid, isActive: thirdPartyResult.isActive, isDisposable: thirdPartyResult.isDisposable, isSpammer: thirdPartyResult.isSpammer || localResult.subScores.historyScore >= 75, lineType: thirdPartyResult.lineType, reasons: allReasons, actionRequired: isHighRisk ? "PREPAY_DELIVERY_FEE" : "NONE", noticeMessage, algorithm: "LOGISTIC_SIGMOID_SHANNON_ENTROPY_V2" };
}

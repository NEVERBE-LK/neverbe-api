import { Timestamp } from "firebase-admin/firestore";
import dayjs, { SL_TZ } from "../utils/dayjs";

/**
 * Safe conversion of various date types to Sri Lanka localized string
 */
export const toSafeLocaleString = (val: any) => {
  if (!val) return null;

  try {
    let date: Date;

    // Handle Firestore Timestamp instances or raw objects with _seconds or seconds
    if (val instanceof Timestamp) {
      date = val.toDate();
    } else if (typeof val.toDate === "function") {
      date = val.toDate();
    } else if (val && typeof val === "object" && ("_seconds" in val || "seconds" in val)) {
      // Handle serialized raw Firestore object
      const s = val._seconds ?? val.seconds;
      const ns = val._nanoseconds ?? val.nanoseconds ?? 0;
      date = new Date(s * 1000 + ns / 1000000);
    } else {
      date = new Date(val);
    }

    if (isNaN(date.getTime())) return String(val);

    const formatStr = "DD/MM/YYYY, hh:mm:ss a";
    return dayjs(date).tz(SL_TZ).format(formatStr);
  } catch {
    return String(val);
  }
};

/**
 * Get current time in Sri Lanka
 */
export const getNowSL = () => dayjs().tz(SL_TZ);

/**
 * Format to Sri Lanka Time (Full)
 */
export const formatToSLTime = (val: any, formatStr: string = "DD/MM/YYYY, hh:mm:ss a") => {
  const d = parseToDayjs(val);
  return d ? d.tz(SL_TZ).format(formatStr) : "";
};

/**
 * Format to Sri Lanka Date (Short)
 */
export const formatToSLDate = (val: any, formatStr: string = "MMM DD") => {
  const d = parseToDayjs(val);
  return d ? d.tz(SL_TZ).format(formatStr) : "";
};

/**
 * Centralized Date Formatter for Entities
 * Automatically formats specified keys (defaults to createdAt, updatedAt)
 */
export const formatEntityDates = <T extends object>(
  entity: T,
  dateKeys: (keyof T)[] = ["createdAt" as keyof T, "updatedAt" as keyof T]
): T => {
  if (!entity) return entity;
  const result = { ...entity };
  dateKeys.forEach((key) => {
    if (result[key]) {
      (result as any)[key] = toSafeLocaleString(result[key]);
    }
  });
  return result;
};

/**
 * Centralized Date Formatter for Lists
 */
export const formatListDates = <T extends object>(
  list: T[],
  dateKeys: (keyof T)[] = ["createdAt" as keyof T, "updatedAt" as keyof T]
): T[] => {
  if (!Array.isArray(list)) return list;
  return list.map((item) => formatEntityDates(item, dateKeys));
};

/**
 * Robust Date Parser for Sri Lanka Time
 * Handles Timestamps, ISO strings, and custom formats
 */
export const parseToDayjs = (val: any) => {
  if (!val) return null;
  if (val instanceof Timestamp) return dayjs(val.toDate());
  if (typeof val.toDate === "function") return dayjs(val.toDate());

  if (val && typeof val === "object" && ("_seconds" in val || "seconds" in val)) {
    const s = val._seconds ?? val.seconds;
    const ns = val._nanoseconds ?? val.nanoseconds ?? 0;
    return dayjs(new Date(s * 1000 + ns / 1000000));
  }

  if (typeof val === "string") {
    const formats = [
      "DD/MM/YYYY, hh:mm:ss a",
      "DD/MM/YYYY, h:mm:ss a",
      "DD/MM/YYYY",
      "YYYY-MM-DD",
    ];
    for (const f of formats) {
      const p = dayjs(val, f, true);
      if (p.isValid()) return p;
    }
    return dayjs(val); // Fallback to auto
  }
  const final = dayjs(val);
  return final.isValid() ? final : null;
};

/**
 * Format phone number to Sri Lanka E.164 standard (947XXXXXXXX)
 */
export const formatPhoneForSMS = (phone: string | null | undefined): string => {
  if (!phone) return "";
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+94")) {
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith("0")) {
    cleaned = "94" + cleaned.substring(1);
  } else if (cleaned.length === 9 && !cleaned.startsWith("94")) {
    cleaned = "94" + cleaned;
  }
  return cleaned;
};

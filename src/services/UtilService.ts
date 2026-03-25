import { Timestamp } from "firebase-admin/firestore";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const toSafeLocaleString = (val: any) => {
  if (!val) return null;

  try {
    // Convert Firestore Timestamp → JS Date
    const date =
      val instanceof Timestamp
        ? val.toDate()
        : typeof (val as Timestamp)?.toDate === "function"
        ? (val as Timestamp).toDate()
        : new Date(val);

    if (isNaN(date.getTime())) return String(val);

    const timeZone = "Asia/Colombo";
    // date-fns format: "dd/MM/yyyy, hh:mm:ss a" 
    // dayjs format equivalent: "DD/MM/YYYY, hh:mm:ss a"
    // Note: dayjs 'hh' is 12-hour, 'a' is am/pm. 'DD' is day, 'MM' is month. 
    const formatStr = "DD/MM/YYYY, hh:mm:ss a"; 

    return dayjs(date).tz(timeZone).format(formatStr);
  } catch {
    return String(val);
  }
};

/**
 * Recursively removes undefined values from an object to prevent Firestore errors.
 */
export const cleanData = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map((v) => cleanData(v));
  } else if (
    obj !== null &&
    typeof obj === "object" &&
    !(obj instanceof Date) &&
    !(obj instanceof Timestamp)
  ) {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, cleanData(v)])
    );
  }
  return obj;
};
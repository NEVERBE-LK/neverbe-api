import { spammerRepository } from "@/repositories/SpammerRepository";
import { SpammerRecord } from "@/model/SpammerRecord";
import { nanoid } from "nanoid";
import { formatEntityDates, formatListDates } from "./UtilService";

export const getSpammers = async () => {
  const records = await spammerRepository.findAll();
  return formatListDates(records);
};

export const createSpammer = async (data: Partial<SpammerRecord>) => {
  const id = `spm-${nanoid(8)}`;
  let severity = data.severity;
  if (!severity) {
    const reason = data.reason || "";
    if (reason.includes("Fraudulent") || reason.includes("Fake")) {
      severity = "CRITICAL";
    } else if (reason.includes("Blacklist")) {
      severity = "BLACKLISTED";
    } else {
      severity = "HIGH";
    }
  }

  const record: SpammerRecord = {
    ...data,
    severity,
    reason: data.reason || "Manual Anti-Spam Blacklist",
  };
  const saved = await spammerRepository.create(id, record as SpammerRecord);
  return formatEntityDates(saved);
};

export const deleteSpammer = async (id: string) => {
  await spammerRepository.delete(id);
  return { success: true, message: "Spammer record deleted" };
};

export const checkSpammer = async (queryOrPhone?: string | { phone?: string; email?: string; name?: string; address?: string }, email?: string) => {
  let query: { phone?: string; email?: string; name?: string; address?: string } = {};
  if (typeof queryOrPhone === "string") {
    query = { phone: queryOrPhone, email };
  } else if (queryOrPhone && typeof queryOrPhone === "object") {
    query = queryOrPhone;
  }

  const result = await spammerRepository.findMatch(query);
  if (result) {
    return {
      isBlacklisted: true,
      reason: result.match.reason || "Blacklisted Spammer",
      matchField: result.matchField,
      record: result.match,
    };
  }
  return { isBlacklisted: false };
};

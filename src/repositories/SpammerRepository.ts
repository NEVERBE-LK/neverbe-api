import { BaseRepository } from "./BaseRepository";
import { SpammerRecord } from "@/model/SpammerRecord";
import { formatPhoneForSMS } from "@/services/UtilService";

export class SpammerRepository extends BaseRepository<SpammerRecord> {
  constructor() {
    super("spammers");
  }

  async findAll(): Promise<SpammerRecord[]> {
    const snapshot = await this.collection.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SpammerRecord));
  }

  async findByPhone(phone: string): Promise<SpammerRecord | null> {
    if (!phone) return null;
    const targetPhone = formatPhoneForSMS(phone);
    const snapshot = await this.collection.get();
    const match = snapshot.docs.find((doc) => {
      const p = formatPhoneForSMS(doc.data().phone);
      return p && targetPhone && (p === targetPhone || p.endsWith(targetPhone.slice(-9)) || targetPhone.endsWith(p.slice(-9)));
    });
    if (match) return { id: match.id, ...match.data() } as SpammerRecord;
    return null;
  }

  async findByEmail(email: string): Promise<SpammerRecord | null> {
    if (!email) return null;
    const targetEmail = email.toLowerCase().trim();
    const snapshot = await this.collection.get();
    const match = snapshot.docs.find((doc) => {
      const e = (doc.data().email || "").toLowerCase().trim();
      return e && e === targetEmail;
    });
    if (match) return { id: match.id, ...match.data() } as SpammerRecord;
    return null;
  }

  async findMatch(query: { phone?: string; email?: string; name?: string; address?: string }): Promise<{ match: SpammerRecord; matchField: string } | null> {
    const targetPhone = query.phone ? formatPhoneForSMS(query.phone) : "";
    const targetEmail = query.email ? query.email.toLowerCase().trim() : "";
    const targetName = query.name ? query.name.toLowerCase().trim() : "";
    const targetAddress = query.address ? query.address.toLowerCase().trim() : "";

    const snapshot = await this.collection.get();
    for (const doc of snapshot.docs) {
      const data = doc.data() as SpammerRecord;
      const p = formatPhoneForSMS(data.phone);
      if (targetPhone && p && (p === targetPhone || p.endsWith(targetPhone.slice(-9)) || targetPhone.endsWith(p.slice(-9)))) {
        return { match: { id: doc.id, ...data }, matchField: "phone" };
      }
      const e = (data.email || "").toLowerCase().trim();
      if (targetEmail && e && e === targetEmail) {
        return { match: { id: doc.id, ...data }, matchField: "email" };
      }
      const n = (data.name || "").toLowerCase().trim();
      if (targetName && n && n === targetName && n.length > 2) {
        return { match: { id: doc.id, ...data }, matchField: "name" };
      }
      const a = (data.address || "").toLowerCase().trim();
      if (targetAddress && a && a.length > 5 && (a === targetAddress || a.includes(targetAddress) || targetAddress.includes(a))) {
        return { match: { id: doc.id, ...data }, matchField: "address" };
      }
    }
    return null;
  }
}

export const spammerRepository = new SpammerRepository();

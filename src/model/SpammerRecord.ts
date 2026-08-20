import { Timestamp } from "firebase-admin/firestore";

export interface SpammerRecord {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  reason?: string;
  severity?: "HIGH" | "CRITICAL" | "BLACKLISTED";
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

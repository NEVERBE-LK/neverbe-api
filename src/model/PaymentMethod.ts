import { Timestamp } from "firebase-admin/firestore";

export interface PaymentMethod {
  id: string;
  paymentId: string;
  name: string;
  description: string;
  fee: number;
  customerFee?: number;
  imageUrl?: string;
  status: boolean;
  isDeleted?: boolean;
  available: string[];

  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}

import { firestore } from "firebase-admin";
import Timestamp = firestore.Timestamp;

export interface GRNItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  size: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: number;
  totalCost: number;
  stockId: string; // Stock location where received
}

export interface GRN {
  id?: string;
  grnNumber: string;
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  items: GRNItem[];
  totalAmount: number;
  notes?: string;
  receivedBy?: string;
  receivedDate: string;
  inventoryUpdated: boolean; // Flag to track if stock was updated
  status: GRNStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: Timestamp | string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export type GRNStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED";

export const GRN_STATUS_LABELS: Record<GRNStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const GRN_STATUS_COLORS: Record<GRNStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

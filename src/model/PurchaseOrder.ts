import { firestore } from "firebase-admin";
import Timestamp = firestore.Timestamp;

export type PurchaseOrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED";

export interface PurchaseOrderItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  size: string;
  quantity: number;
  receivedQuantity?: number; // Updated when GRN is created
  unitCost: number;
  totalCost: number;
}

export interface PurchaseOrder {
  id?: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseOrderItem[];
  status: PurchaseOrderStatus;
  totalAmount: number;
  notes?: string;
  expectedDate?: string;
  stockId?: string; // Target stock location for receiving
  createdBy?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
};

export const PO_STATUS_COLORS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-green-100 text-green-800",
  COMPLETED: "bg-indigo-100 text-indigo-800",
  REJECTED: "bg-red-100 text-red-800",
};

import { firestore } from "firebase-admin";
import Timestamp = firestore.Timestamp;

export type AdjustmentType =
  | "add"
  | "remove"
  | "damage"
  | "return"
  | "transfer";

export interface AdjustmentItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  size: string;
  quantity: number;
  stockId: string;
  stockName?: string;
  destinationStockId?: string; // For transfers
  destinationStockName?: string;
}

export interface InventoryAdjustment {
  id?: string;
  adjustmentNumber: string;
  type: AdjustmentType;
  items: AdjustmentItem[];
  reason: string;
  notes?: string;
  adjustedBy?: string;
  adjustedByName?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: Timestamp | string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: Timestamp | string;
  status: AdjustmentStatus;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  add: "Stock Addition",
  remove: "Stock Removal",
  damage: "Damaged Goods",
  return: "Customer Return",
  transfer: "Stock Transfer",
};

export const ADJUSTMENT_TYPE_COLORS: Record<AdjustmentType, string> = {
  add: "bg-green-100 text-green-800",
  remove: "bg-red-100 text-red-800",
  damage: "bg-orange-100 text-orange-800",
  return: "bg-blue-100 text-blue-800",
  transfer: "bg-purple-100 text-purple-800",
};

export type AdjustmentStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED";

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETED: "Completed",
};

export const ADJUSTMENT_STATUS_COLORS: Record<AdjustmentStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  COMPLETED: "bg-indigo-100 text-indigo-800",
};

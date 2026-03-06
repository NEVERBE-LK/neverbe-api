import { firestore } from "firebase-admin";
import Timestamp = firestore.Timestamp;

export interface ExchangeItem {
  itemId: string;
  variantId: string;
  name: string;
  variantName: string;
  size: string;
  quantity: number;
  price: number;
  discount: number;
  bPrice?: number; // Buying price for profit tracking
}

export interface ExchangeRecord {
  id: string;
  originalOrderId: string; // Display order ID (e.g., "ORD-001")
  originalOrderDocId: string; // Firestore document ID
  stockId: string;
  returnedItems: ExchangeItem[];
  replacementItems: ExchangeItem[];
  returnTotal: number; // Total value of returned items
  replacementTotal: number; // Total value of replacement items
  priceDifference: number; // + = customer pays more, - = refund to customer
  paymentMethod?: string;
  paymentReceived?: number; // Actual payment received (for customer pays more)
  refundGiven?: number; // Actual refund given (for customer gets refund)
  status: "pending" | "completed" | "cancelled";
  processedBy: string; // User ID who processed the exchange
  processedByName?: string; // Display name
  notes?: string;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}

export interface ExchangeRequest {
  originalOrderId: string;
  stockId: string;
  returnedItems: ExchangeItem[];
  replacementItems: ExchangeItem[];
  paymentMethod?: string;
  notes?: string;
}

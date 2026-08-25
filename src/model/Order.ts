import { firestore } from "firebase-admin";
import Timestamp = firestore.Timestamp;
import { OrderItem } from "./OrderItem";
import { Customer } from "./Customer";
import { Payment } from "./Payment";

export interface Order {
  userId: string | null;
  orderId: string;
  paymentId: string;
  items: OrderItem[];
  paymentStatus: string;
  paymentMethod: string;
  paymentMethodId: string;
  total: number;
  status: string;
  shippingFee: number;
  transactionFeeCharge: number;
  fee: number;
  customer?: Customer;
  discount: number;
  from: string;
  sourceName?: string;
  storeName?: string;
  stockId?: string;
  paymentReceived?: Payment[];

  // Promotion & Coupon tracking
  couponCode?: string;
  appliedCouponId?: string | null;
  appliedPromotionId?: string | null; // Primary promotion (backward compat)
  appliedPromotionIds?: string[]; // All stacked promotion IDs
  couponDiscount?: number;
  promotionDiscount?: number;

  // Order Tracking
  trackingNumber?: string;
  courier?: string; // e.g. "Domex"
  estimatedDelivery?: Timestamp | string;
  statusHistory?: { status: string; date: Timestamp | string }[];

  restockedAt?: Timestamp | string;
  restocked?: boolean;
  cleanupProcessed?: boolean;
  returnReason?: string;
  returnNotes?: string;

  // Anti-Spam & Risk Protection
  riskStatus?: "NORMAL" | "HIGH_RISK";
  ipqsFraudScore?: number;
  ipqsRiskLevel?: string;
  ipqsLineType?: string;
  ipqsReasons?: string[];
  deliveryFeePrepaid?: boolean;
  deliveryFeeTxnId?: string;

  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}

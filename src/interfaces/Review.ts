import { Timestamp } from "@firebase/firestore";

export interface Review {
  reviewId: string;
  itemId: string;
  rating: number;
  review: string;
  userId: string;
  userName: string;
  source?: "GOOGLE" | "WEB";
  externalId?: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  isDeleted?: boolean;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}

import { firestore } from "firebase-admin";
import Timestamp = firestore.Timestamp;

export interface User {
  userId: string;
  username: string;
  email: string;
  role: string;
  password?: string;
  currentPassword?: string;
  status: boolean;
  isDeleted?: boolean;

  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
  photoURL?: string;
  permissions?: string[];
  phoneNumber?: string;
}

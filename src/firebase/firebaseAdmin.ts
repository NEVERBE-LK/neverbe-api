import admin, { credential } from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// Set environment variables for Google Cloud SDK auto-discovery
if (process.env.FIREBASE_PROJECT_ID) {
  process.env.GCLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
  process.env.GOOGLE_CLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
}

// 1. Keep your working initialization logic
if (!admin.apps.length) {
  if (process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    admin.initializeApp({
      credential: credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  } else {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
}

const db = getFirestore("default");
try { db.settings({ ignoreUndefinedProperties: true }); } catch (e) { }
export const adminFirestore = db;

export const adminAuth = admin.auth();
export const adminStorageBucket = process.env.FIREBASE_STORAGE_BUCKET
  ? admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET)
  : null;
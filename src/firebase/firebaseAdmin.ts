import admin, { credential } from "firebase-admin";

if (!admin.apps.length) {
  if (process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    admin.initializeApp({
      credential: credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
          /\\n/g,
          "\n",
        ),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  } else {
    admin.initializeApp();
  }
}

export const adminFirestore = admin.firestore();
export const adminAuth = admin.auth();
export const adminStorageBucket = admin
  .storage()
  .bucket(process.env.FIREBASE_STORAGE_BUCKET);

import { adminFirestore } from "@/firebase/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

const COLLECTION_NAME = "dashboard_cache";

/**
 * In-memory cache for ultra-fast session retrieval
 */
const inMemoryCache = new Map<string, { data: any; expiry: number }>();

/**
 * Get data from cache (In-memory first, then Firestore)
 */
export const getCache = async (key: string): Promise<any | null> => {
  const now = Date.now();

  // 1. Check In-Memory
  const mem = inMemoryCache.get(key);
  if (mem && mem.expiry > now) {
    console.log(`[CacheService] Memory Hit: ${key}`);
    return mem.data;
  }

  // 2. Check Firestore
  try {
    const doc = await adminFirestore.collection(COLLECTION_NAME).doc(key).get();
    if (doc.exists) {
      const { data, expiry } = doc.data() as { data: any; expiry: Timestamp };
      if (expiry.toMillis() > now) {
        console.log(`[CacheService] Firestore Hit: ${key}`);
        // Backfill memory
        inMemoryCache.set(key, { data, expiry: expiry.toMillis() });
        return data;
      } else {
        console.log(`[CacheService] Firestore Expired: ${key}`);
        await doc.ref.delete(); // Cleanup
      }
    }
  } catch (error) {
    console.error(`[CacheService] Get Error for ${key}:`, error);
  }

  return null;
};

/**
 * Set data to cache (Firestore + In-memory)
 */
export const setCache = async (
  key: string,
  data: any,
  ttlHours: number = 24,
): Promise<void> => {
  const expiryDate = new Date();
  expiryDate.setHours(expiryDate.getHours() + ttlHours);
  const expiryTimestamp = Timestamp.fromDate(expiryDate);

  try {
    // 1. Write to Firestore
    await adminFirestore.collection(COLLECTION_NAME).doc(key).set({
      data,
      expiry: expiryTimestamp,
      updatedAt: Timestamp.now(),
    });

    // 2. Update In-Memory
    inMemoryCache.set(key, { data, expiry: expiryDate.getTime() });
    console.log(`[CacheService] Cached: ${key} (TTL: ${ttlHours}h)`);
  } catch (error) {
    console.error(`[CacheService] Set Error for ${key}:`, error);
  }
};

/**
 * Clear specific cache key
 */
export const clearCache = async (key: string): Promise<void> => {
  inMemoryCache.delete(key);
  try {
    await adminFirestore.collection(COLLECTION_NAME).doc(key).delete();
    console.log(`[CacheService] Cleared: ${key}`);
  } catch (error) {
    console.error(`[CacheService] Clear Error for ${key}:`, error);
  }
};

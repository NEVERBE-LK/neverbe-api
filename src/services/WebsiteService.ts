import { adminFirestore } from "@/firebase/firebaseAdmin";

// ============ NAVIGATION LOGIC ============

export interface NavigationConfig {
  mainNav: any[];
  footerNav: any[];
}

export const getNavigationConfig = async () => {
  try {
    console.log("Fetching navigation config");
    const doc = await adminFirestore
      .collection("site_config")
      .doc("navigation")
      .get();
    if (!doc.exists) {
      return { mainNav: [], footerNav: [] };
    }
    return doc.data() as NavigationConfig;
  } catch (e) {
    console.error(e);
    throw e;
  }
};

export const saveNavigationConfig = async (config: NavigationConfig) => {
  try {
    console.log("Saving navigation config");
    await adminFirestore
      .collection("site_config")
      .doc("navigation")
      .set(config, { merge: true });
    return { success: true };
  } catch (e) {
    console.error("Error saving navigation config:", e);
    throw e;
  }
};

// ============ PROMOTIONS (BANNERS) LOGIC ============

export interface WebsitePromotion {
  id?: string;
  file: string;
  url: string;
  title: string;
  link: string;
  createdAt?: any;
}

export const getAllPromotions = async () => {
  try {
    const snapshot = await adminFirestore
      .collection("website_promotions")
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("Error getting promotions:", e);
    throw e;
  }
};

export const addPromotion = async (data: WebsitePromotion) => {
  try {
    const docRef = await adminFirestore.collection("website_promotions").add({
      ...data,
      createdAt: new Date(),
    });
    return { id: docRef.id, ...data, createdAt: new Date() };
  } catch (e) {
    console.error("Error adding promotion:", e);
    throw e;
  }
};

export const deletePromotion = async (id: string) => {
  try {
    await adminFirestore.collection("website_promotions").doc(id).delete();
    return { id };
  } catch (e) {
    console.error("Error deleting promotion:", e);
    throw e;
  }
};
// ... existing exports

// ============ BANNERS LOGIC ============

export const getAllBanners = async () => {
  try {
    const snapshot = await adminFirestore
      .collection("website_banners")
      .orderBy("createdAt", "desc")
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("Error getting banners:", e);
    throw e;
  }
};

export const addABanner = async (data: any) => {
  try {
    const docRef = await adminFirestore.collection("website_banners").add({
      ...data,
      createdAt: new Date(),
    });
    return { id: docRef.id, ...data };
  } catch (e) {
    console.error("Error adding banner:", e);
    throw e;
  }
};
export const deleteBanner = async (id: string) => {
  try {
    await adminFirestore.collection("website_banners").doc(id).delete();
    return { id };
  } catch (e) {
    console.error("Error deleting banner:", e);
    throw e;
  }
};

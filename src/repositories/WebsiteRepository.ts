import { BaseRepository } from "./BaseRepository";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Website Repository - handles sliders, navigation, and site-wide configs
 */
export class WebsiteRepository extends BaseRepository<any> {
  constructor() {
    super("site_config");
  }

  /**
   * Get website sliders
   */
  async getSliders(): Promise<any[]> {
    const snapshot = await this.collection.firestore
      .collection("sliders")
      .get();
    
    const sliders = snapshot.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
      };
    });

    sliders.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

    return sliders;
  }

  /**
   * Get navigation configuration
   */
  async getNavigationConfig(): Promise<{
    mainNav: any[];
    footerNav: any[];
    socialLinks?: any[];
  }> {
    const doc = await this.collection.doc("navigation").get();
    if (!doc.exists) {
      return { mainNav: [], footerNav: [] };
    }
    return doc.data() as any;
  }

  /**
   * Save navigation configuration
   */
  async saveNavigation(config: any): Promise<void> {
    await this.collection.doc("navigation").set({
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  /**
   * Add a banner
   */
  async addBanner(data: any): Promise<any> {
    const docRef = this.collection.firestore.collection("sliders").doc();
    
    const newItem = {
      ...data,
      id: docRef.id,
      createdAt: FieldValue.serverTimestamp(),
    };
    
    await docRef.set(newItem);
    
    return {
      ...newItem,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Delete a banner
   */
  async deleteBanner(id: string): Promise<any | null> {
    const docRef = this.collection.firestore.collection("sliders").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return null;
    
    const bannerData = doc.data();
    await docRef.delete();
    
    return { id, ...bannerData };
  }
}

export const websiteRepository = new WebsiteRepository();

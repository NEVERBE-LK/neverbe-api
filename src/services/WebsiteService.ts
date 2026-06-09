import { websiteRepository } from "@/repositories/WebsiteRepository";
import { adminStorageBucket } from "@/firebase/firebaseAdmin";
import { formatEntityDates, formatListDates } from "./UtilService";

/**
 * WebsiteService - Business logic for site configuration and banners
 * Delegates data access to websiteRepository
 */

export interface NavigationConfig {
  mainNav: any[];
  footerNav: any[];
}

export const getNavigationConfig = async () => {
  return await websiteRepository.getNavigationConfig();
};

export const saveNavigationConfig = async (config: NavigationConfig) => {
  await websiteRepository.saveNavigation(config);
  return { success: true };
};

export const getAllBanners = async () => {
  return formatListDates(await websiteRepository.getSliders());
};

export const addABanner = async (data: any) => {
  return await websiteRepository.addBanner(data);
};

export const deleteBanner = async (id: string) => {
  const bannerData = await websiteRepository.deleteBanner(id);
  
  if (bannerData?.url) {
    try {
      const urlParts = bannerData.url.split("/");
      const path = urlParts.slice(4).join("/");
      if (path && adminStorageBucket) {
        await adminStorageBucket.file(path).delete().catch(err => console.error("Storage delete err:", err));
      }
    } catch (e) {
      console.error("Error deleting storage file", e);
    }
  }

  return { id };
};

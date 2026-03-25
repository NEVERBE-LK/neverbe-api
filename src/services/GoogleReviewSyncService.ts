import axios from "axios";
import { reviewRepository } from "../repositories/ReviewRepository";
import { Review } from "../interfaces/Review";

/**
 * Service to sync reviews from Google Business Profile (via Places API)
 */
export class GoogleReviewSyncService {
  private static GOOGLE_PLACES_API_URL = "https://maps.googleapis.com/maps/api/place/details/json";

  /**
   * Sync reviews for a given Place ID
   * @param placeId Google Place ID
   * @param apiKey Google Places API Key
   */
  async syncGoogleReviews(placeId: string, apiKey: string): Promise<number> {
    try {
      const response = await axios.get(GoogleReviewSyncService.GOOGLE_PLACES_API_URL, {
        params: {
          place_id: placeId,
          fields: "reviews",
          key: apiKey,
        },
      });

      const { result } = response.data;
      if (!result || !result.reviews) {
        console.warn("[Google Sync] No reviews found for placeId:", placeId);
        return 0;
      }

      const googleReviews = result.reviews;
      let syncCount = 0;

      for (const gr of googleReviews) {
        // Map Google review to our internal Review interface
        const reviewData: Partial<Review> = {
          userName: gr.author_name,
          rating: gr.rating,
          review: gr.text,
          status: "APPROVED", // Auto-approve Google reviews as they are verified there
          source: "GOOGLE",
          externalId: `google_${gr.time}`,
          createdAt: new Date(gr.time * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
          isDeleted: false,
        };

        // Check if review already exists to avoid duplicates
        // For simplicity, we can use externalId or author + time
        // Here we'll just create it. In a real scenario, we'd check first.
        
        // Let's check via author and time if it exists
        const existingReviews = await reviewRepository.getLatestWebReviews(100);
        const exists = existingReviews.some(r => r.externalId === reviewData.externalId);

        if (!exists) {
          await reviewRepository.createReview(reviewData);
          syncCount++;
        }
      }

      return syncCount;
    } catch (error: any) {
      console.error("[Google Sync] Error syncing reviews:", error.message);
      throw error;
    }
  }
}

export const googleReviewSyncService = new GoogleReviewSyncService();

import { BaseRepository } from "./BaseRepository";
import { Review } from "../interfaces/Review";

/**
 * Review Repository - handles product/customer reviews
 */
export class ReviewRepository extends BaseRepository<Review> {
  constructor() {
    super("reviews");
  }

  /**
   * Get latest approved reviews for the website
   * @param limit Maximum number of reviews to fetch
   * @param itemId Optional product ID to filter by
   */
  async getLatestWebReviews(limit: number = 20, itemId?: string): Promise<Review[]> {
    let query = this.collection
      .where("status", "==", "APPROVED") // Only show verified/approved reviews
      .where("isDeleted", "==", false);

    if (itemId) {
      query = query.where("itemId", "==", itemId);
    }

    const snapshot = await query
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        reviewId: doc.id,
        createdAt: this.serializeTimestamp(data.createdAt),
        updatedAt: this.serializeTimestamp(data.updatedAt),
      } as Review;
    });
  }

  /**
   * Create a new review
   */
  async createReview(data: Partial<Review>): Promise<Review> {
    const docRef = this.collection.doc();
    const reviewData = {
      ...data,
      reviewId: docRef.id,
      status: "PENDING", // New reviews are pending by default
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await docRef.set(reviewData);
    return reviewData as Review;
  }

  /**
   * Get reviews by user ID
   */
  async getReviewsByUserId(uid: string): Promise<Review[]> {
    const snapshot = await this.collection
      .where("userId", "==", uid)
      .where("isDeleted", "==", false)
      .orderBy("createdAt", "desc")
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        reviewId: doc.id,
        createdAt: this.serializeTimestamp(data.createdAt),
        updatedAt: this.serializeTimestamp(data.updatedAt),
      } as Review;
    });
  }

  /**
   * Update a review
   */
  async updateReview(reviewId: string, data: Partial<Review>): Promise<boolean> {
    const docRef = this.collection.doc(reviewId);
    await docRef.update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * Delete a review (Soft delete)
   */
  async deleteReview(reviewId: string): Promise<boolean> {
    const docRef = this.collection.doc(reviewId);
    await docRef.update({
      isDeleted: true,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}

// Singleton instance
export const reviewRepository = new ReviewRepository();

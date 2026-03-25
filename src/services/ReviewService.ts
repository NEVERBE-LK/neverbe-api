import { reviewRepository } from "@/repositories/ReviewRepository";
import { Review } from "@/interfaces/Review";

/**
 * ReviewService - Business logic for product reviews
 */

export const getWebReviews = async (limit: number = 10, itemId?: string) => {
  return reviewRepository.getLatestWebReviews(limit, itemId);
};

export const createReview = async (uid: string, userName: string, data: any) => {
  return reviewRepository.createReview({
    ...data,
    userId: uid,
    userName: userName,
  });
};

export const getUserReviews = async (uid: string) => {
  return reviewRepository.getReviewsByUserId(uid);
};

export const updateReview = async (uid: string, reviewId: string, data: any) => {
  // Verify ownership
  const reviews = await reviewRepository.getReviewsByUserId(uid);
  if (!reviews.some((r) => r.reviewId === reviewId)) {
    throw new Error("Review not found or ownership mismatch");
  }
  return reviewRepository.updateReview(reviewId, data);
};

export const deleteReview = async (uid: string, reviewId: string) => {
  // Verify ownership
  const reviews = await reviewRepository.getReviewsByUserId(uid);
  if (!reviews.some((r) => r.reviewId === reviewId)) {
    throw new Error("Review not found or ownership mismatch");
  }
  return reviewRepository.deleteReview(reviewId);
};

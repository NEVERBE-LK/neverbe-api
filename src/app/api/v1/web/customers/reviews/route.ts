import { verifyToken } from "@/services/WebAuthService";
import { getUserReviews } from "@/services/ReviewService";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const token = await verifyToken(req);
    const uid = token.uid;

    const reviews = await getUserReviews(uid);

    return NextResponse.json(reviews);
  } catch (error: any) {
    console.error("Error fetching user reviews:", error);
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
}

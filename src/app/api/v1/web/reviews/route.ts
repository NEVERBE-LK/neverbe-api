import { getWebReviews, createReview } from "@/services/ReviewService";
import { verifyToken } from "@/services/WebAuthService";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "10");
    const itemId = searchParams.get("itemId") || undefined;

    const reviews = await getWebReviews(limit, itemId);
    
    return NextResponse.json(reviews);
  } catch (error: any) {
    console.error("Error fetching reviews:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const token = await verifyToken(req);
    const uid = token.uid;
    const userName = token.name || "Customer";

    const formData = await req.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return NextResponse.json({ error: "Missing data field" }, { status: 400 });
    }

    const data = JSON.parse(dataString);
    const result = await createReview(uid, userName, data);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error creating review:", error);
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
}

import { googleReviewSyncService } from "@/services/GoogleReviewSyncService";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const placeId = searchParams.get("placeId") || "ChIJ2TyZoff_4joRgDt7is46uRk";
    const apiKey = searchParams.get("apiKey") || process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Missing API Key. Provide apiKey in query or env." }, { status: 400 });
    }

    const count = await googleReviewSyncService.syncGoogleReviews(placeId, apiKey);

    return NextResponse.json({ 
      success: true, 
      message: `Successfully synced ${count} reviews from Google.`,
      count 
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

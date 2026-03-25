import { verifyToken } from "@/services/WebAuthService";
import { updateReview, deleteReview } from "@/services/ReviewService";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const token = await verifyToken(req);
    const uid = token.uid;
    const reviewId = params.id;

    const formData = await req.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return NextResponse.json({ error: "Missing data field" }, { status: 400 });
    }

    const data = JSON.parse(dataString);
    const result = await updateReview(uid, reviewId, data);

    return NextResponse.json({ success: result });
  } catch (error: any) {
    console.error("Error updating review:", error);
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const token = await verifyToken(req);
    const uid = token.uid;
    const reviewId = params.id;

    const result = await deleteReview(uid, reviewId);

    return NextResponse.json({ success: result });
  } catch (error: any) {
    console.error("Error deleting review:", error);
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
}

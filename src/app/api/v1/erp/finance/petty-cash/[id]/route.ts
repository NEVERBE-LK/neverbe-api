import { NextRequest, NextResponse } from "next/server";
import { authorizeAndGetUser } from "@/services/AuthService";
import { Timestamp } from "firebase-admin/firestore";
import {
  getPettyCashById,
  updatePettyCash,
  deletePettyCash,
  reviewPettyCash,
} from "@/services/PettyCashService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const user = await authorizeAndGetUser(req);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const entry = await getPettyCashById(id);

    if (!entry) return errorResponse("Petty Cash entry not found", 404);

    return NextResponse.json(entry);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const user = await authorizeAndGetUser(req);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("attachment") as File | null;
    const dataField = formData.get("data");

    if (!dataField) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(dataField as string);

    // Check if this is a review action (status change to APPROVED/REJECTED)
    if (data.status === "APPROVED" || data.status === "REJECTED") {
      const updatedEntry = await reviewPettyCash(
        id,
        data.status,
        user.userId || "system"
      );
      return NextResponse.json(updatedEntry);
    }

    // Regular update
    if (user.userId) {
      data.updatedBy = user.userId;
    }

    const updatedEntry = await updatePettyCash(id, data, file || undefined);
    return NextResponse.json(updatedEntry);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const user = await authorizeAndGetUser(req);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    await deletePettyCash(id);

    return NextResponse.json(
      { message: "Petty Cash entry deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    return errorResponse(error);
  }
};

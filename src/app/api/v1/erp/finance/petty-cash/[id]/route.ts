import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import {
  getPettyCashById,
  updatePettyCash,
  deletePettyCash,
  reviewPettyCash,
} from "@/services/PettyCashService";

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    await requirePermission(req, "view_petty_cash");

    const { id } = await params;
    const entry = await getPettyCashById(id);

    if (!entry) {
      return NextResponse.json({ success: false, message: "Petty Cash entry not found" }, { status: 404 });
    }

    return NextResponse.json(entry);
  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const decodedToken = await requirePermission(req, "update_petty_cash");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("attachment") as File | null;
    const dataField = formData.get("data");

    if (!dataField) {
      return NextResponse.json({ success: false, message: "Data is required" }, { status: 400 });
    }

    const data = JSON.parse(dataField as string);

    // Check if this is a review action (status change to APPROVED/REJECTED)
    if (data.status === "APPROVED" || data.status === "REJECTED") {
      const updatedEntry = await reviewPettyCash(
        id,
        data.status,
        decodedToken.name || decodedToken.email || decodedToken.uid || "system"
      );
      return NextResponse.json(updatedEntry);
    }

    // Regular update
    data.updatedBy = decodedToken.uid;

    const updatedEntry = await updatePettyCash(id, data, file || undefined);
    return NextResponse.json(updatedEntry);
  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    await requirePermission(req, "delete_petty_cash");

    const { id } = await params;
    await deletePettyCash(id);

    return NextResponse.json(
      { message: "Petty Cash entry deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    return handleAuthError(error);
  }
};

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import { updateAdjustmentStatus } from "@/services/InventoryAdjustmentService";
import { AdjustmentStatus } from "@/model/InventoryAdjustment";

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const user = await requirePermission(req, "approve_adjustments");

    const { id } = await params;
    const formData = await req.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return NextResponse.json({ success: false, message: "Missing data field" }, { status: 400 });
    }

    const body = JSON.parse(dataString);
    const { status, ...extraData } = body;

    if (!status) {
      return NextResponse.json({ success: false, message: "Status is required" }, { status: 400 });
    }

    // Validate status
    const validStatuses: AdjustmentStatus[] = [
      "DRAFT",
      "SUBMITTED",
      "APPROVED",
      "REJECTED",
      "COMPLETED",
    ];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ success: false, message: "Invalid status" }, { status: 400 });
    }

    await updateAdjustmentStatus(id, status as AdjustmentStatus, user.uid, extraData);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleAuthError(error);
  }
};

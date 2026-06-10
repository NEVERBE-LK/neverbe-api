import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import { getGRNById, updateGRNStatus } from "@/services/GRNService";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    await requirePermission(req, "view_grn");

    const { id } = await params;
    const grn = await getGRNById(id);

    if (!grn) {
      return NextResponse.json({ success: false, message: "GRN not found" }, { status: 404 });
    }

    return NextResponse.json(grn);
  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const body = await req.json();

    if (body.status) {
      if (body.status === "APPROVED") {
        await requirePermission(req, "approve_grn");
      } else if (body.status === "REJECTED") {
        const currentGrn = await getGRNById(id);
        if (currentGrn && currentGrn.status === "SUBMITTED") {
          await requirePermission(req, "approve_grn");
        } else {
          await requirePermission(req, "create_grn");
        }
      } else {
        await requirePermission(req, "create_grn");
      }

      const grn = await updateGRNStatus(id, body.status);
      return NextResponse.json(grn);
    }

    return NextResponse.json({ success: false, message: "Invalid update" }, { status: 400 });
  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const dynamic = "force-dynamic";

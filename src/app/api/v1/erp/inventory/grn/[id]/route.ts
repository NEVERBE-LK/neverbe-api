import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { getGRNById, updateGRNStatus } from "@/services/GRNService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_grn");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const grn = await getGRNById(id);

    if (!grn) return errorResponse("GRN not found", 404);

    return NextResponse.json(grn);
  } catch (error: any) {
    return errorResponse(error);
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
      const response = await authorizeRequest(req, "approve_grn");
      if (!response) return errorResponse("Unauthorized", 401);

      const grn = await updateGRNStatus(id, body.status);
      return NextResponse.json(grn);
    }

    return errorResponse("Invalid update", 400);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

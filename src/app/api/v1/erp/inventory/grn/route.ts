import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { getGRNs, createGRN } from "@/services/GRNService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "view_grn");
    if (!response) return errorResponse("Unauthorized", 401);

    const url = new URL(req.url);
    const purchaseOrderId = url.searchParams.get("purchaseOrderId");
    const status = url.searchParams.get("status");

    const data = await getGRNs(
      purchaseOrderId || undefined,
      (status as any) || undefined,
    );
    return NextResponse.json(data);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const POST = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "create_grn");
    if (!response) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);
    const grn = await createGRN(body);
    return NextResponse.json(grn, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

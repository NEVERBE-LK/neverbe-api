import { authorizeRequest } from "@/services/AuthService";
import { updateCoupon, deleteCoupon } from "@/services/PromotionService";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export const GET = async (req: NextRequest, { params }: Props) => {
  return errorResponse("Not implemented fetching by ID yet, use list", 501);
};

export const PUT = async (req: NextRequest, { params }: Props) => {
  try {
    const authorized = await authorizeRequest(req, "update_coupons");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(rawData);
    const updated = await updateCoupon(id, data);
    return NextResponse.json(updated);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (req: NextRequest, { params }: Props) => {
  try {
    const authorized = await authorizeRequest(req, "delete_coupons");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const result = await deleteCoupon(id);
    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

import { authorizeRequest } from "@/services/AuthService";
import {
  getPromotionById,
  updatePromotion,
  deletePromotion,
} from "@/services/PromotionService";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export const GET = async (req: NextRequest, { params }: Props) => {
  try {
    const authorized = await authorizeRequest(req, "view_promotions");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const promotion = await getPromotionById(id);
    if (!promotion) {
      return errorResponse("Promotion not found", 404);
    }
    return NextResponse.json(promotion);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (req: NextRequest, { params }: Props) => {
  try {
    const authorized = await authorizeRequest(req, "update_promotions");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("banner") as File | null;
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(rawData);

    const updated = await updatePromotion(id, data, file);
    return NextResponse.json(updated);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (req: NextRequest, { params }: Props) => {
  try {
    const authorized = await authorizeRequest(req, "delete_promotions");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const result = await deletePromotion(id);
    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

import { NextResponse } from "next/server";
import {
  getBrandById,
  updateBrand,
  deleteBrand,
} from "@/services/BrandService";
import { authorizeRequest } from "@/services/AuthService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ brandId: string }> }
) => {
  try {
    const { brandId } = await params;
    const user = await authorizeRequest(_req);
    if (!user) return errorResponse("Unauthorized", 401);

    const result = await getBrandById(brandId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ brandId: string }> }
) => {
  try {
    const { brandId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const logo = formData.get("logo") as File | null;
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const brandData = JSON.parse(rawData);

    const result = await updateBrand(brandId, brandData, logo || undefined);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ brandId: string }> }
) => {
  try {
    const { brandId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const result = await deleteBrand(brandId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
};

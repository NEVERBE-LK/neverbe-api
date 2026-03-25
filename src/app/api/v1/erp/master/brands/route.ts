import { NextResponse } from "next/server";
import { createBrand, getBrands } from "@/services/BrandService";
import { authorizeRequest } from "@/services/AuthService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || 1);
    const size = Number(searchParams.get("size") || 10);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") as "active" | "inactive" | null;

    const data = await getBrands({ page, size, search, status });
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
};

export const POST = async (req: Request) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const logo = formData.get("logo") as File | null;
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const brandData = JSON.parse(rawData);

    const result = await createBrand(brandData, logo || undefined);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
};

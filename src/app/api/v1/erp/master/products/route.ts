import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { getProducts, addProducts } from "@/services/ProductService";
import { errorResponse } from "@/utils/apiResponse";

/**
 * GET: Fetch a paginated list of products
 */
export const GET = async (req: NextRequest) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get("page") || "1");
    const size = parseInt(searchParams.get("size") || "10");
    const search = searchParams.get("search") || undefined;
    const brand = searchParams.get("brand") || undefined;
    const category = searchParams.get("category") || undefined;

    const parseBoolean = (val?: string) =>
      val === "true" ? true : val === "false" ? false : undefined;

    const status = parseBoolean(searchParams.get("status") || undefined);
    const listing = parseBoolean(searchParams.get("listing") || undefined);

    const result = await getProducts(
      page,
      size,
      search,
      brand,
      category,
      status,
      listing
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

/**
 * POST: Create a new product
 */
export const POST = async (req: NextRequest) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const file = formData.get("thumbnail") as File | null;
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const productData = JSON.parse(rawData);

    if (!file) {
      return errorResponse("Thumbnail file is required", 400);
    }

    const result = await addProducts(productData, file);

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

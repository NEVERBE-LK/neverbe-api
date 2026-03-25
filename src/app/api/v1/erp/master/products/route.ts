import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { getProducts, addProducts } from "@/services/ProductService"; // Import your service
import { Product } from "@/model/Product";
import { errorResponse, AppError } from "@/utils/apiResponse";

/**
 * Helper to parse FormData into a Product object
 */
const parseProductFromFormData = async (
  formData: FormData
): Promise<Partial<Product>> => {
  const product: Partial<Product> = {};

  // Handle all string/number fields
  for (const [key, value] of Array.from(formData.entries())) {
    if (key === "thumbnail") continue; // Skip file
    if (key === "variants" || key === "tags") {
      // Parse JSON fields
      product[key as "variants" | "tags"] = JSON.parse(value as string);
    } else if (key === "gender") {
      // Handle both JSON array and comma-separated string formats
      const strValue = value as string;
      try {
        const parsed = JSON.parse(strValue);
        product.gender = Array.isArray(parsed)
          ? parsed.map((g: string) => g.toLowerCase())
          : [];
      } catch {
        // Fallback: treat as comma-separated string
        product.gender = strValue
          ? strValue.split(",").map((g) => g.trim().toLowerCase())
          : [];
      }
    } else if (key === "status" || key === "listing") {
      // Parse string booleans
      product[key as "status" | "listing"] = value === "true";
    } else if (
      [
        "buyingPrice",
        "sellingPrice",
        "marketPrice",
        "discount",
        "weight",
      ].includes(key)
    ) {
      // Parse numbers
      product[key as "buyingPrice"] = parseFloat(value as string) || 0;
    } else {
      // Assign simple strings
      (product as any)[key] = value as string;
    }
  }
  return product;
};

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

    // Helper to parse booleans from string "true" or "false"
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

    if (!file) {
      return errorResponse("Thumbnail file is required", 400);
    }

    const productData = await parseProductFromFormData(formData);
    const result = await addProducts(productData, file);

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

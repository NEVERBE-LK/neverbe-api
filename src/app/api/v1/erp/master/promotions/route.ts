import { authorizeRequest } from "@/services/AuthService";
import { getPromotions, createPromotion } from "@/services/PromotionService";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: NextRequest) => {
  try {
    const authorized = await authorizeRequest(req, "view_promotions");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get("page") || "1");
    const size = parseInt(searchParams.get("size") || "20");
    const filterStatus = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const type = searchParams.get("type") || undefined;

    const result = await getPromotions(page, size, filterStatus, search, type);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("GET /api/v2/promotions Error:", error);
    return errorResponse(error);
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const authorized = await authorizeRequest(req, "create_promotions");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const file = formData.get("banner") as File | null;

    // Parse JSON-encoded fields or reconstruct object
    const data: any = {};
    for (const [key, value] of Array.from(formData.entries())) {
      if (key === "banner") continue;
      // Handle complex objects (conditions, actions) that might be sent as JSON strings
      if (
        [
          "conditions",
          "actions",
          "applicableProducts",
          "applicableProductVariants",
          "applicableCategories",
          "applicableBrands",
          "excludedProducts",
        ].includes(key)
      ) {
        try {
          data[key] = JSON.parse(value as string);
        } catch {
          data[key] = value;
        }
      } else {
        data[key] = value;
      }
    }

    // Basic validation
    if (!data.name || !data.type) {
      return errorResponse("Name and Type are required", 400);
    }

    const promotion = await createPromotion(data, file);
    return NextResponse.json(promotion, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/v2/promotions Error:", error);
    return errorResponse(error);
  }
};

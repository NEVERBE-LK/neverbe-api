import { authorizeRequest } from "@/services/AuthService";
import { getCoupons, createCoupon } from "@/services/PromotionService";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: NextRequest) => {
  try {
    const authorized = await authorizeRequest(req, "view_coupons");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get("page") || "1");
    const size = parseInt(searchParams.get("size") || "20");
    const search = searchParams.get("search") || undefined;
    const filterStatus = searchParams.get("status") || undefined;

    const result = await getCoupons(page, size, filterStatus, search);
    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const authorized = await authorizeRequest(req, "create_coupons");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const rawData = formData.get("data") as string;
    
    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(rawData);

    if (!data.code || !data.discountType) {
      return errorResponse("Code and Discount Type required", 400);
    }

    const coupon = await createCoupon(data);
    return NextResponse.json(coupon, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

import { NextResponse } from "next/server";
import { authorizeAndGetUser, authorizeRequest } from "@/services/AuthService";
import {
  getAdjustments,
  createAdjustment,
} from "@/services/InventoryAdjustmentService";
import { AdjustmentType } from "@/model/InventoryAdjustment";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "view_adjustments");
    if (!response) {
      return errorResponse("Unauthorized", 401);
    }

    const url = new URL(req.url);
    const search = url.searchParams.get("search") || undefined;
    const type = url.searchParams.get("type") as AdjustmentType | null;
    const status = url.searchParams.get("status") as any | null; // Cast to any to avoid strict type issues if not imported
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const size = parseInt(url.searchParams.get("size") || "20", 10);

    const data = await getAdjustments(
      page,
      size,
      search,
      type || undefined,
      status || undefined,
    );
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[Adjustments API] Error:", error);
    return errorResponse(error);
  }
};

export const POST = async (req: Request) => {
  try {
    const user = await authorizeAndGetUser(req);
    if (!user) {
      return errorResponse("Unauthorized", 401);
    }

    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);
    const adjustment = await createAdjustment(body, user.userId);
    return NextResponse.json(adjustment, { status: 201 });
  } catch (error: any) {
    console.error("[Adjustments API] Error:", error);
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

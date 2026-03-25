import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { createCategory, getCategories } from "@/services/CategoryService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: NextRequest) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const size = parseInt(url.searchParams.get("size") || "10");
    const search = url.searchParams.get("search") || "";
    const status = url.searchParams.get("status") as
      | "active"
      | "inactive"
      | null;

    const result = await getCategories({ page, size, search, status });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const category = await req.json();
    if (!category.name) return errorResponse("Name is required", 400);

    const res = await createCategory(category);
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
};

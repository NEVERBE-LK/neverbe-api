import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getCategoryById,
  updateCategory,
  softDeleteCategory,
} from "@/services/CategoryService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) => {
  try {
    const { categoryId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const category = await getCategoryById(categoryId);
    // getCategoryById now throws AppError(404) if not found, so no need to check result if implementation is correct.
    // But good to keep safety if I missed something or for future proofing, although inconsistent if service throws.
    // Since I refactored service to throw, verify logic:
    // If not found -> Service throws.
    // So this next block is dead code if service works as expected, but safe.
    if (!category) return errorResponse("Category not found", 404);

    return NextResponse.json(category);
  } catch (e) {
    return errorResponse(e);
  }
};

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) => {
  try {
    const { categoryId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(rawData);
    if (!data.name || !data.status) {
      return errorResponse("Name and Status are required", 400);
    }
    const res = await updateCategory(categoryId, data);
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
};

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) => {
  try {
    const { categoryId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const res = await softDeleteCategory(categoryId);
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
};

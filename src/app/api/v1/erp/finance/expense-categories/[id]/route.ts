import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getExpenseCategoryById,
  updateExpenseCategory,
  deleteExpenseCategory,
} from "@/services/ExpenseCategoryService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_expense_categories");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const category = await getExpenseCategoryById(id);

    if (!category) return errorResponse("Category not found", 404);

    return NextResponse.json(category);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_expense_categories");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);
    const category = await updateExpenseCategory(id, body);
    return NextResponse.json(category);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_expense_categories");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    await deleteExpenseCategory(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

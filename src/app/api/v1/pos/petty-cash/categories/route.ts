import { NextRequest, NextResponse } from "next/server";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";
import { getExpenseCategoriesDropdown } from "@/services/ExpenseCategoryService";

/**
 * GET - Fetch expense categories for POS
 */
export async function GET(request: NextRequest) {
  try {
    await verifyPosAuth("access_pos");

    const categories = await getExpenseCategoriesDropdown("expense");

    return NextResponse.json(categories);
  } catch (error: any) {
    return handleAuthError(error);
  }
}

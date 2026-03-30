import { NextRequest, NextResponse } from "next/server";
import { verifyPosAuth, handleAuthError, authorizeAndGetUser } from "@/services/AuthService";
import { addPettyCash, getPettyCashList } from "@/services/PettyCashService";
import { errorResponse } from "@/utils/apiResponse";

/**
 * GET - Fetch current month's petty cash entries for a specific stock
 */
export async function GET(request: NextRequest) {
  try {
    await verifyPosAuth("access_pos");

    const { searchParams } = new URL(request.url);
    const stockId = searchParams.get("stockId");

    if (!stockId) {
      return errorResponse("stockId is required", 400);
    }

    // Calculate start of current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const fromDate = startOfMonth.toISOString();

    const result = await getPettyCashList(1, 100, {
      stockId,
      fromDate,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return handleAuthError(error);
  }
}

/**
 * POST - Create a new petty cash entry from POS (always PENDING)
 */
export async function POST(request: NextRequest) {
  try {
    await verifyPosAuth("access_pos");
    const user = await authorizeAndGetUser(request);
    
    const formData = await request.formData();
    const file = formData.get("attachment") as File | null;
    const dataField = formData.get("data");

    if (!dataField) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(dataField as string);

    // Enforce POS business rules
    data.status = "PENDING";
    if (user?.userId) {
      data.createdBy = user.userId;
      data.updatedBy = user.userId;
    }

    const newEntry = await addPettyCash(data, file || undefined);
    return NextResponse.json(newEntry, { status: 201 });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

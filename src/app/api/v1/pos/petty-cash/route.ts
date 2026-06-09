import { NextRequest, NextResponse } from "next/server";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";
import { addPettyCash, getPettyCashList } from "@/services/PettyCashService";

/**
 * GET - Fetch current month's petty cash entries for a specific stock
 */
export async function GET(request: NextRequest) {
  try {
    await verifyPosAuth("view_pos_pretty_cash");

    const { searchParams } = new URL(request.url);
    const stockId = searchParams.get("stockId");

    if (!stockId) {
      return NextResponse.json({ success: false, message: "stockId is required" }, { status: 400 });
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
    const user = await verifyPosAuth("create_pos_pretty_cash");
    
    const formData = await request.formData();
    const file = formData.get("attachment") as File | null;
    const dataField = formData.get("data");

    if (!dataField) {
      return NextResponse.json({ success: false, message: "Data is required" }, { status: 400 });
    }

    const data = JSON.parse(dataField as string);

    // Enforce POS business rules
    data.status = "PENDING";
    if (user?.uid) {
      data.createdBy = user.uid;
      data.updatedBy = user.uid;
    }

    const newEntry = await addPettyCash(data, file || undefined);
    return NextResponse.json(newEntry, { status: 201 });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

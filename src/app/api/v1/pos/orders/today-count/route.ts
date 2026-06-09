import { NextRequest, NextResponse } from "next/server";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";
import { getTodayPOSOrdersCount } from "@/services/POSService";

export async function GET(request: NextRequest) {
  try {
    await verifyPosAuth("access_pos");
    const stockId = request.nextUrl.searchParams.get("stockId");
    if (!stockId) {
      return NextResponse.json({ message: "stockId is required" }, { status: 400 });
    }

    const count = await getTodayPOSOrdersCount(stockId);
    return NextResponse.json({ count });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

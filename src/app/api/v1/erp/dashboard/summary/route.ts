import { NextRequest, NextResponse } from "next/server";
import { getDashboardSummary } from "@/services/DashboardService";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const refresh = searchParams.get("refresh") === "true";
    const data = await getDashboardSummary(refresh);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[Dashboard Summary API] Error:", error);
    return NextResponse.json(
      { message: error.message || "Failed to load dashboard summary" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";
import { getProcessingWebsiteOrdersCount } from "@/services/POSService";

export async function GET(request: NextRequest) {
  try {
    await verifyPosAuth();
    const count = await getProcessingWebsiteOrdersCount();
    return NextResponse.json({ count });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

export const dynamic = "force-dynamic";

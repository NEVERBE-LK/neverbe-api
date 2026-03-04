// app/api/v1/koko/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { IPGService } from "@/services/IPGService";
import { verifyToken } from "@/services/WebAuthService";

export const POST = async (req: NextRequest) => {
  try {
    console.log("[Koko Initiate API] Incoming request");

    // --- Step 1: Verify user token ---
    const idToken = await verifyToken(req);
    console.log("[Koko Initiate API] Token verified:", idToken.uid);

    // --- Step 2: Parse request body ---
    const body = await req.json();
    console.log("[Koko Initiate API] Request body:", body);

    // --- Step 3: Generate payload via IPGService ---
    const payload = IPGService.generateKokoPayload(body);

    console.log("✅ Koko initiate payload prepared:", payload);
    return NextResponse.json(payload, { status: 200 });
  } catch (error: any) {
    console.error("❌ Koko initiate error:", error.message, error.stack);
    return NextResponse.json(
      { message: "Error initiating Koko payment", error: error.message },
      { status: 500 },
    );
  }
};

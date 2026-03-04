import { verifyToken } from "@/services/WebAuthService";
import { NextResponse } from "next/server";
import { IPGService } from "@/services/IPGService";

export const POST = async (req: Request) => {
  try {
    console.log("[PayHere Initiate API] Incoming request");

    // --- Step 1: Verify user token ---
    const idToken = await verifyToken(req);
    console.log("[PayHere Initiate API] Token verified:", idToken.uid);

    // --- Step 2: Parse request body ---
    const body = await req.json();
    console.log("[PayHere Initiate API] Request body:", body);

    // --- Step 3: Generate payload via IPGService ---
    const payload = IPGService.generatePayHerePayload(body);

    console.log("✅ PayHere initiate payload prepared:", payload);
    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error("[PayHere Initiate API] Error:", err.message, err.stack);
    return NextResponse.json(
      { message: "Error generating PayHere payload", error: err.message },
      { status: 500 },
    );
  }
};

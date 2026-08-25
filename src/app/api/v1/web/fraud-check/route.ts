import { NextRequest, NextResponse } from "next/server";
import { evaluateUnifiedFraudRisk } from "@/services/FraudEngineService";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    
    // Evaluate the risk using our FraudEngine service ported from the frontend
    const result = await evaluateUnifiedFraudRisk(payload);
    
    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error("[Fraud Check API Error]", error);
    return NextResponse.json(
      { success: false, message: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}

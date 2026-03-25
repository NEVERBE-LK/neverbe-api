import { NextRequest, NextResponse } from "next/server";
import { createPOSOrder } from "@/services/POSService";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";

export async function POST(request: NextRequest) {
  try {
    const decodedToken = await verifyPosAuth("create_pos_orders");
    
    // Standardized FormData + JSON data parsing
    const formData = await request.formData();
    const dataString = formData.get("data") as string;
    
    if (!dataString) {
      return NextResponse.json({ message: "No data provided" }, { status: 400 });
    }

    const body = JSON.parse(dataString);
    const order = await createPOSOrder(body, decodedToken.uid);
    return NextResponse.json({ order });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

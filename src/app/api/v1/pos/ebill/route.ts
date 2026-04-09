import { NextRequest, NextResponse } from "next/server";
import { sendeBillSMS } from "@/services/NotificationService";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";

export const POST = async (req: NextRequest) => {
  try {
    // Basic Auth Check to ensure it's a valid POS user/admin triggering this
    await verifyPosAuth();

    const body = await req.json();
    const { orderId, phone } = body;

    if (!orderId || !phone) {
      return NextResponse.json(
        { message: "Order ID and Phone number are required." },
        { status: 400 },
      );
    }

    const success = await sendeBillSMS(orderId, phone);

    if (success) {
      return NextResponse.json(
        { message: "eBill SMS sent successfully." },
        { status: 200 },
      );
    } else {
      return NextResponse.json(
        { message: "Failed to send eBill SMS or rate limited." },
        { status: 400 },
      );
    }
  } catch (error: any) {
    console.error("[POS eBill API] Error:", error.message);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 },
    );
  }
};

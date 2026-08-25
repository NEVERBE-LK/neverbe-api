import { NextRequest, NextResponse } from "next/server";
import { getOrderPrepaidStatus } from "@/services/WebOrderService";

export const GET = async (
  req: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) => {
  try {
    const orderId = (await context.params).orderId;
    if (!orderId) {
      return NextResponse.json(
        { message: "Order ID is required" },
        { status: 400 },
      );
    }

    const status = await getOrderPrepaidStatus(orderId);
    
    return NextResponse.json({ data: status }, { status: 200 });
  } catch (error: any) {
    console.error("[GET Order Prepaid Status] Error:", error.message);
    if (error.message.includes("not found")) {
      return NextResponse.json({ message: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 },
    );
  }
};

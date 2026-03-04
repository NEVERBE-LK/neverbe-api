import { NextRequest, NextResponse } from "next/server";
import { getOrderByIdForInvoice } from "@/services/WebOrderService";

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

    const order = await getOrderByIdForInvoice(orderId);

    // We shouldn't return sensitive things like payment history if not needed,
    // but the frontend success page expects the order details.
    return NextResponse.json({ data: order }, { status: 200 });
  } catch (error: any) {
    console.error("[GET Order] Error:", error.message);
    if (error.message.includes("not found")) {
      return NextResponse.json({ message: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 },
    );
  }
};

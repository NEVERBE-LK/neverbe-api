import { NextRequest, NextResponse } from "next/server";
import { getOrderByIdForInvoice } from "@/services/WebOrderService";

/** eBill expiration period for POS (Store) orders: 1 month */
const EBILL_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

    // eBill Expiration: POS (Store) orders expire after 1 month
    if (order.from === "Store") {
      let orderDate: Date | null = null;

      if (order.createdAt?._seconds) {
        orderDate = new Date(order.createdAt._seconds * 1000);
      } else if (order.createdAt?.toDate) {
        orderDate = order.createdAt.toDate();
      } else if (order.createdAt) {
        orderDate = new Date(order.createdAt);
      }

      if (orderDate) {
        const now = new Date();
        const elapsed = now.getTime() - orderDate.getTime();
        if (elapsed > EBILL_EXPIRY_MS) {
          return NextResponse.json(
            { message: "This eBill has expired. POS receipts are available for 30 days from the date of purchase.", expired: true },
            { status: 410 },
          );
        }
      }
    }

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

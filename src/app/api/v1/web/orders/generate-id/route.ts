import { NextRequest, NextResponse } from "next/server";
import { orderRepository } from "@/repositories/OrderRepository";

/**
 * GET: Generate a unique server-side Order ID
 */
export const GET = async (req: NextRequest) => {
  try {
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    let uniqueId = "";
    let attempts = 0;

    while (attempts < 5) {
      const randPart = Math.floor(100000 + Math.random() * 900000);
      uniqueId = `${datePart}${randPart}`;

      const existing = await orderRepository.findByOrderId(uniqueId);
      if (!existing) {
        break;
      }
      attempts++;
    }

    return NextResponse.json({
      success: true,
      orderId: uniqueId,
    });
  } catch (error: any) {
    console.error("[Generate Order ID Error]", error);
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const randPart = Math.floor(100000 + Math.random() * 900000);
    return NextResponse.json({
      success: true,
      orderId: `${datePart}${randPart}`,
    });
  }
};

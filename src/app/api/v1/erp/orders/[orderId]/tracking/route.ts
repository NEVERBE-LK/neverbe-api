import { NextRequest, NextResponse } from "next/server";
import { getDomexTracking } from "@/services/TrackingService";
import { getOrder } from "@/services/OrderService";
import { requirePermission, handleAuthError } from "@/services/AuthService";

export const GET = async (
  req: NextRequest,
  context: { params: Promise<{ orderId: string }> },
) => {
  try {
    await requirePermission(req, "view_orders");

    const orderId = (await context.params).orderId;
    if (!orderId) {
      return NextResponse.json({ success: false, message: "Order ID is required" }, { status: 400 });
    }

    // 1. Fetch order to get tracking number
    const order = await getOrder(orderId);
    if (!order.trackingNumber) {
      return NextResponse.json({ 
        message: "No tracking number available for this order",
        data: [] 
      }, { status: 200 });
    }

    // 2. Scrape live tracking data
    // Future expansion: Support multiple couriers based on order.courier
    const trackingHistory = await getDomexTracking(order.trackingNumber);

    return NextResponse.json({ 
      data: {
        trackingNumber: order.trackingNumber,
        courier: order.courier || "Domex",
        history: trackingHistory
      }
    }, { status: 200 });

  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) => {
  try {
    await requirePermission(req, "update_orders");
    const { orderId } = await params;
    const body = await req.json();

    const { updateOrderTracking } = await import("@/services/OrderService");
    await updateOrderTracking(orderId, body);

    return NextResponse.json({ success: true, message: "Order tracking info updated successfully" });
  } catch (error: any) {
    return handleAuthError(error);
  }
};


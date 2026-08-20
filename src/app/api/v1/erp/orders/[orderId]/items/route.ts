import { requirePermission, handleAuthError } from "@/services/AuthService";
import { updateOrderItems } from "@/services/OrderService";
import { NextResponse } from "next/server";

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) => {
  try {
    await requirePermission(req, "update_orders");
    const { orderId } = await params;
    const body = await req.json();

    if (!Array.isArray(body.items)) {
      return NextResponse.json({ success: false, message: "Items array is required" }, { status: 400 });
    }

    await updateOrderItems(orderId, body);
    return NextResponse.json({ success: true, message: "Order items updated successfully" });
  } catch (error: any) {
    return handleAuthError(error);
  }
};

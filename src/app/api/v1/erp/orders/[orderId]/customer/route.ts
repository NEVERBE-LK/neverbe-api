import { requirePermission, handleAuthError } from "@/services/AuthService";
import { updateOrderCustomer } from "@/services/OrderService";
import { NextResponse } from "next/server";

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) => {
  try {
    await requirePermission(req, "update_orders");
    const { orderId } = await params;
    const body = await req.json();

    if (!body.customer) {
      return NextResponse.json({ success: false, message: "Customer data is required" }, { status: 400 });
    }

    await updateOrderCustomer(orderId, body);
    return NextResponse.json({ success: true, message: "Order customer info updated successfully" });
  } catch (error: any) {
    return handleAuthError(error);
  }
};

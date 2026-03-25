import { authorizeRequest } from "@/services/AuthService";
import { getOrder, updateOrder } from "@/services/OrderService";
import { NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "update_orders");
    if (!response) return errorResponse("Unauthorized", 401);

    const { orderId } = await params;
    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);

    if (!body.paymentStatus || !body.status) {
      return errorResponse("Missing required fields", 400);
    }
    const id = orderId;
    await updateOrder(body, id);

    return NextResponse.json({ message: "Order updated successfully" });
  } catch (error: any) {
    return errorResponse(error);
  }
};
export const GET = async (
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) => {
  try {
    const authorized = await authorizeRequest(req, "view_orders");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const { orderId } = await params;
    const order = await getOrder(orderId);

    return NextResponse.json(order, { status: 200 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

import { NextRequest, NextResponse } from "next/server";
import { authorizeOrderRequest } from "@/services/AuthService";
import { addWebOrder } from "@/services/WebOrderService";
import { Order } from "@/model/Order";
import { errorResponse } from "@/utils/apiResponse";

export const POST = async (req: NextRequest) => {
  try {
    const authorization = await authorizeOrderRequest(req);
    if (!authorization) return errorResponse("Unauthorized", 401);

    const orderData: Partial<Order> = await req.json();
    await addWebOrder(orderData);

    return NextResponse.json("Order Created Successfully");
  } catch (error: any) {
    return errorResponse(error);
  }
};

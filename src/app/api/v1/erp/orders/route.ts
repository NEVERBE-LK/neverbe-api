import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { addOrder, getOrders } from "@/services/OrderService";
import { getAuthUid } from "@/services/AuthService";
import { Order } from "@/model/Order";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: NextRequest) => {
  try {
    // Verify the ID token and permission
    const response = await authorizeRequest(req, "view_orders");
    if (!response) return errorResponse("Unauthorized", 401);

    // Get the URL and parse the query parameters
    const url = new URL(req.url);
    const pageNumber = parseInt(url.searchParams.get("page") as string) || 1;
    const size = parseInt(url.searchParams.get("size") as string) || 20;
    const fromData = url.searchParams.get("from");
    const toData = url.searchParams.get("to");
    const status = url.searchParams.get("status");
    const payment = url.searchParams.get("payment");
    const orderId = url.searchParams.get("search");
    const source = url.searchParams.get("source");
    const stockId = url.searchParams.get("stockId");
    const paymentMethod = url.searchParams.get("paymentMethod");

    console.log(`Page number: ${pageNumber}, Size: ${size}`);
    const { dataList, total } = await getOrders(
      pageNumber,
      size,
      fromData || undefined,
      toData || undefined,
      status || undefined,
      payment || undefined,
      orderId || undefined,
      source || undefined,
      stockId || undefined,
      paymentMethod || undefined,
    );
    console.log(`Orders: ${dataList.length}`);
    // Return a response with the orders
    return NextResponse.json({ dataList, total });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const uid = await getAuthUid(req);
    if (!uid) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return errorResponse("Missing data field", 400);
    }

    const orderData: Partial<Order> = JSON.parse(dataString);
    await addOrder(orderData);
    return NextResponse.json("Order Created Successfully");
  } catch (error: any) {
    return errorResponse(error);
  }
};

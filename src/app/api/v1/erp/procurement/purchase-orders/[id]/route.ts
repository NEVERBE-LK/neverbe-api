import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getPurchaseOrderById,
  updatePurchaseOrder,
  deletePurchaseOrder,
  updatePOStatus,
} from "@/services/PurchaseOrderService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_purchase_orders");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const po = await getPurchaseOrderById(id);

    if (!po) {
      return errorResponse("Purchase order not found", 404);
    }

    return NextResponse.json(po);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "create_purchase_orders");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);
    const po = await updatePurchaseOrder(id, body);
    return NextResponse.json(po);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PATCH = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const body = await req.json();
    
    // Status update logic
    if (body.status) {
      const response = await authorizeRequest(req, "approve_po");
      if (!response) return errorResponse("Unauthorized", 401);
      
      const po = await updatePOStatus(id, body.status);
      return NextResponse.json(po);
    }

    return errorResponse("Invalid update", 400);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_purchase_orders");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    await deletePurchaseOrder(id);

    return NextResponse.json({ message: "Purchase order deleted" });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import {
  getPurchaseOrderById,
  updatePurchaseOrder,
  deletePurchaseOrder,
  updatePOStatus,
} from "@/services/PurchaseOrderService";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    await requirePermission(req, "view_purchase_orders");

    const { id } = await params;
    const po = await getPurchaseOrderById(id);

    if (!po) {
      return NextResponse.json({ success: false, message: "Purchase order not found" }, { status: 404 });
    }

    return NextResponse.json(po);
  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    await requirePermission(req, "create_purchase_orders");

    const { id } = await params;
    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return NextResponse.json({ success: false, message: "Data is required" }, { status: 400 });
    }

    const body = JSON.parse(data as string);
    const po = await updatePurchaseOrder(id, body);
    return NextResponse.json(po);
  } catch (error: any) {
    return handleAuthError(error);
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
      if (body.status === "APPROVED") {
        await requirePermission(req, "approve_po");
      } else if (body.status === "REJECTED") {
        const currentPo = await getPurchaseOrderById(id);
        if (currentPo && currentPo.status === "SUBMITTED") {
          await requirePermission(req, "approve_po");
        } else {
          await requirePermission(req, "update_purchase_orders");
        }
      } else {
        await requirePermission(req, "update_purchase_orders");
      }
      
      const po = await updatePurchaseOrder(id, body);
      return NextResponse.json(po);
    }

    return NextResponse.json({ success: false, message: "Invalid update" }, { status: 400 });
  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    await requirePermission(req, "view_purchase_orders");

    const { id } = await params;
    await deletePurchaseOrder(id);

    return NextResponse.json({ message: "Purchase order deleted" });
  } catch (error: any) {
    return handleAuthError(error);
  }
};

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getSupplierInvoiceById,
  updateSupplierInvoice,
  deleteSupplierInvoice,
} from "@/services/SupplierInvoiceService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_supplier_invoices");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const invoice = await getSupplierInvoiceById(id);

    if (!invoice) return errorResponse("Invoice not found", 404);

    return NextResponse.json(invoice);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_supplier_invoices");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("attachment") as File | null;
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(dataString);

    const invoice = await updateSupplierInvoice(id, data, file || undefined);
    return NextResponse.json(invoice);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_supplier_invoices");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    await deleteSupplierInvoice(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { authorizeRequest, authorizeAndGetUser } from "@/services/AuthService";
import {
  getSupplierInvoices,
  createSupplierInvoice,
  getInvoiceAgingSummary,
} from "@/services/SupplierInvoiceService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const authorized = await authorizeRequest(req, "view_supplier_invoices");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const url = new URL(req.url);
    const summary = url.searchParams.get("summary") === "true";
    if (summary) {
      const data = await getInvoiceAgingSummary();
      return NextResponse.json(data);
    }

    const filters = {
      supplierId: url.searchParams.get("supplierId") || undefined,
      status: url.searchParams.get("status") || undefined,
    };

    const data = await getSupplierInvoices(filters);
    return NextResponse.json(data);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const POST = async (req: Request) => {
  try {
    const authorized = await authorizeRequest(req, "create_supplier_invoices");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const response = await authorizeAndGetUser(req);
    if (!response) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const file = formData.get("attachment") as File | null;
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(dataString);

    if (response.userId) data.createdBy = response.userId;

    const invoice = await createSupplierInvoice(data, file || undefined);
    return NextResponse.json(invoice, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

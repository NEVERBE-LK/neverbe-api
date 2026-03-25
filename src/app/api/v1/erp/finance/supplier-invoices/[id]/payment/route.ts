import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { recordInvoicePayment } from "@/services/SupplierInvoiceService";
import { errorResponse } from "@/utils/apiResponse";

export const POST = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_supplier_invoices");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return errorResponse("Data is required", 400);
    }

    const { amount, bankAccountId, notes } = JSON.parse(dataString);

    if (!amount || amount <= 0) {
      return errorResponse("Invalid amount", 400);
    }

    const updatedInvoice = await recordInvoicePayment(
      id,
      amount,
      bankAccountId,
      notes
    );

    return NextResponse.json(updatedInvoice);
  } catch (error: any) {
    return errorResponse(error);
  }
};

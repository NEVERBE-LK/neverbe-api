import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getSupplierById,
  updateSupplier,
  deleteSupplier,
} from "@/services/SupplierService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_suppliers");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const supplier = await getSupplierById(id);

    if (!supplier) {
      return errorResponse("Supplier not found", 404);
    }

    return NextResponse.json(supplier);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "update_suppliers");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);
    const supplier = await updateSupplier(id, body);

    return NextResponse.json(supplier);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "delete_suppliers");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    await deleteSupplier(id);

    return NextResponse.json({ message: "Supplier deleted" });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

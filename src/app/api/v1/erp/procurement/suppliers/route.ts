import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getSuppliers,
  createSupplier,
  getSuppliersDropdown,
} from "@/services/SupplierService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "view_suppliers");
    if (!response) return errorResponse("Unauthorized", 401);

    const url = new URL(req.url);
    const dropdown = url.searchParams.get("dropdown");
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search");

    if (dropdown === "true") {
      const data = await getSuppliersDropdown();
      return NextResponse.json(data);
    }

    const data = await getSuppliers(
      (status as "active" | "inactive") || undefined,
      search || undefined,
    );
    return NextResponse.json(data);
  } catch (error: unknown) {
    return errorResponse(error);
  }
};

export const POST = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "create_suppliers");
    if (!response) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);
    const supplier = await createSupplier(body);
    return NextResponse.json(supplier, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

import { authorizeRequest } from "@/services/AuthService";
import { updateStock, deleteStock } from "@/services/StockService"; // Use StockService
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

// PUT Handler: Update a specific stock location
export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ stockId: string }> }
) => {
  try {
    const { stockId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    if (!stockId) return errorResponse("Stock ID is required", 400);

    const formData = await req.formData();
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(rawData);
    const updateData: any = {};

    // Validate and build update object
    if (data.name !== undefined) {
      if (typeof data.name !== "string" || data.name.trim() === "") {
        return errorResponse("Name cannot be empty", 400);
      }
      updateData.name = data.name.trim();
    }
    if (data.address !== undefined) {
      // Allow clearing address
      updateData.address =
        typeof data.address === "string" ? data.address.trim() : "";
    }
    if (data.status !== undefined) {
      if (typeof data.status !== "boolean") {
        return errorResponse("Status must be true or false", 400);
      }
      updateData.status = data.status;
    }

    if (Object.keys(updateData).length === 0) {
      return errorResponse("No valid fields provided for update", 400);
    }

    await updateStock(stockId, updateData);

    // updateStock throws error on failure, this might not be reached unless error is caught differently
    return NextResponse.json(
      { message: "Stock location updated successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return errorResponse(error.message, 404);
    }
    return errorResponse(error);
  }
};

// DELETE Handler: Soft-delete a specific stock location
export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ stockId: string }> }
) => {
  try {
    const { stockId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    if (!stockId) return errorResponse("Stock ID is required", 400);

    await deleteStock(stockId);

    // deleteStock throws error on failure
    return NextResponse.json(
      { message: "Stock location deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      // Handle potential not found error from service
      return errorResponse(error.message, 404);
    }
    return errorResponse(error);
  }
};

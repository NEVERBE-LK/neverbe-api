import { authorizeRequest } from "@/services/AuthService";
import { updateVariant, deleteVariant } from "@/services/VariantService";
import { ProductVariant } from "@/model/ProductVariant";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

export const PUT = async (
  req: NextRequest,
  { params }: { params: Promise<{ productId: string; variantId: string }> }
) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) {
      return errorResponse("Unauthorized", 401);
    }

    const { productId, variantId } = await params;
    if (!productId || !variantId) {
      return errorResponse("Product ID and Variant ID are required", 400);
    }

    const formData = await req.formData();
    
    // Standardized pattern: JSON string in 'data' and files in 'attachment'
    const dataString = formData.get("data") as string;
    const newImageFiles: File[] = formData.getAll("attachment") as File[];

    if (!dataString) {
      return errorResponse("Data is required", 400);
    }

    const variantData = JSON.parse(dataString) as Partial<ProductVariant>;

    if (!variantData.variantName) {
      return errorResponse("Variant name is required", 400);
    }

    // Call the service to update the variant
    const updatedVariant = await updateVariant(
      productId,
      variantId,
      variantData,
      newImageFiles
    );

    return NextResponse.json(updatedVariant, { status: 200 }); // Return updated variant
  } catch (error: any) {
    console.error("PUT Variant Error:", error);
    return errorResponse(error);
  }
};

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ productId: string; variantId: string }> }
) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) {
      return errorResponse("Unauthorized", 401);
    }

    const { productId, variantId } = await params;
    if (!productId || !variantId) {
      return errorResponse("Product ID and Variant ID are required", 400);
    }

    // Call the service to delete the variant
    const success = await deleteVariant(productId, variantId);

    if (!success) {
      return errorResponse("Variant not found or already deleted", 404);
    }

    return NextResponse.json(
      { message: "Variant deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("DELETE Variant Error:", error);
    return errorResponse(error);
  }
};

import { authorizeRequest } from "@/services/AuthService";
import { ProductVariant } from "@/model/ProductVariant";
import { addVariant } from "@/services/VariantService";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) {
      return errorResponse("Unauthorized", 401);
    }

    const { productId } = await params;
    if (!productId) {
      return errorResponse("Product ID is required", 400);
    }

    const formData = await req.formData();
    
    // Standardized pattern: JSON string in 'data' and files in 'attachment'
    const dataString = formData.get("data") as string;
    const newImageFiles: File[] = formData.getAll("attachment") as File[];

    if (!dataString) {
      return errorResponse("Data is required", 400);
    }

    const variantData = JSON.parse(dataString) as Partial<ProductVariant>;

    // Basic validation
    if (!variantData.variantName) {
      return errorResponse("Variant name is required", 400);
    }

    // Call the service to add the variant
    const savedVariant = await addVariant(
      productId,
      variantData,
      newImageFiles
    );

    return NextResponse.json(savedVariant, { status: 201 }); // Return the saved variant
  } catch (error: any) {
    console.error("POST Variant Error:", error);
    return errorResponse(error);
  }
};

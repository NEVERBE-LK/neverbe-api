// app/api/v2/master/products/[productId]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/firebase/firebaseAdmin";
import { authorizeRequest } from "@/services/AuthService";
import { getProductById, updateProduct } from "@/services/ProductService";
import { errorResponse } from "@/utils/apiResponse";

interface RouteParams {
  params: Promise<{
    productId: string;
  }>;
}

export const GET = async (req: NextRequest, { params }: RouteParams) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const { productId } = await params;
    const product = await getProductById(productId);

    if (!product) {
      return errorResponse("Product not found", 404);
    }

    return NextResponse.json(product);
  } catch (error: any) {
    return errorResponse(error);
  }
};

/**
 * PUT: Update an existing product
 */
export const PUT = async (req: NextRequest, { params }: RouteParams) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const { productId } = await params;
    const formData = await req.formData();
    
    const file = formData.get("thumbnail") as File | null;
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const productData = JSON.parse(rawData);

    const result = await updateProduct(productId, productData, file);
    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

/**
 * DELETE: Soft-delete a product
 */
export const DELETE = async (req: NextRequest, { params }: RouteParams) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const { productId } = await params;

    await adminFirestore
      .collection("products")
      .doc(productId)
      .update({
        isDeleted: true,
        updatedAt: new Date(),
      });

    return NextResponse.json({ message: "Product deleted successfully" });
  } catch (error: any) {
    return errorResponse(error);
  }
};

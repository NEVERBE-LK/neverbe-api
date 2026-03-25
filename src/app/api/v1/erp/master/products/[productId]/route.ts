// app/api/v2/master/products/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/firebase/firebaseAdmin";
import { authorizeRequest } from "@/services/AuthService";
import { getProductById, updateProduct } from "@/services/ProductService"; // Import your service
import { Product } from "@/model/Product";
import { errorResponse, AppError } from "@/utils/apiResponse";

interface RouteParams {
  params: Promise<{
    productId: string; // This 'id' comes from the folder name [id]
  }>;
}

/**
 * Helper to parse FormData into a Product object
 */
const parseProductFromFormData = async (
  formData: FormData
): Promise<Partial<Product>> => {
  const product: Partial<Product> = {};
  for (const [key, value] of Array.from(formData.entries())) {
    if (key === "thumbnail") continue;
    if (key === "variants" || key === "tags") {
      product[key as "variants" | "tags"] = JSON.parse(value as string);
    } else if (key === "gender") {
      // Handle both JSON array and comma-separated string formats
      const strValue = value as string;
      try {
        const parsed = JSON.parse(strValue);
        product.gender = Array.isArray(parsed)
          ? parsed.map((g: string) => g.toLowerCase())
          : [];
      } catch {
        // Fallback: treat as comma-separated string
        product.gender = strValue
          ? strValue.split(",").map((g) => g.trim().toLowerCase())
          : [];
      }
    } else if (key === "status" || key === "listing") {
      product[key as "status" | "listing"] = value === "true";
    } else if (
      [
        "buyingPrice",
        "sellingPrice",
        "marketPrice",
        "discount",
        "weight",
      ].includes(key)
    ) {
      product[key as "buyingPrice"] = parseFloat(value as string) || 0;
    } else {
      (product as any)[key] = value as string;
    }
  }
  return product;
};
export const GET = async (req: NextRequest, { params }: RouteParams) => {
  try {
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const { productId } = await params;
    const product = await getProductById(productId);

    if (!product) {
      // getProductById might throw 404 (if I succeed to fix service), or return null (if not).
      // Handling both cases.
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

    // --- MODIFIED LOGIC ---
    const thumbnailValue = formData.get("thumbnail");
    let file: File | null = null;
    let existingThumbnail: Product["thumbnail"] | null = null;

    if (thumbnailValue instanceof File) {
      // It's a new file upload
      file = thumbnailValue;
    } else if (typeof thumbnailValue === "string") {
      // It's the old thumbnail data (JSON string)
      existingThumbnail = JSON.parse(thumbnailValue);
    }
    // --- END MODIFICATION ---

    const productData = await parseProductFromFormData(formData);

    // If we received the old thumbnail data, add it to productData
    if (existingThumbnail) {
      productData.thumbnail = existingThumbnail;
    }

    // Pass the product data and the (potentially null) new file
    // Pass the product data and the (potentially null) new file
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

    // --- CRITICAL FIX: Use productId, not id ---
    const { productId } = await params;

    // Perform a soft delete by updating the 'isDeleted' flag
    await adminFirestore
      .collection("products")
      .doc(productId) // <-- FIXED
      .update({
        isDeleted: true,
        updatedAt: new Date(),
      });

    return NextResponse.json({ message: "Product deleted successfully" });
  } catch (error: any) {
    return errorResponse(error);
  }
};

import { NextRequest, NextResponse } from "next/server";
import {
  getPosCart,
  addItemToPosCart,
  removeFromPosCart,
  clearPosCart,
} from "@/services/POSService";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";
import { errorResponse } from "@/utils/apiResponse";

// GET - Fetch all cart items
export async function GET(request: NextRequest) {
  try {
    const decodedToken = await verifyPosAuth("manage_pos_cart");
    const stockId = request.nextUrl.searchParams.get("stockId");

    if (!stockId) {
      return errorResponse("Stock ID is required", 400);
    }

    const userId = decodedToken.uid;
    const items = await getPosCart(stockId, userId);
    return NextResponse.json(items);
  } catch (error: any) {
    return handleAuthError(error);
  }
}

// POST - Add item to cart
export async function POST(request: NextRequest) {
  try {
    const decodedToken = await verifyPosAuth("manage_pos_cart");
    
    // Standardized FormData + JSON data parsing
    const formData = await request.formData();
    const dataString = formData.get("data") as string;
    
    if (!dataString) {
      return errorResponse("No data provided", 400);
    }

    const item = JSON.parse(dataString);
    await addItemToPosCart(item, decodedToken.uid);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

// DELETE - Remove item from cart or clear cart
export async function DELETE(request: NextRequest) {
  try {
    const decodedToken = await verifyPosAuth("manage_pos_cart");

    // Standardized FormData + JSON data parsing for DELETE
    const formData = await request.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return errorResponse("No data provided", 400);
    }

    const body = JSON.parse(dataString);

    // If clearAll flag is set, clear entire cart
    if (body.clearAll) {
      if (!body.stockId) {
        return errorResponse("Stock ID is required to clear cart", 400);
      }
      await clearPosCart(body.stockId, decodedToken.uid);
      return NextResponse.json({ success: true, message: "Cart cleared" });
    }

    // Otherwise, remove specific item
    await removeFromPosCart(body, decodedToken.uid);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

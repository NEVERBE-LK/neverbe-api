import { NextRequest, NextResponse } from "next/server";
import {
  getOrderForExchange,
  processExchange,
  getRecentExchanges,
} from "@/services/ExchangeService";
import { verifyPosAuth, handleAuthError } from "@/services/AuthService";

/**
 * GET - Check order eligibility for exchange or list recent exchanges
 * Query params:
 *   - orderId: Check specific order eligibility
 *   - stockId: Optional stock filter
 *   - list: If "true", return recent exchanges instead
 */
export async function GET(request: NextRequest) {
  try {
    await verifyPosAuth("process_pos_exchange");

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");
    const stockId = searchParams.get("stockId");
    const listMode = searchParams.get("list") === "true";

    // List recent exchanges
    if (listMode) {
      const exchanges = await getRecentExchanges(stockId || undefined, 50);
      return NextResponse.json(exchanges);
    }

    // Check order eligibility
    if (!orderId) {
      return NextResponse.json({ success: false, message: "orderId is required" }, { status: 400 });
    }

    const result = await getOrderForExchange(orderId, stockId || undefined);
    return NextResponse.json(result);
  } catch (error: any) {
    return handleAuthError(error);
  }
}

/**
 * POST - Process an exchange
 * Body: ExchangeRequest
 */
export async function POST(request: NextRequest) {
  try {
    const decodedToken = await verifyPosAuth("process_pos_exchange");

    // Standardized FormData + JSON data parsing
    const formData = await request.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return NextResponse.json({ success: false, message: "No data provided" }, { status: 400 });
    }

    const body = JSON.parse(dataString);

    // Validate required fields
    if (!body.originalOrderId) {
      return NextResponse.json({ success: false, message: "originalOrderId is required" }, { status: 400 });
    }
    if (!body.stockId) {
      return NextResponse.json({ success: false, message: "stockId is required" }, { status: 400 });
    }
    if (
      !body.returnedItems ||
      !Array.isArray(body.returnedItems) ||
      body.returnedItems.length === 0
    ) {
      return NextResponse.json({ success: false, message: "At least one returned item is required" }, { status: 400 });
    }

    const exchange = await processExchange(
      body,
      decodedToken.uid,
      decodedToken.name || decodedToken.email
    );

    return NextResponse.json({
      success: true,
      exchange,
      message: "Exchange processed successfully",
    });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

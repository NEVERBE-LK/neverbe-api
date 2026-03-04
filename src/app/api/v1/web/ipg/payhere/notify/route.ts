import { NextResponse } from "next/server";
import { IPGService } from "@/services/IPGService";
import { updatePayment } from "@/services/WebOrderService";

export const POST = async (req: Request) => {
  try {
    console.log("[PayHere Notify API] Incoming notification");

    // --- Step 1: Parse body as URLSearchParams ---
    const body = await req.text();
    console.log("[PayHere Notify API] Raw body:", body);

    const params = new URLSearchParams(body);
    const merchant_id = params.get("merchant_id")!;
    const order_id = params.get("order_id")!;
    const payment_id = params.get("payment_id")!;
    const payhere_amount = params.get("payhere_amount")!;
    const payhere_currency = params.get("payhere_currency")!;
    const status_code = params.get("status_code")!;
    const md5sig = params.get("md5sig")!;
    const method = params.get("method");

    console.log("[PayHere Notify API] Parsed params:", {
      merchant_id,
      order_id,
      payment_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
      method,
    });

    // --- Step 2 & 3: Verify signature using IPGService ---
    const isVerified = IPGService.verifyPayHereNotification(
      merchant_id,
      order_id,
      payhere_amount,
      payhere_currency,
      status_code,
      md5sig,
    );

    if (!isVerified) {
      console.error(
        "[PayHere Notify API] MD5 signature mismatch for order:",
        order_id,
      );
      return NextResponse.json(
        { message: "Unauthorized: Signature mismatch" },
        { status: 401 },
      );
    }
    console.log("[PayHere Notify API] Signature verified successfully");

    // --- Step 4: Update payment status ---
    if (status_code === "2") {
      console.log("✅ Payment successful for order:", order_id);
      await updatePayment(order_id, payment_id, "Paid");
      return NextResponse.json(
        { message: "Payment Successful" },
        { status: 200 },
      );
    } else {
      console.warn(
        "❌ Payment failed for order:",
        order_id,
        "Status code:",
        status_code,
      );
      await updatePayment(order_id, payment_id, "Failed");
      return NextResponse.json({ message: "Payment Failed" }, { status: 400 });
    }
  } catch (err: any) {
    console.error(
      "[PayHere Notify API] Error processing notification:",
      err.message,
      err.stack,
    );
    return NextResponse.json(
      { message: "Error processing payment", error: err.message },
      { status: 500 },
    );
  }
};

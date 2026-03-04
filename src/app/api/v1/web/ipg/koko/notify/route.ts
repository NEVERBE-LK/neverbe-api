// app/api/v1/koko/notify/route.ts
import { NextResponse } from "next/server";
import { IPGService } from "@/services/IPGService";
import { updatePayment } from "@/services/WebOrderService";

export const POST = async (req: Request) => {
  try {
    console.log("[Koko Notify API] Incoming notification");

    // --- Step 0: Parse form data ---
    const formData = await req.formData();
    const orderId = formData.get("orderId") as string;
    const trnId = formData.get("trnId") as string;
    const status = formData.get("status") as string;
    const signature = formData.get("signature") as string;
    const desc = formData.get("desc") as string | null;

    console.log("[Koko Notify API] Form data received:", {
      orderId,
      trnId,
      status,
      desc,
    });

    if (!orderId || !trnId || !status || !signature) {
      console.warn("[Koko Notify API] Missing required fields");
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 },
      );
    }

    // --- Step 1: Verify signature via IPGService ---
    const isVerified = IPGService.verifyKokoNotification(
      orderId,
      trnId,
      status,
      signature,
    );

    console.log("[Koko Notify API] Signature verification result:", isVerified);

    if (!isVerified) {
      console.error("[Koko Notify API] Invalid signature for order:", orderId);
      return NextResponse.json(
        { message: "Unauthorized: Invalid signature" },
        { status: 401 },
      );
    }

    // --- Step 4: Update order payment status ---
    if (status === "SUCCESS") {
      await updatePayment(orderId, trnId, "Paid");
      console.log(`✅ Payment success recorded for order ${orderId}`);
    } else {
      await updatePayment(orderId, trnId, "Failed");
      console.log(`⚠️ Payment failed for order ${orderId} (${status})`);
    }

    console.log("[Koko Notify API] Notification processed successfully");
    return NextResponse.json(
      { message: "Notification processed" },
      { status: 200 },
    );
  } catch (error: any) {
    console.error(
      "[Koko Notify API] Error processing notification:",
      error.message,
      error.stack,
    );
    return NextResponse.json(
      { message: "Error processing Koko notification", error: error.message },
      { status: 500 },
    );
  }
};

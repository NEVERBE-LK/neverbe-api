import { verifyToken } from "@/services/WebAuthService";
import { verifyCaptchaToken } from "@/services/CapchaService";
import {
  sendOrderConfirmedEmail,
  sendOrderConfirmedSMS,
} from "@/services/NotificationService";

export const GET = async (
  req: Request,
  context: { params: Promise<{ orderId: string }> }
) => {
  try {
    console.log("[Order Notification API] Incoming request");

    // Verify user token
    const tokenData = await verifyToken(req);
    console.log("[Order Notification API] Token verified:", tokenData?.uid);

    const orderId = (await context.params).orderId;
    console.log("[Order Notification API] Order ID:", orderId);

    // Get captcha token from query
    const captchaToken = new URL(req.url).searchParams.get("capchaToken");
    console.log(
      "[Order Notification API] Captcha token received:",
      captchaToken
    );

    // Verify captcha
    const captchaVerified = await verifyCaptchaToken(captchaToken);
    console.log(
      "[Order Notification API] Captcha verification result:",
      captchaVerified
    );

    if (captchaVerified) {
      // Check if order is HIGH_RISK and delivery fee is unpaid
      const { orderRepository } = await import("@/repositories/OrderRepository");
      const order = await orderRepository.findByOrderId(orderId);
      
      if (order && order.riskStatus === "HIGH_RISK" && !order.deliveryFeePrepaid) {
        console.log("[Order Notification API] Order is HIGH_RISK and fee unpaid. Deferring notifications.");
        return new Response(
          JSON.stringify({
            status: true,
            message: "Notifications deferred due to high risk",
          }),
          { status: 200 }
        );
      }

      console.log("[Order Notification API] Sending order confirmed SMS...");
      await sendOrderConfirmedSMS(orderId);
      console.log("[Order Notification API] SMS sent successfully");
      await sendOrderConfirmedEmail(orderId);
      console.log("[Order Notification API] Email sent successfully");

      return new Response(
        JSON.stringify({
          status: true,
          message: "Notifications sent successfully",
        }),
        { status: 200 }
      );
    } else {
      console.warn("[Order Notification API] Captcha verification failed");
      return new Response(
        JSON.stringify({
          status: false,
          message: "Security verification failed",
        }),
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error(
      "[Order Notification API] Error:",
      error.message,
      error.stack
    );
    return new Response(
      JSON.stringify({
        status: false,
        message: error.message || "Internal Server Error",
      }),
      { status: 500 }
    );
  }
};

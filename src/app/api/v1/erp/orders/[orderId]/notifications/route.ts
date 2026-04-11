import { NextRequest, NextResponse } from "next/server";
import { getNotificationLogs, sendManualNotification } from "@/services/NotificationService";
import { apiResponse } from "@/utils/apiResponse";

export const GET = async (
  req: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) => {
  try {
    const orderId = (await context.params).orderId;
    if (!orderId) {
      return apiResponse(null, "Order ID is required", 400);
    }

    const logs = await getNotificationLogs(orderId);
    return apiResponse(logs, "Notification logs retrieved successfully");
  } catch (error: any) {
    console.error("[Notification Route] GET Error:", error.message);
    return apiResponse(null, "Failed to retrieve notification logs", 500);
  }
};

export const POST = async (
  req: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) => {
  try {
    const orderId = (await context.params).orderId;
    const body = await req.json();
    const { type, content, subject } = body;

    if (!orderId || !type || !content) {
      return apiResponse(null, "Missing required fields (orderId, type, content)", 400);
    }

    if (type !== "sms" && type !== "email") {
      return apiResponse(null, "Invalid notification type. Must be 'sms' or 'email'", 400);
    }

    const result = await sendManualNotification(orderId, type, content, subject);

    if (result) {
      return apiResponse(null, "Notification sent successfully");
    } else {
      return apiResponse(null, "Failed to send notification. Check logs for details.", 500);
    }
  } catch (error: any) {
    console.error("[Notification Route] POST Error:", error.message);
    return apiResponse(null, "Internal Server Error", 500);
  }
};

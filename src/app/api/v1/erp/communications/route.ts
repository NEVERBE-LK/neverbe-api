import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { getAllNotificationLogs, sendManualNotification } from "@/services/NotificationService";
import { errorResponse, apiResponse } from "@/utils/apiResponse";

/**
 * GET: Fetch all customer communication logs
 */
export async function GET(req: Request) {
  try {
    const isAuthorized = await authorizeRequest(req);
    if (!isAuthorized) return errorResponse("Unauthorized", 401);

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const pageSize = parseInt(url.searchParams.get("pageSize") || "20", 10);

    const { logs, total } = await getAllNotificationLogs(page, pageSize);

    return NextResponse.json({ success: true, data: logs, total });
  } catch (error) {
    console.error("[Communications API] GET Error:", error);
    return errorResponse(error);
  }
}

/**
 * POST: Send a custom communication (SMS/Email)
 */
export async function POST(req: Request) {
  try {
    const isAuthorized = await authorizeRequest(req, "update_settings");
    if (!isAuthorized) return errorResponse("Unauthorized", 401);

    const body = await req.json();
    const { type, to, content, subject, orderId } = body;

    if (!type || !to || !content) {
      return errorResponse("Missing required fields: type, to, content", 400);
    }

    const result = await sendManualNotification(orderId || null, type, content, subject, to);

    if (result) {
      return apiResponse(null, "Notification sent successfully");
    } else {
      return errorResponse("Failed to send notification. Check logs for details.", 500);
    }
  } catch (error: any) {
    console.error("[Communications API] POST Error:", error.message);
    return errorResponse(error);
  }
}

export const dynamic = "force-dynamic";

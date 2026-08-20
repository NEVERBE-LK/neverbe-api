import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import { sendManualNotification } from "@/services/NotificationService";
import { successResponse } from "@/utils/apiResponse";

/**
 * POST: Send manual SMS or Email notification for an order
 */
export async function POST(req: Request) {
  try {
    await requirePermission(req, "manage_communications");

    const body = await req.json();
    const { orderId, type, content, subject, to } = body;

    if (!content || !type) {
      return NextResponse.json({ success: false, message: "Missing content or notification type" }, { status: 400 });
    }

    const success = await sendManualNotification(orderId || null, type, content, subject, to);

    if (success) {
      return successResponse(null, `${type.toUpperCase()} notification sent successfully`);
    } else {
      return NextResponse.json({ success: false, message: `Failed to send ${type.toUpperCase()} notification` }, { status: 500 });
    }
  } catch (error) {
    return handleAuthError(error);
  }
}

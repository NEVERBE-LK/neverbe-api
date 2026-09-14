import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import { successResponse } from "@/utils/apiResponse";
import { notificationRepository } from "@/repositories/NotificationRepository";

/**
 * GET: Fetch recent notifications for ERP
 */
export async function GET(req: Request) {
  try {
    await requirePermission(req);

    const notifications = await notificationRepository.getAdminNotifications(20);

    return NextResponse.json(notifications);
  } catch (error) {
    return handleAuthError(error);
  }
}

/**
 * PATCH: Mark all as read or a specific one
 */
export async function PATCH(req: Request) {
  try {
    await requirePermission(req);

    const { id, all } = await req.json();

    if (all || id) {
      await notificationRepository.markNotificationsAsRead(id, !!all);
      return successResponse(null, all ? "All notifications marked as read" : "Notification marked as read");
    }

    return NextResponse.json({ success: false, message: "Missing ID or 'all' flag" }, { status: 400 });
  } catch (error) {
    return handleAuthError(error);
  }
}

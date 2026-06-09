import { NextRequest, NextResponse } from "next/server";
import { verifyUserCredentials, handleAuthError } from "@/services/AuthService";

export const POST = async (req: NextRequest) => {
  try {
    const { token, requiredPermission } = await req.json();

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Authorization token is required" },
        { status: 400 }
      );
    }

    const result = await verifyUserCredentials(token, requiredPermission);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error("Credentials verification API error:", error);
    return handleAuthError(error);
  }
};

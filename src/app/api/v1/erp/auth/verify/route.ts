import { NextRequest, NextResponse } from "next/server";
import { verifyUserCredentials, handleAuthError } from "@/services/AuthService";

export const POST = async (req: NextRequest) => {
  try {
    const { token, requiredPermission, username, password } = await req.json();

    if (!token && (!username || !password)) {
      return NextResponse.json(
        { success: false, message: "Authorization token or username/password is required" },
        { status: 400 }
      );
    }

    const result = await verifyUserCredentials(token, requiredPermission, username, password);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error("ERP Credentials verification API error:", error);
    return handleAuthError(error);
  }
};

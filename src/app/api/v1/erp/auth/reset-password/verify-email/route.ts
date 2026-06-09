import { NextResponse } from "next/server";
import { verifyPasswordResetEmail, handleAuthError } from "@/services/AuthService";

export const POST = async (req: Request) => {
  try {
    const body = await req.json();
    const { email, otp } = body;

    if (!email || !otp) {
      return NextResponse.json({ success: false, message: "Missing email or OTP code" }, { status: 400 });
    }

    const result = await verifyPasswordResetEmail(email, otp);
    return NextResponse.json(result);
  } catch (error: any) {
    return handleAuthError(error);
  }
};

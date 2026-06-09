import { NextResponse } from "next/server";
import { resetUserPasswordCustom, handleAuthError } from "@/services/AuthService";

export const POST = async (req: Request) => {
  try {
    const body = await req.json();
    const { email, phoneNumber, phoneOtp, password, confirmPassword } = body;

    if (!email || !phoneNumber || !phoneOtp || !password || !confirmPassword) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, message: "Passwords do not match" }, { status: 400 });
    }

    const result = await resetUserPasswordCustom(email, phoneNumber, phoneOtp, password);
    return NextResponse.json(result);
  } catch (error: any) {
    return handleAuthError(error);
  }
};

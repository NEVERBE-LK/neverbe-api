import { NextResponse } from "next/server";
import { requestPasswordReset, handleAuthError } from "@/services/AuthService";

export const POST = async (req: Request) => {
  try {
    const body = await req.json();
    const { email, phoneNumber } = body;

    if (!email || !phoneNumber) {
      return NextResponse.json({ success: false, message: "Missing email or phone number" }, { status: 400 });
    }

    const result = await requestPasswordReset(email, phoneNumber);
    return NextResponse.json(result);
  } catch (error: any) {
    return handleAuthError(error);
  }
};

import { NextResponse } from "next/server";
import { checkSpammer } from "@/services/SpammerService";

export const GET = async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get("phone") || undefined;
    const email = searchParams.get("email") || undefined;

    const result = await checkSpammer(phone, email);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ isBlacklisted: false, error: err.message }, { status: 500 });
  }
};

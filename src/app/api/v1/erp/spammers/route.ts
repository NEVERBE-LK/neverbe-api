import { NextResponse } from "next/server";
import { getSpammers, createSpammer } from "@/services/SpammerService";
import { requirePermission, handleAuthError } from "@/services/AuthService";

export const GET = async (req: Request) => {
  try {
    await requirePermission(req, "manage_spammers");
    const data = await getSpammers();
    return NextResponse.json(data);
  } catch (err) {
    return handleAuthError(err);
  }
};

export const POST = async (req: Request) => {
  try {
    await requirePermission(req, "manage_spammers");
    const body = await req.json();
    if (!body.phone && !body.email) {
      return NextResponse.json(
        { success: false, message: "Phone number or Email is required" },
        { status: 400 }
      );
    }
    const result = await createSpammer(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleAuthError(err);
  }
};

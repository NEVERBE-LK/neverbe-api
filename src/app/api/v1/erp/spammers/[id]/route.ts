import { NextResponse } from "next/server";
import { deleteSpammer } from "@/services/SpammerService";
import { requirePermission, handleAuthError } from "@/services/AuthService";

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    await requirePermission(req, "manage_spammers");
    const { id } = await params;
    const result = await deleteSpammer(id);
    return NextResponse.json(result);
  } catch (err) {
    return handleAuthError(err);
  }
};

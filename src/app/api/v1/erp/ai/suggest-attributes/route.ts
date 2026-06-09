import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import { suggestAttributes } from "@/services/AIService";

export const POST = async (req: Request) => {
  try {
    await requirePermission(req, "view_dashboard");

    const formData = await req.formData();
    const dataString = formData.get("data") as string;

    if (!dataString) {
      return NextResponse.json({ success: false, message: "Missing data field" }, { status: 400 });
    }

    const body = JSON.parse(dataString);
    const { name, category, brand, description } = body;

    if (!name) {
      return NextResponse.json({ success: false, message: "Product name is required for AI auto select" }, { status: 400 });
    }

    const suggested = await suggestAttributes({ name, category, brand, description });

    return NextResponse.json({
      success: true,
      data: suggested,
    });
  } catch (error: unknown) {
    return handleAuthError(error);
  }
};

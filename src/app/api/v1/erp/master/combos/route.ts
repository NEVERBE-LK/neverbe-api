import { authorizeRequest } from "@/services/AuthService";
import { getCombos, createCombo } from "@/services/ComboService";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: NextRequest) => {
  try {
    const user = await authorizeRequest(req, "view_combos");
    if (!user) return errorResponse("Unauthorized", 401);

    const { searchParams } = req.nextUrl;
    const page = parseInt(searchParams.get("page") || "1");
    const size = parseInt(searchParams.get("size") || "20");

    const result = await getCombos(page, size);
    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const user = await authorizeRequest(req, "create_combos");
    if (!user) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const comboData = JSON.parse(rawData);

    // Basic Validation
    if (!comboData.name || !comboData.items || comboData.items.length === 0) {
      return errorResponse("Name and at least one item required", 400);
    }

    const combo = await createCombo(comboData, file || undefined);
    return NextResponse.json(combo, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

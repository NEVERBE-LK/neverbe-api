import { authorizeRequest } from "@/services/AuthService";
import {
  getComboById,
  updateCombo,
  deleteCombo,
} from "@/services/ComboService";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/utils/apiResponse";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export const GET = async (req: NextRequest, props: Props) => {
  const params = await props.params;
  try {
    const user = await authorizeRequest(req, "view_combos");
    if (!user) return errorResponse("Unauthorized", 401);

    const combo = await getComboById(params.id);
    if (!combo) {
      return errorResponse("Combo not found", 404);
    }
    return NextResponse.json(combo);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (req: NextRequest, props: Props) => {
  const params = await props.params;
  try {
    const user = await authorizeRequest(req, "update_combos");
    if (!user) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const comboData = JSON.parse(rawData);

    const updated = await updateCombo(params.id, comboData, file || undefined);
    return NextResponse.json(updated);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (req: NextRequest, props: Props) => {
  const params = await props.params;
  try {
    const user = await authorizeRequest(req, "delete_combos");
    if (!user) return errorResponse("Unauthorized", 401);

    const result = await deleteCombo(params.id);
    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

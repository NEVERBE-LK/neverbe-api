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

    const rawItems = formData.get("items");
    const items = rawItems ? JSON.parse(rawItems as string) : undefined;

    const payload: Partial<UnparsedComboData> = {};


    if (formData.has("name")) payload.name = formData.get("name") as string;
    if (formData.has("description"))
      payload.description = formData.get("description") as string;
    if (items) payload.items = items;
    if (formData.has("originalPrice"))
      payload.originalPrice = Number(formData.get("originalPrice"));
    if (formData.has("comboPrice"))
      payload.comboPrice = Number(formData.get("comboPrice"));
    if (formData.has("savings"))
      payload.savings = Number(formData.get("savings"));
    if (formData.has("type")) payload.type = formData.get("type") as string;
    if (formData.has("status"))
      payload.status = formData.get("status") as string;
    if (formData.has("buyQuantity"))
      payload.buyQuantity = Number(formData.get("buyQuantity"));
    if (formData.has("getQuantity"))
      payload.getQuantity = Number(formData.get("getQuantity"));
    if (formData.has("getDiscount"))
      payload.getDiscount = Number(formData.get("getDiscount"));
    if (formData.has("startDate"))
      payload.startDate = formData.get("startDate") as string;
    if (formData.has("endDate"))
      payload.endDate = formData.get("endDate") as string;

    const updated = await updateCombo(params.id, payload as any, file || undefined);
    return NextResponse.json(updated);
  } catch (error: any) {
    return errorResponse(error);
  }
};

interface UnparsedComboData {
  name: string;
  description: string;
  items: any[];
  originalPrice: number;
  comboPrice: number;
  savings: number;
  type: string;
  status: string;
  buyQuantity?: number;
  getQuantity?: number;
  getDiscount?: number;
  startDate?: string;
  endDate?: string;
}

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

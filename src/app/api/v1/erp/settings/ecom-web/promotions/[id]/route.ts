import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { deletePromotion } from "@/services/WebsiteService";
import { errorResponse } from "@/utils/apiResponse";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export const DELETE = async (req: Request, { params }: Props) => {
  try {
    const response = await authorizeRequest(req, "view_website");
    if (!response) {
      return errorResponse("Unauthorized", 401);
    }
    const { id } = await params;
    const result = await deletePromotion(id);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Promotions API] Delete Error:", error);
    return errorResponse(error);
  }
};

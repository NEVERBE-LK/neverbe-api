import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { uploadFile } from "@/services/StorageService";
import { addPromotion, getAllPromotions } from "@/services/WebsiteService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "view_website");
    if (!response) {
      return errorResponse("Unauthorized", 401);
    }
    const promotions = await getAllPromotions();
    return NextResponse.json(promotions);
  } catch (error: any) {
    console.error("[Promotions API] Error:", error);
    return errorResponse(error);
  }
};

export const POST = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "view_website");
    if (!response) {
      return errorResponse("Unauthorized", 401);
    }
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const title = formData.get("title") as string;
    const link = formData.get("link") as string;

    if (!file || !title || !link) {
      return errorResponse("Missing required fields", 400);
    }

    const { url } = await uploadFile(file, "promotions");
    const result = await addPromotion({ file: file.name, url, title, link });
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error("[Promotions API] Error:", error);
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

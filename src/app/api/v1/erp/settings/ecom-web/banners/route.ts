import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import { addABanner, getAllBanners } from "@/services/WebsiteService";
import { uploadFile } from "@/services/StorageService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "view_website");
    if (!response) {
      return errorResponse("Unauthorized", 401);
    }
    const banners = await getAllBanners();
    return NextResponse.json(banners);
  } catch (error: any) {
    console.error("[Banners API] Error:", error);
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
    const rawData = formData.get("data") as string;

    if (!rawData) {
      return errorResponse("Data is required", 400);
    }

    const { path } = JSON.parse(rawData);

    const res = await uploadFile(formData.get("banner") as File, path);
    const writeResult = await addABanner(res);
    return NextResponse.json(writeResult);
  } catch (error: any) {
    console.error("[Banners API] Error:", error);
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

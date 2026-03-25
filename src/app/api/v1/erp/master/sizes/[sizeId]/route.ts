import { NextResponse } from "next/server";
import { updateSize, deleteSize, getSizes } from "@/services/SizeService";
import { authorizeRequest } from "@/services/AuthService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ sizeId: string }> }
) => {
  try {
    const { sizeId } = await params;
    const user = await authorizeRequest(_req);
    if (!user) return errorResponse("Unauthorized", 401);

    const data = await getSizes({ page: 1, size: 1 }); // optionally fetch single
    const size = data.dataList.find((s) => s.id === sizeId);
    if (!size) return errorResponse("Size not found", 404);

    return NextResponse.json({ success: true, data: size });
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ sizeId: string }> }
) => {
  try {
    const { sizeId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const sizeData = await req.json();
    const { name, status } = sizeData;

    if (!name || !status)
      return errorResponse("Name and status are required", 400);

    const result = await updateSize(sizeId, sizeData);
    return NextResponse.json(result);
  } catch (err: any) {
    return errorResponse(err);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ sizeId: string }> }
) => {
  try {
    const { sizeId } = await params;
    const user = await authorizeRequest(req, "view_master_data");
    if (!user) return errorResponse("Unauthorized", 401);

    const result = await deleteSize(sizeId);
    return NextResponse.json(result);
  } catch (err: any) {
    return errorResponse(err);
  }
};

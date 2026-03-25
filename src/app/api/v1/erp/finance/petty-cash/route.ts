import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeAndGetUser } from "@/services/AuthService";
import { addPettyCash, getPettyCashList } from "@/services/PettyCashService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: NextRequest) => {
  try {
    const authorized = await authorizeRequest(req, "view_petty_cash");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const searchParams = req.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const size = parseInt(searchParams.get("size") || "20");
    const status = searchParams.get("status") || undefined;
    const type = searchParams.get("type") || undefined;
    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search") || undefined;
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;

    const result = await getPettyCashList(page, size, {
      status,
      type,
      category,
      search,
      fromDate,
      toDate,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const authorized = await authorizeRequest(req, "create_petty_cash");
    if (!authorized) return errorResponse("Unauthorized", 401);

    const user = await authorizeAndGetUser(req);
    if (!user) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const file = formData.get("attachment") as File | null;
    const dataField = formData.get("data");

    if (!dataField) {
      return errorResponse("Data is required", 400);
    }

    const data = JSON.parse(dataField as string);

    // Set createdBy from authenticated user
    if (user.userId) {
      data.createdBy = user.userId;
      data.updatedBy = user.userId;
    } else if (user.email) {
      // Fallback if userId is missing but email exists
      data.createdBy = user.email;
      data.updatedBy = user.email;
    }

    const newEntry = await addPettyCash(data, file || undefined);
    return NextResponse.json(newEntry, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

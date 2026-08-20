import { NextRequest, NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import { addPettyCash, getPettyCashList } from "@/services/PettyCashService";

export const GET = async (req: NextRequest) => {
  try {
    await requirePermission(req, "view_petty_cash");

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
    return handleAuthError(error);
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const decodedToken = await requirePermission(req, "create_petty_cash");

    const formData = await req.formData();
    const file = formData.get("attachment") as File | null;
    const dataField = formData.get("data");

    if (!dataField) {
      return NextResponse.json({ success: false, message: "Data is required" }, { status: 400 });
    }

    const data = JSON.parse(dataField as string);

    // Set createdBy from authenticated user
    data.createdBy = decodedToken.name || decodedToken.email || decodedToken.uid;
    data.updatedBy = decodedToken.name || decodedToken.email || decodedToken.uid;

    const newEntry = await addPettyCash(data, file || undefined);
    return NextResponse.json(newEntry, { status: 201 });
  } catch (error: any) {
    return handleAuthError(error);
  }
};

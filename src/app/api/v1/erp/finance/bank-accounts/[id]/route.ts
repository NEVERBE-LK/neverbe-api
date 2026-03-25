import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getBankAccountById,
  updateBankAccount,
  deleteBankAccount,
  updateBankAccountBalance,
} from "@/services/BankAccountService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_bank_accounts");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const account = await getBankAccountById(id);

    if (!account) return errorResponse("Account not found", 404);

    return NextResponse.json(account);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const PUT = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_bank_accounts");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);

    // Check if this is a balance update
    if (body.balanceUpdate) {
      const account = await updateBankAccountBalance(
        id,
        body.amount,
        body.type
      );
      return NextResponse.json(account);
    }

    const account = await updateBankAccount(id, body);
    return NextResponse.json(account);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const response = await authorizeRequest(req, "view_bank_accounts");
    if (!response) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    await deleteBankAccount(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

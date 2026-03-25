import { NextResponse } from "next/server";
import { authorizeRequest } from "@/services/AuthService";
import {
  getBankAccounts,
  createBankAccount,
  getBankAccountsDropdown,
  getTotalBalance,
} from "@/services/BankAccountService";
import { errorResponse } from "@/utils/apiResponse";

export const GET = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "view_bank_accounts");
    if (!response) return errorResponse("Unauthorized", 401);

    const url = new URL(req.url);
    const dropdown = url.searchParams.get("dropdown") === "true";
    const summary = url.searchParams.get("summary") === "true";

    if (dropdown) {
      const data = await getBankAccountsDropdown();
      return NextResponse.json(data);
    }

    if (summary) {
      const total = await getTotalBalance();
      return NextResponse.json({ totalBalance: total });
    }

    const data = await getBankAccounts();
    return NextResponse.json(data);
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const POST = async (req: Request) => {
  try {
    const response = await authorizeRequest(req, "manage_bank_accounts");
    if (!response) return errorResponse("Unauthorized", 401);

    const formData = await req.formData();
    const data = formData.get("data");

    if (!data) {
      return errorResponse("Data is required", 400);
    }

    const body = JSON.parse(data as string);
    const account = await createBankAccount(body);
    return NextResponse.json(account, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
};

export const dynamic = "force-dynamic";

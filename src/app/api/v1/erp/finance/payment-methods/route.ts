import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import {
  getPaymentMethods,
  createPaymentMethod,
} from "@/services/SettingsService";
import { uploadFile } from "@/services/StorageService";

// GET: List all payment methods
export async function GET(req: Request) {
  try {
    await requirePermission(req, "view_payment_methods");

    const methods = await getPaymentMethods();
    return NextResponse.json(methods);
  } catch (error: any) {
    return handleAuthError(error);
  }
}

// POST: Create a new payment method
export async function POST(req: Request) {
  try {
    await requirePermission(req, "manage_payment_methods");

    const formData = await req.formData();
    const dataString = formData.get("data") as string;
    const imageFile = formData.get("image") as File | null;

    if (!dataString) {
      return NextResponse.json({ success: false, message: "Missing data field" }, { status: 400 });
    }

    const body = JSON.parse(dataString);
    const { name, fee, customerFee, status, available, description, paymentId } = body;

    if (!name) {
      return NextResponse.json({ success: false, message: "Name is required" }, { status: 400 });
    }

    let imageUrl: string | undefined;
    if (imageFile && imageFile.size > 0) {
      const result = await uploadFile(imageFile, `payment-methods/${paymentId || name}`);
      imageUrl = result.url;
    }

    const newMethod = await createPaymentMethod({
      name,
      fee: Number(fee) || 0,
      customerFee: Number(customerFee) || 0,
      status: status === true,
      available: Array.isArray(available) ? available : ["Store"],
      description: description || "",
      paymentId: paymentId || `pm-${Math.floor(Math.random() * 1000)}`,
      ...(imageUrl && { imageUrl }),
    });

    return NextResponse.json({ success: true, method: newMethod });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

import { NextResponse } from "next/server";
import { requirePermission, handleAuthError } from "@/services/AuthService";
import {
  updatePaymentMethod,
  deletePaymentMethod,
} from "@/services/SettingsService";
import { uploadFile } from "@/services/StorageService";

// PUT: Update payment method
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(req, "manage_payment_methods");

    const { id } = await params;
    const formData = await req.formData();
    const dataString = formData.get("data") as string;
    const imageFile = formData.get("image") as File | null;

    if (!dataString) {
      return NextResponse.json({ success: false, message: "Missing data field" }, { status: 400 });
    }

    const body = JSON.parse(dataString);

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.fee !== undefined) updateData.fee = Number(body.fee);
    if (body.customerFee !== undefined) updateData.customerFee = Number(body.customerFee);
    if (body.status !== undefined) updateData.status = body.status === true;
    if (body.available !== undefined) updateData.available = body.available;
    if (body.description !== undefined)
      updateData.description = body.description;
    if (body.paymentId !== undefined) updateData.paymentId = body.paymentId;

    if (imageFile && imageFile.size > 0) {
      const result = await uploadFile(imageFile, `payment-methods/${id}`);
      updateData.imageUrl = result.url;
    }

    await updatePaymentMethod(id, updateData);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

// DELETE: Soft delete payment method
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requirePermission(req, "manage_payment_methods");

    const { id } = await params;

    await deletePaymentMethod(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

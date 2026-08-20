import { grnRepository } from "@/repositories/GRNRepository";
import { inventoryRepository } from "@/repositories/InventoryRepository";
import { purchaseOrderRepository } from "@/repositories/PurchaseOrderRepository";
import { GRN, GRNItem, GRNStatus } from "@/model/GRN";
import { nanoid } from "nanoid";
import {
  getPurchaseOrderById,
  updateReceivedQuantities,
} from "./PurchaseOrderService";
import { AppError } from "@/utils/apiResponse";
import { formatEntityDates, formatListDates, getNowSL } from "./UtilService";

/**
 * GRNService - Business logic for Good Received Notes
 * Delegates data access to grnRepository
 */

const generateGRNNumber = async (): Promise<string> => {
  const today = getNowSL();
  const prefix = `GRN-${today.format("YYYYMM")}`;

  const lastGRNNumber = await grnRepository.findLastGRNNumber(prefix);

  let sequence = 1;
  if (lastGRNNumber) {
    const lastSeq = parseInt(lastGRNNumber.split("-").pop() || "0", 10);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${String(sequence).padStart(4, "0")}`;
};

export const getGRNs = async (
  purchaseOrderId?: string,
  status?: GRNStatus,
): Promise<GRN[]> => {
  const { dataList } = await grnRepository.findPaginated({ purchaseOrderId, status, size: 1000 });
  return formatListDates(dataList);
};

export const getGRNById = async (id: string): Promise<GRN> => {
  const grn = await grnRepository.findById(id);
  if (!grn) throw new AppError(`GRN with ID ${id} not found`, 404);
  return formatEntityDates(grn);
};

export const createGRN = async (
  grn: Omit<GRN, "id" | "grnNumber" | "inventoryUpdated" | "createdAt" | "updatedAt">,
): Promise<GRN> => {
  await getPurchaseOrderById(grn.purchaseOrderId);
  const grnNumber = await generateGRNNumber();
  const totalAmount = grn.items.reduce((sum, item) => sum + item.totalCost, 0);

  const id = `grn-${nanoid(8)}`;
  const newGRN: GRN = {
    ...grn,
    grnNumber,
    totalAmount,
    inventoryUpdated: false,
    status: grn.status || "DRAFT",
  } as GRN;

  const savedGRN = await grnRepository.create(id, newGRN);

  if (grn.status === "APPROVED") {
    await processGRNApproval(id);
  }

  return savedGRN;
};

export const updateGRNStatus = async (
  id: string,
  updatePayload: Partial<GRN> | GRNStatus,
): Promise<GRN> => {
  const grn = await getGRNById(id);
  if (grn.status === "REJECTED") {
    throw new AppError(`Cannot update status of a ${grn.status} GRN`, 400);
  }

  const updateData: Partial<GRN> =
    typeof updatePayload === "string" ? { status: updatePayload } : updatePayload;

  const targetStatus = updateData.status || grn.status;
  await grnRepository.update(id, updateData);

  if (targetStatus === "APPROVED" && !grn.inventoryUpdated) {
    await processGRNApproval(id);
  }

  return await getGRNById(id);
};

const processGRNApproval = async (id: string): Promise<void> => {
  const grn = await getGRNById(id);
  if (grn.inventoryUpdated) return;

  await grnRepository.runTransaction(async (tx) => {
    // 1️⃣ Update inventory quantities
    for (const item of grn.items) {
      if (item.receivedQuantity <= 0) continue;
      await inventoryRepository.upsertStock(
        tx,
        item.productId,
        item.variantId || null,
        item.size,
        item.stockId,
        item.receivedQuantity
      );
    }

    // 2️⃣ Update PO received quantities within the SAME transaction
    await purchaseOrderRepository.updateReceivedQuantities(
      grn.purchaseOrderId,
      grn.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        size: item.size,
        quantity: item.receivedQuantity,
      })),
      tx
    );

    // 3️⃣ Mark GRN as inventory updated within the SAME transaction
    await grnRepository.update(id, { inventoryUpdated: true }, tx);
  });
};

export const getGRNsBySupplierId = async (supplierId: string): Promise<GRN[]> => {
  const { dataList } = await grnRepository.findPaginated({ supplierId, size: 1000 });
  return formatListDates(dataList);
};

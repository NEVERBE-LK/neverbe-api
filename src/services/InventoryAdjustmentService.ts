import { adminAuth } from "@/firebase/firebaseAdmin";
import { inventoryAdjustmentRepository } from "@/repositories/InventoryAdjustmentRepository";
import { inventoryRepository } from "@/repositories/InventoryRepository";
import {
  InventoryAdjustment,
  AdjustmentItem,
  AdjustmentType,
  AdjustmentStatus,
} from "@/model/InventoryAdjustment";
import { AppError } from "@/utils/apiResponse";
import { nanoid } from "nanoid";
import { formatEntityDates, formatListDates, getNowSL } from "./UtilService";

/**
 * InventoryAdjustmentService - Business logic for stock adjustments
 * Delegates data access to repositories
 */

const generateAdjustmentNumber = async (): Promise<string> => {
  const now = getNowSL();
  const prefix = `ADJ-${now.format("YYYYMM")}`;

  const lastNumber = await inventoryAdjustmentRepository.findLastAdjustmentNumber(prefix);

  let sequence = 1;
  if (lastNumber) {
    const lastSeq = parseInt(lastNumber.split("-").pop() || "0", 10);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${String(sequence).padStart(4, "0")}`;
};

export const getAdjustments = async (
  pageNumber = 1,
  size = 20,
  search?: string,
  type?: AdjustmentType,
  status?: AdjustmentStatus,
): Promise<{ dataList: InventoryAdjustment[]; rowCount: number }> => {
  const { dataList, total } = await inventoryAdjustmentRepository.findPaginated({
    page: pageNumber,
    size,
    search,
    type,
    status
  });

  const adjustments = dataList as (InventoryAdjustment & { adjustedByName?: string })[];

  // Resolve adjustedBy user names
  const userIds = Array.from(new Set(adjustments.map((a) => a.adjustedBy).filter(Boolean)));
  if (userIds.length > 0) {
    try {
      const usersResult = await adminAuth.getUsers(userIds.map((id) => ({ uid: id as string })));
      const userMap = new Map(usersResult.users.map((u) => [u.uid, u.displayName || u.email || "Unknown User"]));
      adjustments.forEach((adj) => { if (adj.adjustedBy) adj.adjustedByName = userMap.get(adj.adjustedBy); });
    } catch (authError) {
      console.warn("[AdjustmentService] Error resolving usernames:", authError);
    }
  }

  return { dataList: formatListDates(adjustments), rowCount: total };
};

export const getAdjustmentById = async (id: string): Promise<InventoryAdjustment & { adjustedByName?: string }> => {
  const data = await inventoryAdjustmentRepository.findById(id);
  if (!data) throw new AppError(`Adjustment with ID ${id} not found`, 404);

  let adjustedByName = "";
  if (data.adjustedBy) {
    try {
      const user = await adminAuth.getUser(data.adjustedBy);
      adjustedByName = user.displayName || user.email || "Unknown User";
    } catch (e) {
      console.warn("[AdjustmentService] Error fetching user", e);
    }
  }

  return formatEntityDates({ ...data, adjustedByName });
};

export const createAdjustment = async (
  adjustment: Omit<InventoryAdjustment, "id" | "adjustmentNumber" | "createdAt" | "updatedAt">,
  userId: string,
): Promise<InventoryAdjustment> => {
  const adjustmentNumber = await generateAdjustmentNumber();
  const status = adjustment.status || "DRAFT";
  const id = `adj-${nanoid(8)}`;

  const saved = await inventoryAdjustmentRepository.create(id, {
    ...adjustment,
    status,
    adjustmentNumber,
    adjustedBy: userId,
  });

  if (status === "COMPLETED") {
    await updateInventoryFromAdjustment(adjustment.items, adjustment.type);
  }

  return formatEntityDates(saved);
};

export const updateAdjustmentStatus = async (
  id: string,
  status: AdjustmentStatus,
  userId: string,
  extraData?: Partial<InventoryAdjustment>,
): Promise<void> => {
  const currentData = await inventoryAdjustmentRepository.findById(id);
  if (!currentData) throw new AppError("Adjustment not found", 404);
  if (currentData.status === "COMPLETED" || currentData.status === "APPROVED") {
    throw new AppError("Cannot change status of an already approved/completed adjustment", 400);
  }

  await inventoryAdjustmentRepository.update(id, {
    status,
    ...extraData,
  });

  if (status === "APPROVED" || status === "COMPLETED") {
    await updateInventoryFromAdjustment(currentData.items, currentData.type);
  }
};

const updateInventoryFromAdjustment = async (items: AdjustmentItem[], type: AdjustmentType): Promise<void> => {
  const batch = inventoryAdjustmentRepository.createBatch();

  for (const item of items) {
    if (item.quantity <= 0) continue;

    switch (type) {
      case "add":
      case "return":
        await inventoryRepository.upsertStock(batch, item.productId, item.variantId || null, item.size, item.stockId, item.quantity);
        break;
      case "remove":
      case "damage":
        await inventoryRepository.deductStock(batch, item.productId, item.variantId || null, item.size, item.stockId, item.quantity);
        break;
      case "transfer":
        await inventoryRepository.deductStock(batch, item.productId, item.variantId || null, item.size, item.stockId, item.quantity);
        if (item.destinationStockId) {
          await inventoryRepository.upsertStock(batch, item.productId, item.variantId || null, item.size, item.destinationStockId, item.quantity);
        }
        break;
    }
  }

  await batch.commit();
};

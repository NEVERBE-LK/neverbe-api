import { adminFirestore } from "@/firebase/firebaseAdmin";
import { PettyCash } from "@/model/PettyCash";
import { nanoid } from "nanoid";
import { Timestamp } from "firebase-admin/firestore";
import { uploadFile } from "@/services/StorageService";
import { AppError } from "@/utils/apiResponse";
import { updateBankAccountBalance } from "./BankAccountService"; // Moved import to top

const COLLECTION_NAME = "expenses";

/**
 * Add new petty cash entry
 */
export const addPettyCash = async (
  data: Omit<
    PettyCash,
    "id" | "createdAt" | "updatedAt" | "reviewedBy" | "reviewedAt"
  >,
  file?: File,
): Promise<PettyCash> => {
  if (!data.date) {
    throw new AppError("Date is required", 400);
  }
  const id = `pc-${nanoid(8)}`;
  let attachmentUrl = "";

  if (file) {
    const uploadResult = await uploadFile(file, `petty-cash/${id}`);
    attachmentUrl = uploadResult.url;
  }

  const newEntry = {
    ...data,
    id,
    date:
      data.date instanceof Timestamp
        ? data.date
        : typeof data.date === "string" || typeof data.date === "number"
          ? Timestamp.fromDate(new Date(data.date))
          : Timestamp.now(),
    attachment: attachmentUrl,
    status: "PENDING",
    isDeleted: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  await adminFirestore.collection(COLLECTION_NAME).doc(id).set(newEntry);

  return {
    ...newEntry,
    date: newEntry.date.toDate().toISOString(),
    createdAt: newEntry.createdAt.toDate().toISOString(),
    updatedAt: newEntry.updatedAt.toDate().toISOString(),
  } as unknown as PettyCash;
};

export const updatePettyCash = async (
  id: string,
  data: Partial<PettyCash>,
  file?: File,
): Promise<PettyCash> => {
  const docRef = adminFirestore.collection(COLLECTION_NAME).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new AppError(`Petty Cash entry with ID ${id} not found`, 404);
  }

  const currentData = doc.data() as PettyCash;
  if (currentData.status === "APPROVED") {
    throw new AppError("Cannot edit an approved entry.", 400);
  }

  let attachmentUrl = currentData.attachment;

  if (file) {
    const uploadResult = await uploadFile(file, `petty-cash/${id}`);
    attachmentUrl = uploadResult.url;
  }

  delete data.isDeleted;

  const updates: any = {
    ...data,
    attachment: attachmentUrl,
    updatedAt: Timestamp.now(),
  };

  if (data.date) {
    updates.date =
      data.date instanceof Timestamp
        ? data.date
        : Timestamp.fromDate(new Date(data.date as string));
  }

  await docRef.update(updates);

  // Return complete updated object
  const updatedDoc = await docRef.get();
  return updatedDoc.data() as PettyCash;
};

export const getPettyCashList = async (
  page: number = 1,
  size: number = 10,
  filters?: {
    status?: string;
    type?: string;
    category?: string;
    search?: string;
    fromDate?: string;
    toDate?: string;
    stockId?: string;
  },
): Promise<{ data: PettyCash[]; total: number }> => {
  let query: FirebaseFirestore.Query = adminFirestore
    .collection(COLLECTION_NAME)
    .where("isDeleted", "==", false)
    .orderBy("createdAt", "desc");

  if (filters?.status && filters.status !== "ALL") {
    query = query.where("status", "==", filters.status);
  }
  if (filters?.type && filters.type !== "ALL") {
    query = query.where("type", "==", filters.type);
  }
  if (filters?.category && filters.category !== "ALL") {
    query = query.where("category", "==", filters.category);
  }
  if (filters?.stockId) {
    query = query.where("stockId", "==", filters.stockId);
  }

  const snapshot = await query.get();

  let results = snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      ...d,
      date:
        d.date instanceof Timestamp ? d.date.toDate().toISOString() : d.date,
      createdAt:
        d.createdAt instanceof Timestamp
          ? d.createdAt.toDate().toISOString()
          : d.createdAt,
      updatedAt:
        d.updatedAt instanceof Timestamp
          ? d.updatedAt.toDate().toISOString()
          : d.updatedAt,
      reviewedAt:
        d.reviewedAt instanceof Timestamp
          ? d.reviewedAt.toDate().toISOString()
          : d.reviewedAt,
    } as PettyCash;
  });

  if (filters?.search) {
    const s = filters.search.toLowerCase();
    results = results.filter(
      (r) =>
        r.note?.toLowerCase().includes(s) ||
        r.category?.toLowerCase().includes(s) ||
        r.subCategory?.toLowerCase().includes(s) ||
        r.id.toLowerCase().includes(s),
    );
  }

  if (filters?.fromDate) {
    const fd = new Date(filters.fromDate).getTime();
    results = results.filter((r) => new Date(r.date as string).getTime() >= fd);
  }
  if (filters?.toDate) {
    const td = new Date(filters.toDate).getTime() + 86400000; // Add one day to include the entire 'toDate'
    results = results.filter((r) => new Date(r.date as string).getTime() < td);
  }
  // Apply pagination
  results = results.slice((page - 1) * size, page * size);

  const total = results.length;
  return { data: results, total };
};

export const getPettyCashById = async (id: string): Promise<PettyCash> => {
  const doc = await adminFirestore.collection(COLLECTION_NAME).doc(id).get();
  if (!doc.exists) {
    throw new AppError(`Petty Cash entry with ID ${id} not found`, 404);
  }
  const d = doc.data() as PettyCash;

  return {
    ...d,
    date: d.date instanceof Timestamp ? d.date.toDate().toISOString() : d.date,
    createdAt:
      d.createdAt instanceof Timestamp
        ? d.createdAt.toDate().toISOString()
        : d.createdAt,
    updatedAt:
      d.updatedAt instanceof Timestamp
        ? d.updatedAt.toDate().toISOString()
        : d.updatedAt,
    reviewedAt:
      d.reviewedAt instanceof Timestamp
        ? d.reviewedAt.toDate().toISOString()
        : d.reviewedAt,
  } as PettyCash;
};

export const deletePettyCash = async (id: string): Promise<void> => {
  const docRef = adminFirestore.collection(COLLECTION_NAME).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new AppError(`Petty Cash entry with ID ${id} not found`, 404);
  }

  const data = doc.data() as PettyCash;
  if (data.status === "APPROVED") {
    throw new AppError("Cannot delete an approved entry.", 400);
  }

  await docRef.update({
    isDeleted: true,
    updatedAt: Timestamp.now(),
  });
};

/**
 * Review petty cash entry (Approve/Reject)
 * Updates bank balance if approved and bank account is linked
 */
export const reviewPettyCash = async (
  id: string,
  status: "APPROVED" | "REJECTED",
  reviewerId: string,
): Promise<PettyCash> => {
  const docRef = adminFirestore.collection(COLLECTION_NAME).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new AppError(`Petty Cash entry with ID ${id} not found`, 404);
  }

  const currentData = doc.data() as PettyCash;
  if (currentData.status !== "PENDING") {
    throw new AppError(`Entry is already ${currentData.status}`, 400);
  }

  // If approving and bank account is linked, update balance
  if (status === "APPROVED" && currentData.bankAccountId) {
    // For expense: subtract from bank
    // For income: add to bank
    const balanceType = currentData.type === "expense" ? "subtract" : "add";

    await updateBankAccountBalance(
      currentData.bankAccountId,
      currentData.amount,
      balanceType,
    );
  }

  const updates = {
    status,
    reviewedBy: reviewerId,
    reviewedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  await docRef.update(updates);

  const updatedDoc = await docRef.get();
  const d = updatedDoc.data();

  return {
    ...d,
    date:
      d?.date instanceof Timestamp ? d.date.toDate().toISOString() : d?.date,
    createdAt:
      d?.createdAt instanceof Timestamp
        ? d.createdAt.toDate().toISOString()
        : d?.createdAt,
    updatedAt:
      d?.updatedAt instanceof Timestamp
        ? d.updatedAt.toDate().toISOString()
        : d?.updatedAt,
    reviewedAt:
      d?.reviewedAt instanceof Timestamp
        ? d.reviewedAt.toDate().toISOString()
        : d?.reviewedAt,
  } as PettyCash;
};

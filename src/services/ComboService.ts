import { adminFirestore, adminStorageBucket } from "@/firebase/firebaseAdmin";
import { ComboProduct } from "@/model/ComboProduct";
import { FieldValue } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import { toSafeLocaleString } from "./UtilService";
import { AppError } from "@/utils/apiResponse";
import { uploadCompressedImage } from "./StorageService";

const COMBOS_COLLECTION = "combo_products";
const BUCKET = adminStorageBucket;

const uploadThumbnail = async (
  file: File,
  id: string,
): Promise<ComboProduct["thumbnail"]> => {
  const filePath = `combos/${id}/thumbnail/thumb_${Date.now()}.webp`;
  const url = await uploadCompressedImage(file, filePath);

  return {
    url: url,
    file: filePath,
  };
};

export const getCombos = async (
  pageNumber: number = 1,
  size: number = 20,
): Promise<{ dataList: ComboProduct[]; rowCount: number }> => {
  try {
    let query: FirebaseFirestore.Query = adminFirestore
      .collection(COMBOS_COLLECTION)
      .where("isDeleted", "!=", true);

    const offset = (pageNumber - 1) * size;
    const snapshot = await query.offset(offset).limit(size).get();

    const allDocs = await adminFirestore
      .collection(COMBOS_COLLECTION)
      .where("isDeleted", "!=", true)
      .count()
      .get();
    const rowCount = allDocs.data().count;

    const dataList = snapshot.docs.map((doc) => {
      const data = doc.data() as Omit<ComboProduct, "id">;
      return {
        id: doc.id,
        ...data,
        createdAt: toSafeLocaleString(data.createdAt) || "",
        updatedAt: toSafeLocaleString(data.updatedAt) || "",
        startDate: toSafeLocaleString(data.startDate) || "",
        endDate: toSafeLocaleString(data.endDate) || "",
      };
    });

    return { dataList, rowCount };
  } catch (error) {
    console.error("Error getting combos:", error);
    throw error;
  }
};

export const createCombo = async (
  data: Omit<ComboProduct, "id" | "updatedAt" | "createdAt" | "thumbnail">,
  file?: File,
): Promise<ComboProduct> => {
  const docId = `combo-${nanoid(10)}`;
  const now = FieldValue.serverTimestamp();

  let thumbnail;
  if (file) {
    thumbnail = await uploadThumbnail(file, docId);
  }


  const newCombo = {
    ...data,
    startDate: data.startDate ? new Date(data.startDate as any) : null,
    endDate: data.endDate ? new Date(data.endDate as any) : null,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    thumbnail: thumbnail || null,
  };

  await adminFirestore.collection(COMBOS_COLLECTION).doc(docId).set(newCombo);

  return { id: docId, ...newCombo } as unknown as ComboProduct;
};

export const updateCombo = async (
  id: string,
  data: Partial<ComboProduct>,
  file?: File,
): Promise<ComboProduct> => {
  const docRef = adminFirestore.collection(COMBOS_COLLECTION).doc(id);
  const docSnap = await docRef.get();

  if (!docSnap.exists || docSnap.data()?.isDeleted) {
    throw new AppError(`Combo with ID ${id} not found`, 404);
  }

  // Remove createdAt and thumbnail from data to handle separately
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdAt, thumbnail: existingThumbnail, ...updateData } = data;

  let newThumbnail: ComboProduct["thumbnail"] | undefined;

  if (file) {
    const oldPath = docSnap.data()?.thumbnail?.file;
    if (oldPath) {
      try {
        await BUCKET.file(oldPath).delete();
      } catch (delError) {
        console.warn(`Failed to delete old thumbnail: ${oldPath}`, delError);
      }
    }
    newThumbnail = await uploadThumbnail(file, id);
  }


  const payload: any = {
    ...updateData,
    ...(newThumbnail ? { thumbnail: newThumbnail } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await docRef.update(payload);
  const updatedDoc = await docRef.get();
  return { id: updatedDoc.id, ...updatedDoc.data() } as ComboProduct;
};

export const deleteCombo = async (id: string): Promise<{ id: string }> => {
  const docRef = adminFirestore.collection(COMBOS_COLLECTION).doc(id);
  const docSnap = await docRef.get();

  if (!docSnap.exists || docSnap.data()?.isDeleted) {
    throw new AppError(`Combo with ID ${id} not found`, 404);
  }

  await docRef.update({
    isDeleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id };
};

export const getComboById = async (id: string): Promise<ComboProduct> => {
  const doc = await adminFirestore.collection(COMBOS_COLLECTION).doc(id).get();
  if (!doc.exists) throw new AppError("Combo not found", 404);
  const data = doc.data() as ComboProduct;

  // Skip soft-deleted combos
  if (data.isDeleted) throw new AppError("Combo not found", 404);

  return {
    ...data,
    id: doc.id,
    createdAt: toSafeLocaleString(data.createdAt) || "",
    updatedAt: toSafeLocaleString(data.updatedAt) || "",
    startDate: toSafeLocaleString(data.startDate) || "",
    endDate: toSafeLocaleString(data.endDate) || "",
  } as ComboProduct;
};

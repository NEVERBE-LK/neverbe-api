import { adminFirestore } from "@/firebase/firebaseAdmin";
import { Size } from "@/model/Size";
import { AppError } from "@/utils/apiResponse";
import { nanoid } from "nanoid";
import { cleanData } from "./UtilService";

const COLLECTION = "sizes";

// 🔹 Get Sizes (pagination, optional search by name & status)
export const getSizes = async ({
  page = 1,
  size = 10,
  search = "",
  status,
}: {
  page?: number;
  size?: number;
  search?: string;
  status?: "active" | "inactive" | null;
}) => {
  try {
    let query: FirebaseFirestore.Query = adminFirestore
      .collection(COLLECTION)
      .where("isDeleted", "==", false)
      .orderBy("name");

    if (status === "active") query = query.where("status", "==", "active");
    if (status === "inactive") query = query.where("status", "==", "inactive");

    if (search.trim()) {
      const s = search.trim();
      query = query.where("name", ">=", s).where("name", "<=", s + "\uf8ff");
    }

    const offset = (page - 1) * size;
    const snapshot = await query.offset(offset).limit(size).get();

    const dataList: Size[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Size),
    }));

    // Total count
    const totalSnapshot = await query.get();

    return { dataList, rowCount: totalSnapshot.size };
  } catch (error) {
    console.error("Get Sizes Error:", error);
    throw error;
  }
};

// 🔹 Create Size
export const createSize = async (data: Size) => {
  const id = `sz-${nanoid(8)}`;
  const cleanedData = cleanData(data);
  await adminFirestore
    .collection(COLLECTION)
    .doc(id)
    .set({
      ...cleanedData,
      nameLower: data.name.toLowerCase(),
      isDeleted: false,
    });
  return { id, ...data, nameLower: data.name.toLowerCase(), isDeleted: false };
};

// 🔹 Update Size
export const updateSize = async (id: string, data: Partial<Size>) => {
  const docRef = adminFirestore.collection(COLLECTION).doc(id);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new AppError(`Size with ID ${id} not found`, 404);
  }

  const cleanedData = cleanData(data);
  if (cleanedData.name) {
    // Note: Assuming nameLower is needed but not strictly typed in Partial<Size>
    (cleanedData as any).nameLower = cleanedData.name.toLowerCase();
  }
  await docRef.update(cleanedData);
  const updatedDoc = await docRef.get();
  return { id: updatedDoc.id, ...(updatedDoc.data() as Size) };
};

// 🔹 Delete Size (soft delete)
export const deleteSize = async (id: string) => {
  const docRef = adminFirestore.collection(COLLECTION).doc(id);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new AppError(`Size with ID ${id} not found`, 404);
  }

  await docRef.update({ isDeleted: true });
  return { id };
};

export const getSizeDropdown = async () => {
  try {
    const snapshot = await adminFirestore
      .collection(COLLECTION)
      .where("isDeleted", "==", false)
      .where("status", "==", true)
      .get();
    const sizes = snapshot.docs.map((doc) => ({
      id: doc.id,
      label: doc.data().name,
    }));
    return sizes;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

import { adminFirestore } from "@/firebase/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import { AppError } from "@/utils/apiResponse";

export interface Category {
  id?: string;
  name: string;
  description?: string;
  active: boolean;
  isDeleted?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const COLLECTION = "categories";

// CREATE
export const createCategory = async (category: Category) => {
  const id = `c-${nanoid(8)}`.toLowerCase(); // generates a short 8-character unique ID
  await adminFirestore
    .collection(COLLECTION)
    .doc(id)
    .set({
      ...category,
      id,
      active: category.active ?? true,
      isDeleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  const doc = await adminFirestore.collection(COLLECTION).doc(id).get();
  return { id: doc.id, ...(doc.data() as Category) };
};

export const getCategories = async ({
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
      .where("isDeleted", "==", false);

    // Apply status filter
    if (status === "active") query = query.where("active", "==", true);
    if (status === "inactive") query = query.where("active", "==", false);

    // Apply search filter
    if (search.trim()) {
      const s = search.trim();
      query = query.where("name", ">=", s).where("name", "<=", s + "\uf8ff");
    }

    // Pagination
    const offset = (page - 1) * size;
    const snapshot = await query.offset(offset).limit(size).get();

    const categories: Category[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Category),
    }));

    // Total count (optional)
    let totalQuery: FirebaseFirestore.Query = adminFirestore
      .collection(COLLECTION)
      .where("isDeleted", "==", false);
    if (status === "active")
      totalQuery = totalQuery.where("active", "==", true);
    if (status === "inactive")
      totalQuery = totalQuery.where("active", "==", false);
    if (search.trim()) {
      const s = search.trim();
      totalQuery = totalQuery
        .where("name", ">=", s)
        .where("name", "<=", s + "\uf8ff");
    }
    const totalSnapshot = await totalQuery.get();

    return {
      dataList: categories,
      rowCount: totalSnapshot.size,
    };
  } catch (error) {
    console.error("Get Categories Error:", error);
    return { dataList: [], rowCount: 0 };
  }
};

// READ single
export const getCategoryById = async (id: string) => {
  const doc = await adminFirestore.collection(COLLECTION).doc(id).get();
  if (!doc.exists || doc.data()?.isDeleted) {
    throw new AppError("Category not found", 404);
  }
  return { id: doc.id, ...(doc.data() as Category) };
};

// UPDATE
export const updateCategory = async (id: string, data: Partial<Category>) => {
  const ref = adminFirestore.collection(COLLECTION).doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data()?.isDeleted) {
    throw new AppError("Category not found", 404);
  }

  await ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() });
  const updatedDoc = await ref.get();
  return { id: updatedDoc.id, ...(updatedDoc.data() as Category) };
};

// SOFT DELETE
export const softDeleteCategory = async (id: string) => {
  const ref = adminFirestore.collection(COLLECTION).doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data()?.isDeleted) {
    throw new AppError("Category not found", 404);
  }

  await ref.update({
    isDeleted: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
};

// RESTORE
export const restoreCategory = async (id: string) => {
  const ref = adminFirestore.collection(COLLECTION).doc(id);
  const doc = await ref.get();

  if (!doc.exists) {
    throw new AppError("Category not found", 404);
  }

  await ref.update({
    isDeleted: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true };
};

export const getCategoriesForDropdown = async () => {
  try {
    const snapshot = await adminFirestore
      .collection(COLLECTION)
      .where("isDeleted", "==", false)
      .where("status", "==", true)
      .get();
    const categories = snapshot.docs.map((doc) => ({
      id: doc.id,
      label: doc.data().name,
    }));
    return categories;
  } catch (error) {
    console.log(error);
    return [];
  }
};

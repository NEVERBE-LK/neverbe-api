import { adminFirestore } from "@/firebase/firebaseAdmin";
import { ExpenseCategory } from "@/model/ExpenseCategory";
import { FieldValue } from "firebase-admin/firestore";
import { nanoid } from "nanoid";
import { AppError } from "@/utils/apiResponse";

const COLLECTION = "expense_categories";

/**
 * Get category by ID
 */
export const getExpenseCategoryById = async (
  id: string
): Promise<ExpenseCategory> => {
  try {
    const doc = await adminFirestore.collection(COLLECTION).doc(id).get();
    if (!doc.exists || doc.data()?.isDeleted) {
      throw new AppError(`Expense Category with ID ${id} not found`, 404);
    }
    return { id: doc.id, ...doc.data() } as ExpenseCategory;
  } catch (error) {
    console.error("[ExpenseCategoryService] Error fetching category:", error);
    throw error;
  }
};

/**
 * Create expense category
 */
export const createExpenseCategory = async (
  data: Omit<ExpenseCategory, "id">
): Promise<ExpenseCategory> => {
  try {
    const id = `ec-${nanoid(8)}`;
    const now = FieldValue.serverTimestamp();

    await adminFirestore
      .collection(COLLECTION)
      .doc(id)
      .set({
        ...data,
        id,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      });

    return {
      id,
      ...data,
    } as ExpenseCategory;
  } catch (error) {
    console.error("[ExpenseCategoryService] Error creating category:", error);
    throw error;
  }
};

/**
 * Get all expense categories
 */
export const getExpenseCategories = async (
  type?: "expense" | "income"
): Promise<ExpenseCategory[]> => {
  try {
    let query = adminFirestore
      .collection(COLLECTION)
      .where("isDeleted", "==", false);

    if (type) {
      query = query.where("type", "==", type);
    }

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ExpenseCategory[];
  } catch (error) {
    console.error("[ExpenseCategoryService] Error fetching categories:", error);
    throw error;
  }
};

/**
 * Update expense category
 */
export const updateExpenseCategory = async (
  id: string,
  data: Partial<ExpenseCategory>
): Promise<ExpenseCategory> => {
  try {
    const docRef = adminFirestore.collection(COLLECTION).doc(id);

    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new AppError(`Expense Category with ID ${id} not found`, 404);
    }

    const updateData = { ...data };
    delete (updateData as any).id;
    delete (updateData as any).createdAt;

    await docRef.update({
      ...updateData,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updated = await getExpenseCategoryById(id);
    return updated;
  } catch (error) {
    console.error("[ExpenseCategoryService] Error updating category:", error);
    throw error;
  }
};

/**
 * Delete expense category (soft delete)
 */
export const deleteExpenseCategory = async (id: string): Promise<void> => {
  try {
    const docRef = adminFirestore.collection(COLLECTION).doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new AppError(`Expense Category with ID ${id} not found`, 404);
    }

    await docRef.update({
      isDeleted: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[ExpenseCategoryService] Error deleting category:", error);
    throw error;
  }
};

/**
 * Get categories dropdown
 */
export const getExpenseCategoriesDropdown = async (
  type?: "expense" | "income"
): Promise<{ id: string; label: string }[]> => {
  try {
    let query: FirebaseFirestore.Query = adminFirestore
      .collection(COLLECTION)
      .where("isDeleted", "==", false)
      .where("status", "==", true);

    if (type) {
      query = query.where("type", "==", type);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.map((doc) => ({
      id: doc.id,
      label: doc.data().name as string,
    }));

    // Sort in memory
    return docs.sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    console.error("[ExpenseCategoryService] Error fetching dropdown:", error);
    return [];
  }
};

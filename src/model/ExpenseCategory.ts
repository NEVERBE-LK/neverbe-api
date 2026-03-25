export interface ExpenseCategory {
  id: string;
  name: string;
  description?: string;
  type: "expense" | "income";
  status: boolean;
  isDeleted?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

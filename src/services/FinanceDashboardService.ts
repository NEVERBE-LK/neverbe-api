import { adminFirestore } from "@/firebase/firebaseAdmin";
import { getBankAccounts } from "./BankAccountService";
import { getInvoiceAgingSummary } from "./SupplierInvoiceService";
import { getExpenseCategories } from "./ExpenseCategoryService";

export interface FinanceDashboardData {
  cards: {
    totalBankBalance: number;
    totalPayable: number;
    monthlyExpenses: number;
    monthlyIncome: number;
  };
  expenseBreakdown: { category: string; amount: number; color: string }[];
  recentTransactions: any[];
  cashFlow: { date: string; income: number; expense: number }[];
}

export const getFinanceDashboardData =
  async (): Promise<FinanceDashboardData> => {
    try {
      const banks = await getBankAccounts();
      const totalBankBalance = banks.reduce((acc, b) => acc + b.currentBalance, 0);

      const invoiceSummary = await getInvoiceAgingSummary();

      // Calculate Monthly Expenses/Income from PettyCash (and payments)
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const pettyCashSnapshot = await adminFirestore
        .collection("expenses")
        .where("status", "==", "APPROVED")
        .where("date", ">=", startOfMonth)
        .get();

      const paymentRecordsSnapshot = await adminFirestore
        .collection("payment_records")
        .where("date", ">=", startOfMonth)
        .get();

      const ordersSnapshot = await adminFirestore
        .collection("orders")
        .where("createdAt", ">=", startOfMonth)
        .where("paymentStatus", "in", ["Paid", "PAID"])
        .get();

      let monthlyExpenses = 0;
      let monthlyIncome = 0;
      const categoryMap: Record<string, number> = {};
      const cashFlowMap: Record<string, { income: number; expense: number }> =
        {};

      // Process Orders (Income)
      ordersSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const amount = Number(data.total) || 0;
        const date = new Date(
          (data.createdAt as any).toDate()
        ).toLocaleDateString("en-US", { month: "short", day: "numeric" });

        if (!cashFlowMap[date]) cashFlowMap[date] = { income: 0, expense: 0 };
        monthlyIncome += amount;
        cashFlowMap[date].income += amount;
      });

      // Process Petty Cash / Expenses
      pettyCashSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const amount = Number(data.amount) || 0;
        const date = new Date(
          (data.date as any).toDate()
        ).toLocaleDateString("en-US", { month: "short", day: "numeric" });

        if (!cashFlowMap[date]) cashFlowMap[date] = { income: 0, expense: 0 };

        if (data.type === "expense") {
          monthlyExpenses += amount;
          const cat = data.category || "Uncategorized";
          categoryMap[cat] = (categoryMap[cat] || 0) + amount;
          cashFlowMap[date].expense += amount;
        } else {
          monthlyIncome += amount;
          cashFlowMap[date].income += amount;
        }
      });

      // Process Payment Records (Supplier Payments)
      paymentRecordsSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const amount = Number(data.amount) || 0;
        const date = new Date((data.date as any).toDate()).toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric" }
        );

        if (!cashFlowMap[date]) cashFlowMap[date] = { income: 0, expense: 0 };

        // Payments are typically expenses
        monthlyExpenses += amount;
        const cat = data.category || "Supplier Payment";
        categoryMap[cat] = (categoryMap[cat] || 0) + amount;
        cashFlowMap[date].expense += amount;
      });

      // Expense Breakdown
      // Assign colors dynamically or fixed
      const colors = ["#16a34a", "#10b981", "#34d399", "#059669", "#047857"];
      const expenseBreakdown = Object.entries(categoryMap)
        .map(([category, amount], index) => ({
          category,
          amount,
          color: colors[index % colors.length],
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5); // Top 5

      const cashFlow = Object.entries(cashFlowMap)
        .map(([date, vals]) => ({
          date,
          ...vals,
        }))
        .sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

      // Recent Transactions (Mix of Petty Cash and Invoice Payments?)
      // Fetch separate recent queries
      const recentPetty = await adminFirestore
        .collection("expenses")
        .orderBy("date", "desc")
        .limit(5)
        .get();

      const recentPayments = await adminFirestore
        .collection("payment_records")
        .limit(5)
        .get();

      const transactions = [
        ...recentPetty.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          dateObj: (doc.data().date as any).toDate(),
          date: (doc.data().date as any).toDate().toLocaleDateString(),
          category: doc.data().category,
          amount: Number(doc.data().amount),
          type: doc.data().type,
          note: doc.data().note || doc.data().description,
        })),
        ...recentPayments.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          dateObj: (doc.data().date as any).toDate(),
          date: (doc.data().date as any).toDate().toLocaleDateString(),
          category: doc.data().category,
          amount: Number(doc.data().amount),
          type: "expense", // Payment records are expenses
          note: doc.data().description,
        })),
      ]
        .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())
        .slice(0, 5);

      return {
        cards: {
          totalBankBalance,
          totalPayable: invoiceSummary.totalPayable || 0,
          monthlyExpenses,
          monthlyIncome,
        },
        expenseBreakdown,
        recentTransactions: transactions,
        cashFlow,
      };
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      throw error;
    }
  };

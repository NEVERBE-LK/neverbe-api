import { orderRepository } from "@/repositories/OrderRepository";
import { pettyCashRepository, paymentRecordRepository } from "@/repositories/FinanceRepositories";
import { getBankAccounts } from "./BankAccountService";
import { getInvoiceAgingSummary } from "./SupplierInvoiceService";
import { formatToSLDate, getNowSL, parseToDayjs, formatListDates } from "./UtilService";

/**
 * FinanceDashboardService - Business logic for financial analytics
 * Delegates data access to repositories
 */

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

export const getFinanceDashboardData = async (): Promise<FinanceDashboardData> => {
  try {
    const banks = await getBankAccounts().catch(() => []);
    const totalBankBalance = banks.reduce((acc, b) => acc + (b.currentBalance || 0), 0);

    const invoiceSummary = await getInvoiceAgingSummary().catch(() => ({ totalPayable: 0 }));

    const now = getNowSL();
    const startOfMonth = now.startOf("month").toDate();

    const allPettyCash = await pettyCashRepository.findForDashboard().catch(() => []);
    const allPaymentRecords = await paymentRecordRepository.findForDashboard().catch(() => []);
    const allOrders = await orderRepository.findForReport().catch(() => []);

    const isCurrentMonth = (rawDate: any) => {
      const d = parseToDayjs(rawDate);
      if (!d) return false;
      return d.isSame(now, "month") && d.isSame(now, "year");
    };

    let monthlyExpenses = 0;
    let monthlyIncome = 0;
    const categoryMap: Record<string, number> = {};
    const cashFlowMap: Record<string, { income: number; expense: number }> = {};

    // Process Orders (Income - Current Month Only)
    allOrders.forEach((data: any) => {
      if (!isCurrentMonth(data.createdAt)) return;

      const isPaid = (data.paymentStatus || "").toUpperCase() === "PAID";
      const orderStatus = (data.status || "").toUpperCase();
      const isCancelledOrRefunded = ["CANCELLED", "CANCEL", "REFUNDED", "RETURNED"].includes(orderStatus);

      if (isPaid && !isCancelledOrRefunded) {
        const amount = Number(data.total) || 0;
        const dateKey = formatToSLDate(data.createdAt, "MMM DD");
        if (!cashFlowMap[dateKey]) cashFlowMap[dateKey] = { income: 0, expense: 0 };
        monthlyIncome += amount;
        cashFlowMap[dateKey].income += amount;
      }
    });

    // Process Petty Cash (Current Month Only)
    allPettyCash.forEach((data) => {
      if (data.status && data.status !== "APPROVED") return;
      if (!isCurrentMonth(data.date || data.createdAt)) return;

      const amount = Number(data.amount) || 0;
      const dateKey = formatToSLDate(data.date || data.createdAt, "MMM DD");
      if (!cashFlowMap[dateKey]) cashFlowMap[dateKey] = { income: 0, expense: 0 };

      if (data.type === "expense") {
        monthlyExpenses += amount;
        const cat = data.category || "Uncategorized";
        categoryMap[cat] = (categoryMap[cat] || 0) + amount;
        cashFlowMap[dateKey].expense += amount;
      } else if (data.type === "income" && data.category !== "Float Replenishment") {
        monthlyIncome += amount;
        cashFlowMap[dateKey].income += amount;
      }
    });

    // Process Payment Records / Supplier Payments (Current Month Only)
    allPaymentRecords.forEach((data) => {
      if (!isCurrentMonth(data.date || data.createdAt)) return;

      const amount = Number(data.amount) || 0;
      const dateKey = formatToSLDate(data.date || data.createdAt, "MMM DD");
      if (!cashFlowMap[dateKey]) cashFlowMap[dateKey] = { income: 0, expense: 0 };

      monthlyExpenses += amount;
      const cat = data.category || "Supplier Payment";
      categoryMap[cat] = (categoryMap[cat] || 0) + amount;
      cashFlowMap[dateKey].expense += amount;
    });

    const colors = ["#16a34a", "#10b981", "#34d399", "#059669", "#047857"];
    const expenseBreakdown = Object.entries(categoryMap)
      .map(([category, amount], index) => ({ category, amount, color: colors[index % colors.length] }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const cashFlow = Object.entries(cashFlowMap)
      .map(([date, vals]) => ({ date, ...vals }))
      .sort((a, b) => (parseToDayjs(a.date)?.valueOf() || 0) - (parseToDayjs(b.date)?.valueOf() || 0));

    const recentPetty = formatListDates(await pettyCashRepository.findRecent(5).catch(() => []), ["date", "createdAt", "updatedAt"]);
    const recentPayments = formatListDates(await paymentRecordRepository.findRecent(5).catch(() => []), ["date", "createdAt", "updatedAt"]);

    const transactions = [
      ...recentPetty.map((data) => ({
        id: data.id,
        ...data,
        dateVal: parseToDayjs(data.date || data.createdAt)?.valueOf() || 0,
        date: formatToSLDate(data.date || data.createdAt, "DD/MM/YYYY"),
        category: data.category,
        amount: Number(data.amount),
        type: data.type,
        note: data.note || data.description || "No Note",
      })),
      ...recentPayments.map((data) => ({
        id: data.id,
        ...data,
        dateVal: parseToDayjs(data.date || data.createdAt)?.valueOf() || 0,
        date: formatToSLDate(data.date || data.createdAt, "DD/MM/YYYY"),
        category: data.category,
        amount: Number(data.amount),
        type: "expense",
        note: data.description,
      })),
    ]
      .sort((a, b) => b.dateVal - a.dateVal)
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
    console.error("[FinanceDashboardService] Failed to generate dashboard data:", error);
    return {
      cards: {
        totalBankBalance: 0,
        totalPayable: 0,
        monthlyExpenses: 0,
        monthlyIncome: 0,
      },
      expenseBreakdown: [],
      recentTransactions: [],
      cashFlow: [],
    };
  }
};

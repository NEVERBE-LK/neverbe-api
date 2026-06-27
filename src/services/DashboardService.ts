import { productRepository } from "@/repositories/ProductRepository";
import { orderRepository } from "@/repositories/OrderRepository";
import { Order } from "@/model/Order";
import { PopularItem } from "@/model/PopularItem";
import { reportRepository } from "@/repositories/ReportRepository";
import { toSafeLocaleString, getNowSL, parseToDayjs } from "./UtilService";
import dayjs from "../utils/dayjs";

// ============================================================
// Interfaces
// ============================================================

export interface DashboardOverview {
  totalOrders: number;
  totalGrossSales: number;
  totalNetSales: number;
  totalShipping: number;
  totalDiscount: number;
  totalBuyingCost: number;
  totalFees: number;
  totalProfit: number;
}

export interface InventoryValue {
  totalValue: number;
  totalProducts: number;
  totalQuantity: number;
  avgItemValue: number;
}

export interface ProfitMargins {
  grossMargin: number;
  netMargin: number;
  operatingMargin: number;
  avgOrderValue: number;
}

export interface CategoryData {
  category: string;
  revenue: number;
  orders: number;
  percentage: number;
}

export interface ExpenseSummary {
  category: string;
  amount: number;
  percentage: number;
}

export interface YearlySalesPerformance {
  website: number[];
  store: number[];
  year: number;
}

export interface RecentOrder {
  orderId: string;
  paymentStatus: string;
  customerName: string;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  createdAt: string;
}

export interface LowStockItem {
  productId: string;
  productName: string;
  variantName: string;
  size: string;
  currentStock: number;
  thumbnail?: string;
}

export interface MonthlyComparison {
  currentMonth: { orders: number; revenue: number; profit: number };
  lastMonth: { orders: number; revenue: number; profit: number };
  percentageChange: { orders: number; revenue: number; profit: number };
}

export interface OrderStatusDistribution {
  pending: number;
  processing: number;
  completed: number;
  cancelled: number;
}

export interface PendingOrdersCount {
  pendingPayment: number;
  pendingFulfillment: number;
  total: number;
}

export interface WeeklyTrends {
  labels: string[];
  orders: number[];
  revenue: number[];
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get overview data for a specific date range
 */
export const getOverviewByDateRange = async (
  startDate: Date,
  endDate: Date,
): Promise<DashboardOverview> => {
  try {
    const orders = await orderRepository.findByStatusInDateRange(startDate, endDate);

    // Collect unique product IDs for COGS calculation
    const productIds: Set<string> = new Set();
    orders.forEach((order) => {
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => { if (item.itemId) productIds.add(item.itemId); });
      }
    });

    // Fetch product data for buying prices in batch (including sensitive data for COGS)
    const products = await productRepository.findByIds(Array.from(productIds), true);
    const productPriceMap = new Map(products.map(p => [p.id, p.buyingPrice || 0]));

    // Calculate totals
    let totalOrders = 0;
    let totalGrossSales = 0;
    let totalNetSales = 0;
    let totalDiscount = 0;
    let totalBuyingCost = 0;
    let totalTransactionFee = 0;
    let totalFee = 0;
    let totalShipping = 0;

    orders.forEach((order) => {
      totalOrders++;
      const orderTotal = order.total || 0;
      const orderDiscount = order.discount || 0;
      const orderShippingFee = order.shippingFee || 0;
      const orderTransactionFee = order.transactionFeeCharge || 0;
      const orderFee = order.fee || 0;

      // Calculate gross sales using actual item selling prices (item.price)
      let orderGross = 0;
      if (Array.isArray(order.items) && order.items.length > 0) {
        orderGross = order.items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0);
      } else {
        orderGross = Math.max(0, orderTotal + orderDiscount - orderShippingFee - orderFee);
      }

      // Net Sale = orderGross - orderDiscount
      const netSale = orderGross - orderDiscount;
      totalNetSales += netSale;
      totalGrossSales += orderGross;
      totalShipping += orderShippingFee;
      totalDiscount += orderDiscount;

      if (Array.isArray(order.items)) {
        order.items.forEach((item: any) => {
          const buyingPrice = (item.bPrice !== undefined && item.bPrice !== null && item.bPrice > 0)
            ? item.bPrice
            : (productPriceMap.get(item.itemId) || 0);
          const quantity = item.quantity || 0;
          totalBuyingCost += buyingPrice * quantity;
        });
      }
      totalTransactionFee += orderTransactionFee;
      totalFee += orderFee;
    });

    // Fetch expenses for operating expenses deduction
    const expenses = await reportRepository.findExpensesForReport({
      start: startDate,
      end: endDate,
      type: "expense",
      status: "APPROVED",
    });
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // Profit = Net Revenue + Order Fee - Buying Cost - Transaction Fee - Operating Expenses (fully aligned with P&L statement)
    const totalProfit = totalNetSales + totalFee - totalBuyingCost - totalTransactionFee - totalExpenses;

    return {
      totalOrders,
      totalGrossSales,
      totalNetSales,
      totalShipping,
      totalDiscount,
      totalBuyingCost,
      totalFees: totalFee,
      totalProfit,
    };
  } catch (error: any) {
    console.error("[DashboardService] Error:", error);
    throw error;
  }
};

/**
 * Get daily snapshot for the dashboard (today's data)
 */
export const getDailySnapshot = async (): Promise<DashboardOverview> => {
  const now = getNowSL();
  const startOfDay = now.startOf("day").toDate();
  const endOfDay = now.endOf("day").toDate();
  return getOverviewByDateRange(startOfDay, endOfDay);
};

// ============================================================
// Dashboard Widget Functions
// ============================================================

/**
 * Get total inventory valuation
 */
export const getInventoryValue = async (): Promise<InventoryValue> => {
  const products = await reportRepository.findAllProducts();
  let totalValue = 0;
  let totalProducts = 0;
  let totalQuantity = 0;

  products.forEach((p) => {
    const buyingPrice = p.buyingPrice || 0;
    const stock = p.totalStock || p.currentStock || 0;
    totalValue += buyingPrice * stock;
    totalQuantity += stock;
    totalProducts++;
  });

  return {
    totalValue,
    totalProducts,
    totalQuantity,
    avgItemValue: totalQuantity > 0 ? totalValue / totalQuantity : 0,
  };
};

/**
 * Get high-level profit margins
 */
export const getProfitMargins = async (): Promise<ProfitMargins> => {
  const now = getNowSL();
  const startOfMonth = now.startOf("month").toDate();
  const endOfMonth = now.endOf("month").toDate();

  const overview = await getOverviewByDateRange(startOfMonth, endOfMonth);

  const grossMargin = overview.totalGrossSales > 0
    ? ((overview.totalGrossSales - overview.totalBuyingCost) / overview.totalGrossSales) * 100
    : 0;

  const netMargin = overview.totalNetSales > 0
    ? (overview.totalProfit / overview.totalNetSales) * 100
    : 0;

  return {
    grossMargin: Math.round(grossMargin * 100) / 100,
    netMargin: Math.round(netMargin * 100) / 100,
    operatingMargin: Math.round(netMargin * 0.8 * 100) / 100,
    avgOrderValue: overview.totalOrders > 0 ? Math.round((overview.totalGrossSales / overview.totalOrders) * 100) / 100 : 0,
  };
};

/**
 * Get revenue distribution by category
 */
export const getRevenueByCategory = async (): Promise<CategoryData[]> => {
  const now = getNowSL();
  const startOfMonth = now.startOf("month").toDate();
  const endOfMonth = now.endOf("month").toDate();

  const orders = await orderRepository.findByStatusInDateRange(startOfMonth, endOfMonth, ["Paid", "PAID", "Success", "SUCCESS", "Completed", "COMPLETED"]);
  
  // Fetch product categories in batch if missing in orders
  const productIds = new Set<string>();
  orders.forEach(o => o.items?.forEach(i => { if (i.itemId) productIds.add(i.itemId); }));
  const products = await productRepository.findByIds(Array.from(productIds));
  const productCatMap = new Map(products.map(p => [p.id, p.category]));

  const categoryMap = new Map<string, { revenue: number; orders: number }>();
  let totalRevenue = 0;

  orders.forEach((order) => {
    if (Array.isArray(order.items)) {
      order.items.forEach((item) => {
        const cat = item.categoryName || productCatMap.get(item.itemId) || "Uncategorized";
        const revenue = (item.price || 0) * (item.quantity || 0);
        
        const existing = categoryMap.get(cat) || { revenue: 0, orders: 0 };
        categoryMap.set(cat, {
          revenue: existing.revenue + revenue,
          orders: existing.orders + 1
        });
        totalRevenue += revenue;
      });
    }
  });

  return Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      revenue: data.revenue,
      orders: data.orders,
      percentage: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100) : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
};

/**
 * Get monthly expense summary
 */
export const getExpenseSummary = async (): Promise<ExpenseSummary[]> => {
  const now = getNowSL();
  const startOfMonth = now.startOf("month").toDate();
  const endOfMonth = now.endOf("month").toDate();

  const expenses = await reportRepository.findExpensesForReport({
    start: startOfMonth,
    end: endOfMonth,
  });

  const categoryMap = new Map<string, number>();
  let totalAmount = 0;

  expenses.forEach((exp) => {
    const cat = exp.category || "General";
    const amount = exp.amount || 0;
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + amount);
    totalAmount += amount;
  });

  return Array.from(categoryMap.entries()).map(([category, amount]) => ({
    category,
    amount,
    percentage: totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0,
  }));
};

/**
 * Get yearly sales performance for chart
 */
export const getYearlySalesPerformance = async (year?: number): Promise<YearlySalesPerformance> => {
  const now = getNowSL();
  const currentYear = year || now.year();
  const startOfYear = dayjs().year(currentYear).startOf("year").toDate();
  const endOfYear = dayjs().year(currentYear).endOf("year").toDate();

  const orders = await orderRepository.findByStatusInDateRange(startOfYear, endOfYear);

  const websiteOrders = new Array(12).fill(0);
  const storeOrders = new Array(12).fill(0);

  orders.forEach((order) => {
    const createdAt = parseToDayjs(order.createdAt);
    if (createdAt) {
      const monthIndex = createdAt.month();
      const source = order.from?.toString().toLowerCase();
      if (source === "store") {
        storeOrders[monthIndex]++;
      } else {
        websiteOrders[monthIndex]++;
      }
    }
  });

  return { website: websiteOrders, store: storeOrders, year: currentYear };
};

export const getRecentOrders = async (limitCount: number = 6): Promise<RecentOrder[]> => {
  const orders = await orderRepository.findRecent(limitCount);
  return orders.map((data) => {
    const netAmount = data.total || 0;
    const discountAmount = data.discount || 0;
    const grossAmount = Array.isArray(data.items) && data.items.length > 0
      ? data.items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0)
      : netAmount + discountAmount - (data.shippingFee || 0) - (data.fee || 0);

    return {
      orderId: data.orderId || (data as any).id,
      paymentStatus: data.paymentStatus || "Unknown",
      customerName: data.customer?.name || "Guest Customer",
      grossAmount,
      discountAmount,
      netAmount,
      createdAt: toSafeLocaleString(data.createdAt) || String(data.createdAt),
    };
  });
};

export const getPopularItems = async (
  limit: number = 10,
  month: number,
  year: number,
): Promise<PopularItem[]> => {
  const startDay = dayjs().year(year).month(month).startOf("month").toDate();
  const endDay = dayjs().year(year).month(month).endOf("month").toDate();

  const orders = await orderRepository.findPaidOrdersInDateRange(startDay, endDay);

  const itemsMap = new Map<string, number>();
  orders.forEach((order) => {
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item) => {
        const count = itemsMap.get(item.itemId) || 0;
        itemsMap.set(item.itemId, count + item.quantity);
      });
    }
  });

  const sortedEntries = Array.from(itemsMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const productIds = sortedEntries.map(([id]) => id);
  const products = await productRepository.findByIds(productIds);
  const productMap = new Map(products.map(p => [p.id, p]));

  return sortedEntries.map(([itemId, count]) => {
    const product = productMap.get(itemId);
    if (!product) return null;
    return { item: product as any, soldCount: count };
  }).filter(Boolean) as PopularItem[];
};

export const getLowStockAlerts = async (threshold: number = 5, limit: number = 10): Promise<LowStockItem[]> => {
  return await productRepository.findLowStockAlerts(threshold, limit);
};

export const getMonthlyComparison = async (): Promise<MonthlyComparison> => {
  const now = getNowSL();
  const currentMonthStart = now.startOf("month").toDate();
  const currentMonthEnd = now.endOf("month").toDate();
  const lastMonthStart = now.subtract(1, "month").startOf("month").toDate();
  const lastMonthEnd = now.subtract(1, "month").endOf("month").toDate();

  const [currentData, lastData] = await Promise.all([
    getOverviewByDateRange(currentMonthStart, currentMonthEnd),
    getOverviewByDateRange(lastMonthStart, lastMonthEnd),
  ]);

  const calcChange = (current: number, last: number): number => {
    if (last === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - last) / last) * 100);
  };

  return {
    currentMonth: { orders: currentData.totalOrders, revenue: currentData.totalNetSales, profit: currentData.totalProfit },
    lastMonth: { orders: lastData.totalOrders, revenue: lastData.totalNetSales, profit: lastData.totalProfit },
    percentageChange: {
      orders: calcChange(currentData.totalOrders, lastData.totalOrders),
      revenue: calcChange(currentData.totalNetSales, lastData.totalNetSales),
      profit: calcChange(currentData.totalProfit, lastData.totalProfit),
    },
  };
};

export const getOrderStatusDistribution = async (): Promise<OrderStatusDistribution> => {
  const now = getNowSL();
  const startOfMonth = now.startOf("month").toDate();
  const endOfMonth = now.endOf("month").toDate();

  const orders = await orderRepository.findByStatusInDateRange(startOfMonth, endOfMonth, ["Paid", "PAID", "Pending", "Processing", "Completed", "Cancelled"]);

  const distribution: OrderStatusDistribution = { pending: 0, processing: 0, completed: 0, cancelled: 0 };
  orders.forEach((order) => {
    const status = order.status?.toLowerCase() || "pending";
    if (status === "pending") distribution.pending++;
    else if (status === "processing") distribution.processing++;
    else if (status === "completed") distribution.completed++;
    else if (status === "cancelled") distribution.cancelled++;
  });

  return distribution;
};

export const getPendingOrdersCount = async (): Promise<PendingOrdersCount> => {
  const [pendingPayment, pendingFulfillment] = await Promise.all([
    orderRepository.countByPaymentStatus("Pending"),
    orderRepository.countByStatusAndPayment("Paid", ["Pending", "Processing"]),
  ]);

  return { pendingPayment, pendingFulfillment, total: pendingPayment + pendingFulfillment };
};

export const getWeeklyTrends = async (): Promise<WeeklyTrends> => {
  const now = getNowSL();
  const start = now.subtract(6, "days").startOf("day").toDate();
  const end = now.endOf("day").toDate();

  const ordersList = await orderRepository.findByStatusInDateRange(start, end, ["Paid", "PAID", "Success", "SUCCESS", "Completed", "COMPLETED"]);

  const labels: string[] = [];
  const orders: number[] = [];
  const revenue: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = now.subtract(i, "days");
    const dayStr = date.format("ddd");
    
    const dayOrders = ordersList.filter(o => {
      const createdAt = parseToDayjs(o.createdAt);
      return createdAt && createdAt.isSame(date, "day");
    });

    labels.push(dayStr);
    orders.push(dayOrders.length);
    revenue.push(dayOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0));
  }

  return { labels, orders, revenue };
};

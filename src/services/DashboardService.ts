import { adminFirestore } from "@/firebase/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";
import { Order } from "@/model/Order";
import { Product } from "@/model/Product";
import { PopularItem } from "@/model/PopularItem";

/**
 * Dashboard Overview Response
 */
export interface DashboardOverview {
  totalOrders: number;
  totalGrossSales: number; // Gross Sale = total + discount - orderFee
  totalNetSales: number; // Net Sale = total - orderFee
  totalShipping: number; // Total shipping collected (pass-through)
  totalDiscount: number;
  totalBuyingCost: number; // Product COGS
  totalFees: number; // Transaction and other fees
  totalProfit: number; // Net Profit (after COGS, shipping, and fees)
}

/**
 * Yearly Sales Performance Response (for chart)
 */
export interface YearlySalesPerformance {
  website: number[]; // 12 months (0=Jan, 11=Dec)
  store: number[];
  year: number;
}

/**
 * Get daily snapshot for the dashboard (today's data)
 */
export const getDailySnapshot = async (): Promise<DashboardOverview> => {
  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  return getOverviewByDateRange(startOfDay, endOfDay);
};

/**
 * Get overview data for a specific date range
 */
export const getOverviewByDateRange = async (
  startDate: Date,
  endDate: Date,
): Promise<DashboardOverview> => {
  try {
    console.log(
      `[DashboardService] Fetching overview from ${startDate} to ${endDate}`,
    );

    const startTimestamp = Timestamp.fromDate(startDate);
    const endTimestamp = Timestamp.fromDate(endDate);

    // Fetch orders within date range (exclude Failed and Refunded)
    const ordersQuery = adminFirestore
      .collection("orders")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .where("paymentStatus", "not-in", ["Failed", "Refunded"]);

    const querySnapshot = await ordersQuery.get();

    // Collect unique product IDs for COGS calculation
    const productIds: Set<string> = new Set();
    querySnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      if (Array.isArray(order.items)) {
        order.items.forEach((item) => {
          if (item.itemId) {
            productIds.add(item.itemId);
          }
        });
      }
    });

    // Fetch product data for buying prices
    const productDocs = await Promise.all(
      Array.from(productIds).map((productId) =>
        adminFirestore.collection("products").doc(productId).get(),
      ),
    );

    const productPriceMap = new Map<string, number>();
    productDocs.forEach((doc) => {
      if (doc.exists) {
        const product = doc.data() as Product;
        productPriceMap.set(doc.id, product.buyingPrice || 0);
      }
    });

    // Calculate totals
    let totalOrders = 0;
    let totalGrossSales = 0;
    let totalNetSales = 0;
    let totalDiscount = 0;
    let totalBuyingCost = 0;
    let totalTransactionFee = 0;
    let totalFee = 0;
    let totalShipping = 0;

    querySnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      totalOrders++;

      const orderTotal = order.total || 0;
      const orderDiscount = order.discount || 0;
      const promoDiscount = order.promotionDiscount || 0;
      const orderShippingFee = order.shippingFee || 0;
      const orderTransactionFee = order.transactionFeeCharge || 0;
      const orderFee = order.fee || 0;

      // Item-level discounts
      const itemDiscounts = Array.isArray(order.items)
        ? order.items.reduce((sum, item) => sum + (item.discount || 0), 0)
        : 0;

      const allDiscounts = orderDiscount + promoDiscount + itemDiscounts;

      // Match ReportService formulas:
      // Net Sale = total - orderFee
      const netSale = orderTotal - orderFee;
      totalNetSales += netSale;

      // Gross Sale (Sales) = total + allDiscounts - orderFee - orderShippingFee
      const grossSale = orderTotal + allDiscounts - orderFee - orderShippingFee;
      totalGrossSales += grossSale;

      totalShipping += orderShippingFee;

      // Accumulate all discounts
      totalDiscount += allDiscounts;

      // Calculate COGS from items (bPrice * quantity)
      if (Array.isArray(order.items)) {
        order.items.forEach((item: any) => {
          const buyingPrice =
            item.bPrice ?? productPriceMap.get(item.itemId) ?? 0;
          const quantity = item.quantity || 0;
          totalBuyingCost += buyingPrice * quantity;
        });
      }
      totalTransactionFee += orderTransactionFee;
      totalFee += orderFee;
    });

    // Net Profit = (Net Sales + Other Income) - (Buying Cost + Shipping Cost + Transaction Fees)
    // totalNetSales is (orderTotal - orderFee)
    // totalFee is (orderFee)
    // totalNetSales + totalFee = orderTotal
    const totalProfit =
      totalNetSales +
      totalFee -
      (totalBuyingCost + totalShipping + totalTransactionFee);

    console.log(
      `[DashboardService] Fetched ${totalOrders} orders | Gross: ${totalGrossSales} | Net: ${totalNetSales} | COGS: ${totalBuyingCost} | Profit: ${totalProfit}`,
    );

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
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Get yearly sales performance for chart (order counts by month and source)
 */
export const getYearlySalesPerformance = async (
  year?: number,
): Promise<YearlySalesPerformance> => {
  try {
    const currentYear = year || new Date().getFullYear();
    console.log(
      `[DashboardService] Fetching yearly sales performance for ${currentYear}`,
    );

    const startOfYear = new Date(currentYear, 0, 1, 0, 0, 0, 0);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);
    const startTimestamp = Timestamp.fromDate(startOfYear);
    const endTimestamp = Timestamp.fromDate(endOfYear);

    const ordersQuery = adminFirestore
      .collection("orders")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .where("paymentStatus", "in", ["Paid", "Pending"]);

    const querySnapshot = await ordersQuery.get();

    const websiteOrders = new Array(12).fill(0);
    const storeOrders = new Array(12).fill(0);

    querySnapshot.forEach((doc) => {
      const data = doc.data() as Order;
      const createdAt = (data.createdAt as Timestamp)?.toDate?.();
      if (createdAt) {
        const monthIndex = createdAt.getMonth();
        const source = data.from?.toString().toLowerCase();
        if (source === "store") {
          storeOrders[monthIndex]++;
        } else {
          websiteOrders[monthIndex]++;
        }
      }
    });

    console.log(
      `[DashboardService] Sales performance: Website=${websiteOrders.reduce(
        (a, b) => a + b,
        0,
      )}, Store=${storeOrders.reduce((a, b) => a + b, 0)}`,
    );

    return {
      website: websiteOrders,
      store: storeOrders,
      year: currentYear,
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Recent Order Response (for dashboard timeline)
 */
export interface RecentOrder {
  orderId: string;
  paymentStatus: string;
  customerName: string;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  createdAt: string;
}

/**
 * Get recent orders for dashboard (latest N orders)
 */
export const getRecentOrders = async (
  limitCount: number = 6,
): Promise<RecentOrder[]> => {
  try {
    console.log(`[DashboardService] Fetching ${limitCount} recent orders`);

    const ordersQuery = adminFirestore
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(limitCount);

    const querySnapshot = await ordersQuery.get();

    const orders: RecentOrder[] = querySnapshot.docs.map((doc) => {
      const data = doc.data() as Order;

      // Net Amount = order.total (the real cash received, already correct from backend)
      const netAmount = data.total || 0;

      // Gross Amount = raw item prices before any discount
      const grossAmount = Array.isArray(data.items)
        ? data.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
        : netAmount;

      // Discount = difference between gross and net (+ shipping/fees if applicable)
      const discountAmount = Math.max(0, grossAmount - netAmount - (data.shippingFee || 0) + (data.fee || 0));

      // Format date
      const createdAt =
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toLocaleString()
          : String(data.createdAt);

      return {
        orderId: data.orderId || doc.id,
        paymentStatus: data.paymentStatus || "Unknown",
        customerName: data.customer?.name || "Guest Customer",
        grossAmount,
        discountAmount,
        netAmount,
        createdAt,
      };
    });

    console.log(`[DashboardService] Fetched ${orders.length} recent orders`);
    return orders;
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Get popular items for a specific month (for dashboard)
 */
export const getPopularItems = async (
  limit: number = 10,
  month: number, // 0-indexed (0 = Jan, 11 = Dec)
  year: number,
): Promise<PopularItem[]> => {
  try {
    // 1. Calculate First Day: Year, Month, 1st day
    const startDay = new Date(year, month, 1);
    startDay.setHours(0, 0, 0, 0);

    // 2. Calculate Last Day: "0th" day of the NEXT month gives the last day of THIS month
    const endDay = new Date(year, month + 1, 0);
    endDay.setHours(23, 59, 59, 999);

    console.log(
      `[DashboardService] Fetching popular items from ${startDay.toString()} to ${endDay.toString()}`,
    );

    const startTimestamp = Timestamp.fromDate(startDay);
    const endTimestamp = Timestamp.fromDate(endDay);

    // 3. Query Orders
    const orders = await adminFirestore
      .collection("orders")
      .where("paymentStatus", "==", "Paid")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .get();

    console.log(
      `[DashboardService] Fetched ${orders.size} orders for popular items`,
    );

    // 4. Aggregate Sales Counts
    const itemsMap = new Map<string, number>();
    orders.forEach((doc) => {
      const order = doc.data() as Order;
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach((item) => {
          const count = itemsMap.get(item.itemId) || 0;
          itemsMap.set(item.itemId, count + item.quantity);
        });
      }
    });

    console.log(`[DashboardService] Found ${itemsMap.size} unique items sold`);

    // 5. Sort IDs by count FIRST, slice top N, THEN fetch product data
    const sortedEntries = Array.from(itemsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    // 6. Fetch details only for the top items
    const popularItems: PopularItem[] = [];

    await Promise.all(
      sortedEntries.map(async ([itemId, count]) => {
        try {
          const productDoc = await adminFirestore
            .collection("products")
            .doc(itemId)
            .get();

          if (productDoc.exists) {
            const itemData = productDoc.data() as Product;
            popularItems.push({
              item: {
                ...itemData,
                createdAt: null,
                updatedAt: null,
              } as any,
              soldCount: count,
            });
          }
        } catch (fetchErr) {
          console.error(
            `[DashboardService] Error fetching product ${itemId}:`,
            fetchErr,
          );
        }
      }),
    );

    console.log(
      `[DashboardService] Returning ${popularItems.length} popular items`,
    );

    // 7. Final sort (Promise.all might return out of order)
    return popularItems.sort((a, b) => b.soldCount - a.soldCount);
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

// ============================================================
// NEW DASHBOARD METRICS
// ============================================================

/**
 * Low Stock Alert Item
 */
export interface LowStockItem {
  productId: string;
  productName: string;
  variantName: string;
  size: string;
  currentStock: number;
  thumbnail?: string;
}

/**
 * Get products with low stock (threshold: 5 or less)
 */
export const getLowStockAlerts = async (
  threshold: number = 5,
  limit: number = 10,
): Promise<LowStockItem[]> => {
  try {
    console.log(
      `[DashboardService] Fetching low stock items (threshold: ${threshold})`,
    );

    // Use 'stock_inventory' collection (not 'inventory')
    const inventoryQuery = adminFirestore
      .collection("stock_inventory")
      .where("quantity", "<=", threshold)
      .where("quantity", ">", 0)
      .orderBy("quantity", "asc")
      .limit(limit);

    const snapshot = await inventoryQuery.get();

    if (snapshot.empty) {
      return [];
    }

    // Collect product IDs for batch fetch - filter out empty/invalid values
    const productIds = new Set<string>();
    snapshot.docs.forEach((doc) => {
      const productId = doc.data().productId;
      if (
        productId &&
        typeof productId === "string" &&
        productId.trim() !== ""
      ) {
        productIds.add(productId);
      }
    });

    // Fetch product details only if we have valid IDs
    const validProductIds = Array.from(productIds);
    const productDocs =
      validProductIds.length > 0
        ? await Promise.all(
            validProductIds.map((id) =>
              adminFirestore.collection("products").doc(id).get(),
            ),
          )
        : [];

    const productMap = new Map<string, any>();
    productDocs.forEach((doc) => {
      if (doc.exists) {
        productMap.set(doc.id, doc.data());
      }
    });

    const lowStockItems: LowStockItem[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      const product = productMap.get(data.productId);

      return {
        productId: data.productId,
        productName: product?.name || "Unknown Product",
        variantName: data.variantName || "",
        size: data.size || "",
        currentStock: data.quantity || 0,
        thumbnail: product?.thumbnail?.url,
      };
    });

    console.log(
      `[DashboardService] Found ${lowStockItems.length} low stock items`,
    );
    return lowStockItems;
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Monthly Comparison Response
 */
export interface MonthlyComparison {
  currentMonth: {
    orders: number;
    revenue: number;
    profit: number;
  };
  lastMonth: {
    orders: number;
    revenue: number;
    profit: number;
  };
  percentageChange: {
    orders: number;
    revenue: number;
    profit: number;
  };
}

/**
 * Get monthly comparison (this month vs last month)
 */
export const getMonthlyComparison = async (): Promise<MonthlyComparison> => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Current month range
    const currentMonthStart = new Date(
      currentYear,
      currentMonth,
      1,
      0,
      0,
      0,
      0,
    );
    const currentMonthEnd = new Date(
      currentYear,
      currentMonth + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // Last month range
    const lastMonthStart = new Date(
      currentYear,
      currentMonth - 1,
      1,
      0,
      0,
      0,
      0,
    );
    const lastMonthEnd = new Date(
      currentYear,
      currentMonth,
      0,
      23,
      59,
      59,
      999,
    );

    console.log("[DashboardService] Fetching monthly comparison");

    // Fetch both months in parallel
    const [currentData, lastData] = await Promise.all([
      getOverviewByDateRange(currentMonthStart, currentMonthEnd),
      getOverviewByDateRange(lastMonthStart, lastMonthEnd),
    ]);

    // Calculate percentage changes
    const calcChange = (current: number, last: number): number => {
      if (last === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - last) / last) * 100);
    };

    return {
      currentMonth: {
        orders: currentData.totalOrders,
        revenue: currentData.totalNetSales,
        profit: currentData.totalProfit,
      },
      lastMonth: {
        orders: lastData.totalOrders,
        revenue: lastData.totalNetSales,
        profit: lastData.totalProfit,
      },
      percentageChange: {
        orders: calcChange(currentData.totalOrders, lastData.totalOrders),
        revenue: calcChange(currentData.totalNetSales, lastData.totalNetSales),
        profit: calcChange(currentData.totalProfit, lastData.totalProfit),
      },
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Order Status Distribution
 */
export interface OrderStatusDistribution {
  pending: number;
  processing: number;
  completed: number;
  cancelled: number;
}

/**
 * Get order status distribution for current month
 */
export const getOrderStatusDistribution =
  async (): Promise<OrderStatusDistribution> => {
    try {
      const now = new Date();
      const startOfMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      const endOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );

      console.log("[DashboardService] Fetching order status distribution");

      const ordersQuery = adminFirestore
        .collection("orders")
        .where("createdAt", ">=", Timestamp.fromDate(startOfMonth))
        .where("createdAt", "<=", Timestamp.fromDate(endOfMonth));

      const snapshot = await ordersQuery.get();

      const distribution: OrderStatusDistribution = {
        pending: 0,
        processing: 0,
        completed: 0,
        cancelled: 0,
      };

      snapshot.docs.forEach((doc) => {
        const order = doc.data() as Order;
        const status = order.status?.toLowerCase() || "pending";

        switch (status) {
          case "pending":
            distribution.pending++;
            break;
          case "processing":
            distribution.processing++;
            break;
          case "completed":
            distribution.completed++;
            break;
          case "cancelled":
            distribution.cancelled++;
            break;
          default:
            distribution.pending++;
        }
      });

      console.log(
        "[DashboardService] Order status distribution:",
        distribution,
      );
      return distribution;
    } catch (error: any) {
      console.error("[DashboardService] Error:", error);
      throw error;
    }
  };

/**
 * Pending Orders Count Response
 */
export interface PendingOrdersCount {
  pendingPayment: number;
  pendingFulfillment: number;
  total: number;
}

/**
 * Get count of orders needing attention
 */
export const getPendingOrdersCount = async (): Promise<PendingOrdersCount> => {
  try {
    console.log("[DashboardService] Fetching pending orders count");

    // Pending payment
    const pendingPaymentQuery = adminFirestore
      .collection("orders")
      .where("paymentStatus", "==", "Pending");

    // Pending fulfillment (paid but not completed)
    const pendingFulfillmentQuery = adminFirestore
      .collection("orders")
      .where("paymentStatus", "==", "Paid")
      .where("status", "in", ["Pending", "Processing"]);

    const [paymentSnapshot, fulfillmentSnapshot] = await Promise.all([
      pendingPaymentQuery.get(),
      pendingFulfillmentQuery.get(),
    ]);

    const result = {
      pendingPayment: paymentSnapshot.size,
      pendingFulfillment: fulfillmentSnapshot.size,
      total: paymentSnapshot.size + fulfillmentSnapshot.size,
    };

    console.log("[DashboardService] Pending orders:", result);
    return result;
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Weekly Trend Data
 */
export interface WeeklyTrends {
  labels: string[]; // Day names
  orders: number[];
  revenue: number[];
}

/**
 * Get weekly trends (last 7 days)
 */
export const getWeeklyTrends = async (): Promise<WeeklyTrends> => {
  try {
    console.log("[DashboardService] Fetching weekly trends");

    const now = new Date();
    const labels: string[] = [];
    const orders: number[] = [];
    const revenue: number[] = [];

    // Get last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
      labels.push(dayName);

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const dayQuery = adminFirestore
        .collection("orders")
        .where("createdAt", ">=", Timestamp.fromDate(startOfDay))
        .where("createdAt", "<=", Timestamp.fromDate(endOfDay))
        .where("paymentStatus", "==", "Paid");

      const snapshot = await dayQuery.get();

      let dayRevenue = 0;
      snapshot.docs.forEach((doc) => {
        const order = doc.data() as Order;
        dayRevenue += order.total || 0;
      });

      orders.push(snapshot.size);
      revenue.push(dayRevenue);
    }

    return { labels, orders, revenue };
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Expense Summary Response
 */
export interface ExpenseSummary {
  todayExpenses: number;
  monthExpenses: number;
  topCategory: string;
  topCategoryAmount: number;
}

/**
 * Get expense summary
 */
export const getExpenseSummary = async (): Promise<ExpenseSummary> => {
  try {
    console.log("[DashboardService] Fetching expense summary");

    const now = new Date();

    // Today
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // This month
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
    );
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // Fetch today's expenses
    const todayQuery = adminFirestore
      .collection("expenses")
      .where("type", "==", "expense")
      .where("status", "==", "APPROVED")
      .where("date", ">=", Timestamp.fromDate(startOfDay))
      .where("date", "<=", Timestamp.fromDate(endOfDay));

    // Fetch month's expenses
    const monthQuery = adminFirestore
      .collection("expenses")
      .where("type", "==", "expense")
      .where("status", "==", "APPROVED")
      .where("date", ">=", Timestamp.fromDate(startOfMonth))
      .where("date", "<=", Timestamp.fromDate(endOfMonth));

    const [todaySnapshot, monthSnapshot] = await Promise.all([
      todayQuery.get(),
      monthQuery.get(),
    ]);

    let todayExpenses = 0;
    todaySnapshot.docs.forEach((doc) => {
      todayExpenses += Number(doc.data().amount || 0);
    });

    let monthExpenses = 0;
    const categoryTotals = new Map<string, number>();
    monthSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const amount = Number(data.amount || 0);
      monthExpenses += amount;

      const category = data.for || "Other";
      categoryTotals.set(
        category,
        (categoryTotals.get(category) || 0) + amount,
      );
    });

    // Find top category
    let topCategory = "None";
    let topCategoryAmount = 0;
    categoryTotals.forEach((amount, category) => {
      if (amount > topCategoryAmount) {
        topCategory = category;
        topCategoryAmount = amount;
      }
    });

    return {
      todayExpenses,
      monthExpenses,
      topCategory,
      topCategoryAmount,
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Profit Margin Response
 */
export interface ProfitMargins {
  grossMargin: number;
  netMargin: number;
  avgOrderValue: number;
}

/**
 * Get profit margins for current month
 */
export const getProfitMargins = async (): Promise<ProfitMargins> => {
  try {
    console.log("[DashboardService] Fetching profit margins");

    const now = new Date();
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    const overview = await getOverviewByDateRange(startOfMonth, endOfMonth);

    const totalRevenue = overview.totalNetSales + overview.totalFees;

    const grossMargin =
      totalRevenue > 0
        ? Math.round(
            ((totalRevenue -
              (overview.totalBuyingCost + overview.totalShipping)) /
              totalRevenue) *
              100,
          )
        : 0;

    const netMargin =
      totalRevenue > 0
        ? Math.round((overview.totalProfit / totalRevenue) * 100)
        : 0;

    const avgOrderValue =
      overview.totalOrders > 0
        ? Math.round(totalRevenue / overview.totalOrders)
        : 0;

    return {
      grossMargin,
      netMargin,
      avgOrderValue,
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Inventory Value Response
 */
export interface InventoryValue {
  totalProducts: number;
  totalQuantity: number;
  totalValue: number;
  avgItemValue: number;
}

/**
 * Get total inventory value
 */
export const getInventoryValue = async (): Promise<InventoryValue> => {
  try {
    console.log("[DashboardService] Fetching inventory value");

    // Use 'stock_inventory' collection (not 'inventory')
    const inventorySnapshot = await adminFirestore
      .collection("stock_inventory")
      .get();

    if (inventorySnapshot.empty) {
      return {
        totalProducts: 0,
        totalQuantity: 0,
        totalValue: 0,
        avgItemValue: 0,
      };
    }

    // Collect product IDs - filter out empty/invalid values
    const productIds = new Set<string>();
    inventorySnapshot.docs.forEach((doc) => {
      const productId = doc.data().productId;
      if (
        productId &&
        typeof productId === "string" &&
        productId.trim() !== ""
      ) {
        productIds.add(productId);
      }
    });

    // Fetch product prices only if we have valid IDs
    const validProductIds = Array.from(productIds);
    const productDocs =
      validProductIds.length > 0
        ? await Promise.all(
            validProductIds.map((id) =>
              adminFirestore.collection("products").doc(id).get(),
            ),
          )
        : [];

    const productPriceMap = new Map<string, number>();
    productDocs.forEach((doc) => {
      if (doc.exists) {
        productPriceMap.set(doc.id, doc.data()?.buyingPrice || 0);
      }
    });

    let totalQuantity = 0;
    let totalValue = 0;

    inventorySnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const quantity = data.quantity || 0;
      const buyingPrice = productPriceMap.get(data.productId) || 0;

      totalQuantity += quantity;
      totalValue += quantity * buyingPrice;
    });

    return {
      totalProducts: productIds.size,
      totalQuantity,
      totalValue,
      avgItemValue:
        totalQuantity > 0 ? Math.round(totalValue / totalQuantity) : 0,
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[DashboardService] Error:", err);
    throw err;
  }
};

/**
 * Revenue by Category Item
 */
export interface CategoryRevenue {
  category: string;
  revenue: number;
  orders: number;
  percentage: number;
}

/**
 * Get revenue breakdown by category for current month
 */
export const getRevenueByCategory = async (): Promise<CategoryRevenue[]> => {
  try {
    console.log("[DashboardService] Fetching revenue by category");

    const now = new Date();
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    const ordersQuery = adminFirestore
      .collection("orders")
      .where("paymentStatus", "==", "Paid")
      .where("createdAt", ">=", Timestamp.fromDate(startOfMonth))
      .where("createdAt", "<=", Timestamp.fromDate(endOfMonth));

    const ordersSnapshot = await ordersQuery.get();

    // Collect product IDs - filter out empty/invalid values
    const productIds = new Set<string>();
    ordersSnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      order.items?.forEach((item) => {
        if (
          item.itemId &&
          typeof item.itemId === "string" &&
          item.itemId.trim() !== ""
        ) {
          productIds.add(item.itemId);
        }
      });
    });

    // Fetch product categories only if we have valid IDs
    const validProductIds = Array.from(productIds);
    const productDocs =
      validProductIds.length > 0
        ? await Promise.all(
            validProductIds.map((id) =>
              adminFirestore.collection("products").doc(id).get(),
            ),
          )
        : [];

    const productCategoryMap = new Map<string, string>();
    productDocs.forEach((doc) => {
      if (doc.exists) {
        productCategoryMap.set(doc.id, doc.data()?.category || "Uncategorized");
      }
    });

    // Aggregate by category
    const categoryMap = new Map<
      string,
      { revenue: number; orders: Set<string> }
    >();

    ordersSnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      order.items?.forEach((item) => {
        const category = productCategoryMap.get(item.itemId) || "Uncategorized";
        const itemRevenue = (item.price || 0) * (item.quantity || 0);

        if (!categoryMap.has(category)) {
          categoryMap.set(category, { revenue: 0, orders: new Set() });
        }

        const catData = categoryMap.get(category)!;
        catData.revenue += itemRevenue;
        catData.orders.add(doc.id);
      });
    });

    // Calculate totals and percentages
    let totalRevenue = 0;
    categoryMap.forEach((data) => {
      totalRevenue += data.revenue;
    });

    const result: CategoryRevenue[] = Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        revenue: data.revenue,
        orders: data.orders.size,
        percentage:
          totalRevenue > 0
            ? Math.round((data.revenue / totalRevenue) * 100)
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6); // Top 6 categories

    console.log(`[DashboardService] Found ${result.length} categories`);
    return result;
  } catch (error: any) {
    console.error("[DashboardService] Error:", error);
    throw error;
  }
};

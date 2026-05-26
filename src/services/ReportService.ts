import { orderRepository } from "@/repositories/OrderRepository";
import { reportRepository } from "@/repositories/ReportRepository";
import { brandRepository } from "@/repositories/BrandRepository";
import { categoryRepository } from "@/repositories/CategoryRepository";
import { productRepository } from "@/repositories/ProductRepository";
import { toSafeLocaleString, formatListDates, parseToDayjs } from "./UtilService";
import dayjs, { SL_TZ } from "../utils/dayjs";

import { Order } from "@/model/Order";
import { Timestamp } from "firebase-admin/firestore";

// Using centralized SL_TZ from dayjs utility

/**
 * ReportService - Business logic for analytical reports
 * Delegates data access to repositories
 */

export const getDailySaleReport = async (
  from: string,
  to: string,
  status: string = "Paid",
) => {
  try {
    const data = await reportRepository.findOrdersForAnalysis({
      start: parseToDayjs(from)?.toDate() || new Date(0),
      end: parseToDayjs(to)?.toDate() || new Date(),
      paymentStatus: status,
    });

    const report: any[] = [];
    let currentDate = dayjs(from).tz(SL_TZ).startOf("day");
    const endDate = dayjs(to).tz(SL_TZ).startOf("day");

    while (
      currentDate.isBefore(endDate) ||
      currentDate.isSame(endDate, "day")
    ) {
      const dateStr = currentDate.format("YYYY-MM-DD");
      const dayOrders = data.filter((o) => {
        const orderDate = parseToDayjs(o.createdAt)?.tz(SL_TZ);
        return orderDate.isSame(currentDate, "day");
      });

      const stats = {
        date: dateStr,
        orderCount: dayOrders.length,
        grossSales: dayOrders.reduce((sum, o) => sum + (o.total || 0), 0),
        discounts: dayOrders.reduce(
          (sum, o) =>
            sum + (o.couponDiscount || 0) + (o.promotionDiscount || 0),
          0,
        ),
        shipping: dayOrders.reduce((sum, o) => sum + (o.shippingFee || 0), 0),
      };

      report.push(stats);
      currentDate = currentDate.add(1, "day");
    }

    return report;
  } catch (error: any) {
    console.error("[ReportService] Daily sales error:", error);
    throw error;
  }
};

export const getSalesSummary = async (from: string, to: string) => {
  try {
    const data = await reportRepository.findOrdersForAnalysis({
      start: parseToDayjs(from)?.toDate() || new Date(0),
      end: parseToDayjs(to)?.toDate() || new Date(),
      paymentStatus: "Paid",
    });

    // Calculate clean net sales revenue (standard way)
    const totalRevenue = data.reduce((sum, o) => {
      const orderTotal = o.total || 0;
      const shippingFee = o.shippingFee || 0;
      const orderFee = (o as any).fee || 0;
      return sum + (orderTotal - shippingFee - orderFee);
    }, 0);

    const totalOrders = data.length;
    const totalItems = data.reduce(
      (sum, o) => sum + (o.items?.reduce((s: any, i: any) => s + i.quantity, 0) || 0),
      0,
    );
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
      totalRevenue,
      totalOrders,
      totalItems,
      avgOrderValue,
    };
  } catch (error: any) {
    console.error("[ReportService] Sales summary error:", error);
    throw error;
  }
};

export const getBrandSalesReport = async (from: string, to: string) => {
  try {
    const data = await reportRepository.findOrdersForAnalysis({
      start: parseToDayjs(from)?.toDate() || new Date(0),
      end: parseToDayjs(to)?.toDate() || new Date(),
      paymentStatus: "Paid",
    });

    const brandMap: Record<string, any> = {};

    for (const order of data) {
      const orderItems = order.items || [];
      for (const item of orderItems) {
        const product = await productRepository.findById(item.itemId);
        const brand = product?.brand || "Generic";

        if (!brandMap[brand]) {
          brandMap[brand] = {
            brand,
            totalQuantity: 0,
            totalSales: 0,
            orderCount: new Set(),
          };
        }

        brandMap[brand].totalQuantity += item.quantity;
        brandMap[brand].totalSales += (item.price || 0) * item.quantity;
        brandMap[brand].orderCount.add(order.id);
      }
    }

    return Object.values(brandMap).map((b: any) => ({
      ...b,
      orderCount: b.orderCount.size,
    }));
  } catch (error: any) {
    console.error("[ReportService] Brand sales error:", error);
    throw error;
  }
};

export const getCategorySalesReport = async (
  from: string,
  to: string,
  status: string = "Paid",
) => {
  try {
    const data = await reportRepository.findOrdersForAnalysis({
      start: parseToDayjs(from)?.toDate() || new Date(0),
      end: parseToDayjs(to)?.toDate() || new Date(),
      paymentStatus: status,
    });

    const categoryMap: Record<string, any> = {};

    for (const order of data) {
      const orderItems = order.items || [];
      const orderGrossSales = orderItems.reduce(
        (sum: number, i: any) => sum + (i.price || 0) * i.quantity,
        0,
      );
      const orderLevelDiscount =
        (order.couponDiscount || 0) + (order.promotionDiscount || 0);

      for (const item of orderItems) {
        const product = await productRepository.findById(item.itemId);

        const category = product?.category || "Uncategorized";

        if (!categoryMap[category]) {
          categoryMap[category] = {
            category,
            totalQuantity: 0,
            totalSales: 0,
            totalNetSales: 0,
            totalCOGS: 0,
            totalGrossProfit: 0,
            totalDiscount: 0,
            totalOrders: 0,
          };
        }

        const itemSubtotal = (item.price || 0) * item.quantity;
        const itemDiscountRatio =
          orderGrossSales > 0 ? itemSubtotal / orderGrossSales : 0;
        const itemDiscount = orderLevelDiscount * itemDiscountRatio;
        const itemNetSale = itemSubtotal - itemDiscount;

        // Calculate COGS
        const buyingPrice = product?.buyingPrice || 0;
        const itemCOGS = buyingPrice * item.quantity;

        categoryMap[category].totalQuantity += item.quantity;
        categoryMap[category].totalSales += itemSubtotal;
        categoryMap[category].totalNetSales += itemNetSale;
        categoryMap[category].totalCOGS += itemCOGS;
        categoryMap[category].totalGrossProfit += itemNetSale - itemCOGS;
        categoryMap[category].totalDiscount += itemDiscount;
        categoryMap[category].totalOrders += 1;
      }
    }

    return Object.values(categoryMap);
  } catch (error: any) {
    console.error("[ReportService] Category sales error:", error);
    throw error;
  }
};

export const getPaymentMethodReport = async (from: string, to: string) => {
  try {
    const data = await reportRepository.findOrdersForAnalysis({
      start: parseToDayjs(from)?.toDate() || new Date(0),
      end: parseToDayjs(to)?.toDate() || new Date(),
      paymentStatus: "Paid",
    });

    const methodMap: Record<string, any> = {};

    data.forEach((order) => {
      const method = order.paymentMethod || "Unknown";
      if (!methodMap[method]) {
        methodMap[method] = {
          method,
          orderCount: 0,
          totalSales: 0,
        };
      }
      methodMap[method].orderCount += 1;
      methodMap[method].totalSales += order.total || 0;
    });

    return Object.values(methodMap);
  } catch (error: any) {
    console.error("[ReportService] Payment method error:", error);
    throw error;
  }
};

export const getInventoryReport = async () => {
  try {
    const products = await reportRepository.findAllProducts();
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      brand: p.brand,
      stock: p.stock || 0,
      minStock: p.minStock || 0,
      price: p.price || 0,
      buyingPrice: p.buyingPrice || 0,
      valuation: (p.stock || 0) * (p.buyingPrice || 0),
    }));
  } catch (error: any) {
    console.error("[ReportService] Inventory report error:", error);
    throw error;
  }
};

export const getProfitLossReport = async (from: string, to: string) => {
  try {
    const start = parseToDayjs(from)?.toDate() || new Date(0);
    const end = parseToDayjs(to)?.toDate() || new Date();

    // Fetch orders for revenue and COGS
    const orders = await reportRepository.findOrdersForAnalysis({
      start,
      end,
      paymentStatus: "Paid",
    });

    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalDiscounts = 0;
    let totalShippingRevenue = 0;

    for (const order of orders) {
      const orderTotal = order.total || 0;
      const shippingFee = order.shippingFee || 0;
      const orderFee = (order as any).fee || 0;

      // Exclude customer collected shipping fee and transaction charges to get pure Net Sales (standard way)
      const orderNetSale = orderTotal - shippingFee - orderFee;
      totalRevenue += orderNetSale;
      totalDiscounts += (order.couponDiscount || 0) + (order.promotionDiscount || 0);
      totalShippingRevenue += shippingFee;

      for (const item of order.items || []) {
        const product = await productRepository.findById(item.itemId);
        totalCOGS += (product?.buyingPrice || 0) * item.quantity;
      }
    }

    // Fetch expenses
    const expenses = await reportRepository.findExpensesForReport({
      start,
      end,
      type: "expense",
      status: "APPROVED",
    });

    const totalOperatingExpenses = expenses.reduce(
      (sum, e) => sum + (e.amount || 0),
      0,
    );

    const grossProfit = totalRevenue - totalCOGS;
    const netProfit = grossProfit - totalOperatingExpenses;

    return {
      revenue: totalRevenue,
      cogs: totalCOGS,
      grossProfit,
      operatingExpenses: totalOperatingExpenses,
      netProfit,
      metrics: {
        grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
        netMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
      },
    };
  } catch (error: any) {
    console.error("[ReportService] Profit/Loss error:", error);
    throw error;
  }
};

export const getSalesPerformanceReport = async (
  from: string,
  to: string,
  groupBy: "day" | "week" | "month" = "day",
) => {
  try {
    const data = await reportRepository.findOrdersForAnalysis({
      start: from ? new Date(from) : new Date(0),
      end: to ? new Date(to) : new Date(),
      paymentStatus: "Paid",
    });

    const performanceMap: Record<string, any> = {};

    data.forEach((order) => {
      const date = parseToDayjs(order.createdAt)?.tz(SL_TZ);
      let key: string;

      if (groupBy === "month") {
        key = date.format("YYYY-MM");
      } else if (groupBy === "week") {
        key = date.startOf("week").format("YYYY-MM-DD");
      } else {
        key = date.format("YYYY-MM-DD");
      }

      if (!performanceMap[key]) {
        performanceMap[key] = {
          date: key,
          orders: 0,
          sales: 0,
          items: 0,
        };
      }

      const orderTotal = order.total || 0;
      const shippingFee = order.shippingFee || 0;
      const orderFee = (order as any).fee || 0;
      const netSale = orderTotal - shippingFee - orderFee;

      performanceMap[key].orders += 1;
      performanceMap[key].sales += netSale;
      performanceMap[key].items +=
        order.items?.reduce((s: any, i: any) => s + i.quantity, 0) || 0;
    });

    return Object.values(performanceMap).sort((a: any, b: any) =>
      a.date.localeCompare(b.date),
    );
  } catch (error: any) {
    console.error("[ReportService] Sales performance error:", error);
    throw error;
  }
};

export interface LowStockItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  size: string;
  stockId: string;
  stockName: string;
  quantity: number;
  minStock: number;
  buyingPrice: number;
  valuation: number;
}

export const getLowStockReport = async (
  stockId: string = "all",
  threshold: number = 10,
): Promise<{
  data: LowStockItem[];
  total: number;
  summary: {
    totalProducts: number;
    totalQuantity: number;
    totalValuation: number;
  };
}> => {
  try {
    // Fetch inventory
    const inventoryDocs = await reportRepository.findStockInventory({ 
      stockId: stockId === "all" ? undefined : stockId,
      quantityThreshold: threshold 
    });
    const total = inventoryDocs.length;

    const stockList: LowStockItem[] = [];

    // Collect IDs
    const productIds = Array.from(new Set(inventoryDocs.map((d) => d.productId)));
    const stockIds = Array.from(new Set(inventoryDocs.map((d) => d.stockId)));

    // Fetch products and stocks in batches
    const products = await reportRepository.findDocsInBatch("products", "productId", productIds);
    const productMap: Record<string, any> = {};
    products.forEach((p) => (productMap[p.productId] = p));

    const stocks = await reportRepository.findDocsInBatch("stocks", "id", stockIds);
    const stockMap: Record<string, any> = {};
    stocks.forEach((s) => (stockMap[s.id] = s));

    let totalQuantity = 0;
    let totalValuation = 0;

    inventoryDocs.forEach((data) => {
      const product = productMap[data.productId];
      const stock = stockMap[data.stockId];

      const variant =
        product?.variants?.find((v: any) => v.variantId === data.variantId) ||
        {};
      const buyingPrice = product?.buyingPrice || 0;
      const valuation = buyingPrice * (data.quantity || 0);

      totalQuantity += data.quantity || 0;
      totalValuation += valuation;

      stockList.push({
        id: data.id,
        productId: data.productId,
        productName: product?.name || "",
        variantId: data.variantId,
        variantName: variant?.variantName || data.variantName || "",
        size: data.size,
        stockId: data.stockId,
        stockName: stock?.name || "",
        quantity: data.quantity || 0,
        minStock: product?.minStock || 0,
        buyingPrice,
        valuation,
      });
    });

    return {
      data: stockList,
      total,
      summary: {
        totalProducts: Array.from(new Set(stockList.map((i) => i.productId))).length,
        totalQuantity,
        totalValuation,
      },
    };
  } catch (error: any) {
    console.error("[ReportService] Low stock report error:", error);
    throw error;
  }
};

export interface StockValuationItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  size: string;
  stockId: string;
  stockName: string;
  quantity: number;
  buyingPrice: number;
  valuation: number;
}

export const getStockValuationReport = async (
  stockId: string = "all",
): Promise<{
  data: StockValuationItem[];
  total: number;
  summary: {
    totalQuantity: number;
    totalValuation: number;
  };
}> => {
  try {
    const inventoryDocs = await reportRepository.findStockInventory({ 
      stockId: stockId === "all" ? undefined : stockId 
    });
    const total = inventoryDocs.length;

    const productIds = Array.from(new Set(inventoryDocs.map((d) => d.productId)));
    const stockIds = Array.from(new Set(inventoryDocs.map((d) => d.stockId)));

    const products = await reportRepository.findDocsInBatch("products", "productId", productIds);
    const productMap: Record<string, any> = {};
    products.forEach((p) => (productMap[p.productId] = p));

    const stocks = await reportRepository.findDocsInBatch("stocks", "id", stockIds);
    const stockMap: Record<string, any> = {};
    stocks.forEach((s) => (stockMap[s.id] = s));

    let totalQuantity = 0;
    let totalValuation = 0;

    const stockList: StockValuationItem[] = inventoryDocs.map((data) => {
      const product = productMap[data.productId];
      const stockData = stockMap[data.stockId];
      const variant =
        product?.variants?.find((v: any) => v.variantId === data.variantId) ||
        {};
      const buyingPrice = product?.buyingPrice || 0;
      const valuation = buyingPrice * (data.quantity || 0);

      totalQuantity += data.quantity || 0;
      totalValuation += valuation;

      return {
        id: data.id,
        productId: data.productId,
        productName: product?.name || "",
        variantId: data.variantId,
        variantName: variant?.variantName || data.variantName || "",
        size: data.size,
        stockId: data.stockId,
        stockName: stockData?.name || "",
        quantity: data.quantity || 0,
        buyingPrice,
        valuation,
      };
    });

    return {
      data: stockList,
      total,
      summary: {
        totalQuantity,
        totalValuation,
      },
    };
  } catch (error: any) {
    console.error("[ReportService] Stock valuation report error:", error);
    throw error;
  }
};

export const getCustomerLoyaltyReport = async (
  minOrders: number = 3,
  status: string = "Paid",
) => {
  try {
    const cutoff = dayjs().subtract(1, "year").toDate();
    const orders = await reportRepository.findHistoricalOrders(cutoff, [status]);

    const customerMap: Record<string, any> = {};

    orders.forEach((order) => {
      const userId = order.userId;
      if (!userId) return;

      if (!customerMap[userId]) {
        customerMap[userId] = {
          userId,
          orderCount: 0,
          totalSpent: 0,
          lastOrderDate: order.createdAt.toDate(),
        };
      }

      customerMap[userId].orderCount += 1;
      customerMap[userId].totalSpent += order.total || 0;
      if (order.createdAt.toDate() > customerMap[userId].lastOrderDate) {
        customerMap[userId].lastOrderDate = order.createdAt.toDate();
      }
    });

    return Object.values(customerMap)
      .filter((c: any) => c.orderCount >= minOrders)
      .sort((a: any, b: any) => b.totalSpent - a.totalSpent);
  } catch (error: any) {
    console.error("[ReportService] Customer loyalty error:", error);
    throw error;
  }
};

export const getFinancialHealthReport = async (from: string, to: string) => {
  try {
    const start = parseToDayjs(from)?.toDate() || new Date(0);
    const end = parseToDayjs(to)?.toDate() || new Date();

    const orders = await reportRepository.findOrdersForAnalysis({
      start,
      end,
      paymentStatus: "Paid",
    });

    const expenses = await reportRepository.findExpensesForReport({
      start,
      end,
      type: "expense",
      status: "APPROVED",
    });

    // Calculate revenue
    let grossSales = 0;
    let netSales = 0;
    let totalDiscounts = 0;
    let totalTransactionFees = 0;
    let totalProductCost = 0;
    let totalOrderFee = 0;

    for (const order of orders) {
      const orderTotal = order.total || 0;
      const shippingFee = order.shippingFee || 0;
      const orderFee = (order as any).fee || 0;
      const discount = (order.discount || 0) + (order.couponDiscount || 0) + (order.promotionDiscount || 0);

      // Per order calculations
      const orderNetSale = orderTotal - shippingFee - orderFee;
      const orderGrossSale = orderNetSale + discount;

      netSales += orderNetSale;
      grossSales += orderGrossSale;
      totalDiscounts += discount;
      totalOrderFee += orderFee;

      for (const item of order.items || []) {
        const product = await productRepository.findById(item.itemId);
        totalProductCost += (product?.buyingPrice || 0) * item.quantity;
      }
    }

    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const grossProfit = netSales - totalProductCost;
    const netProfit = grossProfit - totalExpenses;

    return {
      revenue: {
        gross: grossSales,
        net: netSales,
        discounts: totalDiscounts,
        otherFees: totalOrderFee,
      },
      costs: {
        cogs: totalProductCost,
        expenses: totalExpenses,
      },
      profitability: {
        grossProfit,
        netProfit,
        grossMargin: netSales > 0 ? (grossProfit / netSales) * 100 : 0,
        netMargin: netSales > 0 ? (netProfit / netSales) * 100 : 0,
      },
    };
  } catch (error: any) {
    console.error("[ReportService] Financial health error:", error);
    throw error;
  }
};

/**
 * Get monthly summary report
 */
export const getMonthlySummary = async (from: string, to: string) => {
  return await getMonthlyRevenueReport(from, to);
};

/**
 * Get yearly summary report
 */
export const getYearlySummary = async (year: number) => {
  return await getYearlyRevenueReport(year);
};

/**
 * Get top selling products
 */
export const getTopSellingProducts = async (
  from: string,
  to: string,
  limit: number = 10,
) => {
  const start = parseToDayjs(from)?.toDate() || new Date(0);
  const end = parseToDayjs(to)?.toDate() || new Date();
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);

  const productMap = new Map<
    string,
    { name: string; quantity: number; revenue: number }
  >();

  orders.forEach((order) => {
    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item) => {
        const existing = productMap.get(item.itemId) || {
          name: item.name,
          quantity: 0,
          revenue: 0,
        };
        existing.quantity += item.quantity || 0;
        existing.revenue += (item.price || 0) * (item.quantity || 0);
        productMap.set(item.itemId, existing);
      });
    }
  });

  return Array.from(productMap.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
};

/**
 * Get sales vs discount comparison
 */
export const getSalesVsDiscount = async (
  from: string,
  to: string,
  groupBy: "day" | "month" = "day",
) => {
  const start = parseToDayjs(from)?.toDate() || new Date(0);
  const end = parseToDayjs(to)?.toDate() || new Date();
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);

  const groups = new Map<string, { sales: number; discount: number }>();

  orders.forEach((order) => {
    const date = parseToDayjs(order.createdAt);
    const key =
      groupBy === "day"
        ? dayjs(date).tz(SL_TZ).format("YYYY-MM-DD")
        : dayjs(date).tz(SL_TZ).format("YYYY-MM");

    const orderTotal = order.total || 0;
    const shippingFee = order.shippingFee || 0;
    const orderFee = (order as any).fee || 0;
    const netSale = orderTotal - shippingFee - orderFee;
    const discount = (order.discount || 0) + (order.couponDiscount || 0) + (order.promotionDiscount || 0);

    const existing = groups.get(key) || { sales: 0, discount: 0 };
    existing.sales += netSale;
    existing.discount += discount;
    groups.set(key, existing);
  });

  return Array.from(groups.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Get tax report summary
 */
export const getTaxReport = async (from: string, to: string) => {
  const start = parseToDayjs(from)?.toDate() || new Date(0);
  const end = parseToDayjs(to)?.toDate() || new Date();
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);

  let totalTax = 0;
  orders.forEach((o) => {
    totalTax += o.tax || 0;
  });

  return { totalTax, orderCount: orders.length };
};

/**
 * Fetch live stock data
 */
export const fetchLiveStock = async () => {
  return await reportRepository.findAllProducts();
};

/**
 * Fetch low stock alerts
 */
export const fetchLowStock = async (threshold: number = 5) => {
  return await productRepository.findLowStockAlerts(threshold);
};

/**
 * Fetch stock valuation
 */
export const fetchStockValuationByStock = async () => {
  const products = await reportRepository.findAllProducts();
  let totalValuation = 0;
  products.forEach((p) => {
    totalValuation += (p.buyingPrice || 0) * (p.totalStock || 0);
  });
  return { totalValuation };
};

/**
 * Get cash flow report with daily breakdown and summary
 */
export const getCashFlowReport = async (from: string, to: string) => {
  try {
    const start = parseToDayjs(from)?.tz(SL_TZ).startOf("day").toDate() || new Date(0);
    const end = parseToDayjs(to)?.tz(SL_TZ).endOf("day").toDate() || new Date();

    // Fetch data
    const orders = await orderRepository.findByStatusInDateRange(start, end, ["Paid", "PAID"]);
    const expenses = await reportRepository.findExpensesForReport({
      start,
      end,
      status: "APPROVED",
    });

    const dailyMap = new Map<string, any>();
    let currentDate = dayjs(from).tz(SL_TZ).startOf("day");
    const lastDate = dayjs(to).tz(SL_TZ).startOf("day");

    // Initialize daily map with all dates in range
    while (currentDate.isBefore(lastDate) || currentDate.isSame(lastDate, "day")) {
      const dateStr = currentDate.format("YYYY-MM-DD");
      dailyMap.set(dateStr, {
        date: dateStr,
        orders: 0,
        cashIn: 0,
        transactionFees: 0,
        expenses: 0,
        netCashFlow: 0,
      });
      currentDate = currentDate.add(1, "day");
    }

    // Aggregate orders
    orders.forEach((order) => {
      const dateStr = parseToDayjs(order.createdAt)?.tz(SL_TZ).format("YYYY-MM-DD");
      if (dateStr && dailyMap.has(dateStr)) {
        const day = dailyMap.get(dateStr)!;
        day.orders += 1;
        day.cashIn += order.total || 0;
        day.transactionFees += (order as any).fee || 0;
      }
    });

    // Aggregate expenses
    expenses.forEach((expense) => {
      const dateStr = parseToDayjs(expense.date)?.tz(SL_TZ).format("YYYY-MM-DD");
      if (dateStr && dailyMap.has(dateStr)) {
        const day = dailyMap.get(dateStr)!;
        day.expenses += expense.amount || 0;
      }
    });

    // Aggregate by method
    const methodMap = new Map<string, any>();
    orders.forEach((order) => {
      const method = order.paymentMethod || "Unknown";
      if (!methodMap.has(method)) {
        methodMap.set(method, { method, total: 0, fee: 0, orders: 0 });
      }
      const m = methodMap.get(method)!;
      m.total += order.total || 0;
      m.fee += (order as any).fee || 0;
      m.orders += 1;
    });

    // Calculate net cash flow per day and prepare result
    const daily = Array.from(dailyMap.values()).map((day) => ({
      ...day,
      netCashFlow: day.cashIn - day.transactionFees - day.expenses,
    }));

    // Calculate summary totals
    const summary = {
      totalOrders: daily.reduce((sum, d) => sum + d.orders, 0),
      totalCashIn: daily.reduce((sum, d) => sum + d.cashIn, 0),
      totalTransactionFees: daily.reduce((sum, d) => sum + d.transactionFees, 0),
      totalExpenses: daily.reduce((sum, d) => sum + d.expenses, 0),
      totalNetCashFlow: daily.reduce((sum, d) => sum + d.netCashFlow, 0),
      byMethod: Array.from(methodMap.values()),
      daily,
    };


    return { summary };
  } catch (error: any) {
    console.error("[ReportService] Cash flow report error:", error);
    throw error;
  }
};


/**
 * Get customer analytics
 */
export const getCustomerAnalytics = async () => {
  const products = await reportRepository.findAllProducts();
  return { totalProducts: products.length }; // Simplified stub
};

/**
 * Get expense report
 */
export const getExpenseReport = async (from: string, to: string) => {
  const start = new Date(from);
  const end = new Date(to);
  const expenses = await reportRepository.findExpensesForReport({ start, end });
  return formatListDates(expenses, ["date", "createdAt", "updatedAt"]);
};

/**
 * Get profit and loss statement
 */
export const getProfitLossStatement = async (from: string, to: string) => {
  return await getFinancialHealthReport(from, to);
};

/**
 * Get daily revenue report
 */
export const getDailyRevenueReport = async (from: string, to: string) => {
  return await getDailySaleReport(from, to);
};

/**
 * Get monthly revenue report
 */
export const getMonthlyRevenueReport = async (from: string, to: string) => {
  const start = new Date(from);
  const end = new Date(to);
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);
  return { total: orders.reduce((sum, o) => sum + (o.total || 0), 0) };
};

/**
 * Get yearly revenue report
 */
export const getYearlyRevenueReport = async (year: number) => {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);
  return { total: orders.reduce((sum, o) => sum + (o.total || 0), 0) };
};

/**
 * Get sales by brand
 */
export const getSalesByBrand = async (from: string, to: string) => {
  const start = new Date(from);
  const end = new Date(to);
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);
  const brandMap = new Map<string, number>();
  orders.forEach(o => {
    if (o.items) o.items.forEach((i: any) => {
      const brand = i.brandName || "Unknown";
      brandMap.set(brand, (brandMap.get(brand) || 0) + (i.price * i.quantity));
    });
  });
  return Array.from(brandMap.entries()).map(([name, value]) => ({ name, value }));
};

/**
 * Get sales by category
 */
export const getSalesByCategory = async (from: string, to: string) => {
  const start = new Date(from);
  const end = new Date(to);
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);
  const catMap = new Map<string, number>();
  orders.forEach(o => {
    if (o.items) o.items.forEach((i: any) => {
      const cat = i.categoryName || "Unknown";
      catMap.set(cat, (catMap.get(cat) || 0) + (i.price * i.quantity));
    });
  });
  return Array.from(catMap.entries()).map(([name, value]) => ({ name, value }));
};

/**
 * Get sales by payment method
 */
export const getSalesByPaymentMethod = async (from: string, to: string) => {
  const start = new Date(from);
  const end = new Date(to);
  const orders = await orderRepository.findPaidOrdersInDateRange(start, end);
  const methodMap = new Map<string, number>();
  orders.forEach(o => {
    const method = o.paymentMethod || "Unknown";
    methodMap.set(method, (methodMap.get(method) || 0) + (o.total || 0));
  });
  return Array.from(methodMap.entries()).map(([method, total]) => ({ method, total }));
};
/**
 * Get refunds and returns report
 */
export const getRefundsAndReturns = async (from?: string, to?: string) => {
  try {
    const start = from ? parseToDayjs(from)?.toDate() || new Date(0) : new Date(0);
    const end = to ? parseToDayjs(to)?.toDate() || new Date() : new Date();

    const orders = await reportRepository.findOrdersForAnalysis({
      start,
      end,
      paymentStatus: ["Refunded", "REFUNDED", "Returned", "RETURNED", "Partially Refunded"],
    });

    const summary = {
      totalRefunded: 0,
      totalOrders: orders.length,
      refundByMethod: {} as Record<string, number>,
    };

    orders.forEach((order) => {
      summary.totalRefunded += order.total || 0;
      const method = order.paymentMethod || "Unknown";
      summary.refundByMethod[method] = (summary.refundByMethod[method] || 0) + (order.total || 0);
    });

    return {
      summary,
      data: formatListDates(orders, ["createdAt", "updatedAt"]),
    };
  } catch (error: any) {
    console.error("[ReportService] Refunds and returns error:", error);
    throw error;
  }
};

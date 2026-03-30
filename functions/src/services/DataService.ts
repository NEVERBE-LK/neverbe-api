import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const COLLECTION_ORDERS = "orders";
const COLLECTION_PRODUCTS = "products";
const COLLECTION_INVENTORY = "stock_inventory";

// --- Types ---
export interface DashboardSnapshot {
  totalOrders: number;
  totalNetSales: number;
  totalGrossSales: number;
}

export interface MonthlyComparison {
  currentMonth: { orders: number; revenue: number; profit: number };
  lastMonth: { orders: number; revenue: number; profit: number };
  percentageChange: { orders: number; revenue: number; profit: number };
}

export interface HistoricalPoint {
  date: string;
  netSales: number;
}

// --- Implementation ---

const getSalesByRange = async (start: Date, end: Date) => {
  const snapshot = await admin.firestore()
    .collection(COLLECTION_ORDERS)
    .where("createdAt", ">=", Timestamp.fromDate(start))
    .where("createdAt", "<=", Timestamp.fromDate(end))
    .where("paymentStatus", "not-in", ["Failed", "Refunded"])
    .get();

  let totalOrders = 0;
  let totalNetSales = 0;
  let totalGrossSales = 0;
  let totalCOGS = 0;

  snapshot.docs.forEach((doc) => {
    const order = doc.data();
    totalOrders++;
    const total = order.total || 0;
    const fee = order.fee || 0;
    const discount = order.discount || 0;
    
    totalNetSales += (total - fee);
    totalGrossSales += (total + discount - fee);
    
    if (Array.isArray(order.items)) {
       order.items.forEach((item: any) => {
         totalCOGS += (item.bPrice || 0) * (item.quantity || 0);
       });
    }
  });

  return { totalOrders, totalNetSales, totalGrossSales, totalCOGS };
};

export const getDailySnapshot = async (): Promise<DashboardSnapshot> => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return getSalesByRange(start, end);
};

export const getMonthlyComparison = async (): Promise<MonthlyComparison> => {
  const now = new Date();
  const cStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const cEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  const lStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [current, last] = await Promise.all([
    getSalesByRange(cStart, cEnd),
    getSalesByRange(lStart, lEnd)
  ]);

  const calcChange = (c: number, l: number) => l === 0 ? (c > 0 ? 100 : 0) : Math.round(((c - l) / l) * 100);

  return {
    currentMonth: { orders: current.totalOrders, revenue: current.totalNetSales, profit: current.totalNetSales - current.totalCOGS },
    lastMonth: { orders: last.totalOrders, revenue: last.totalNetSales, profit: last.totalNetSales - last.totalCOGS },
    percentageChange: {
      orders: calcChange(current.totalOrders, last.totalOrders),
      revenue: calcChange(current.totalNetSales, last.totalNetSales),
      profit: calcChange(current.totalNetSales - current.totalCOGS, last.totalNetSales - last.totalCOGS)
    }
  };
};

export const getLowStockRisks = async (threshold = 10) => {
  const snap = await admin.firestore()
    .collection(COLLECTION_INVENTORY)
    .where("quantity", "<=", threshold)
    .where("quantity", ">", 0)
    .limit(10)
    .get();

  const productIds = Array.from(new Set(snap.docs.map(d => d.data().productId)));
  const productDocs = await Promise.all(productIds.map(id => admin.firestore().collection(COLLECTION_PRODUCTS).doc(id).get()));
  const nameMap = new Map(productDocs.map(d => [d.id, d.data()?.name || "Unknown"]));

  return snap.docs.map(d => ({
    name: nameMap.get(d.data().productId),
    stock: d.data().quantity
  }));
};

export const getPopularItems = async (limit = 5) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const snap = await admin.firestore()
    .collection(COLLECTION_ORDERS)
    .where("paymentStatus", "==", "Paid")
    .where("createdAt", ">=", Timestamp.fromDate(start))
    .get();

  const counts: Record<string, number> = {};
  const names: Record<string, string> = {};

  snap.docs.forEach(doc => {
    const order = doc.data();
    if (order.items) {
      order.items.forEach((i: any) => {
        counts[i.itemId] = (counts[i.itemId] || 0) + i.quantity;
        names[i.itemId] = i.name;
      });
    }
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, sold]) => ({ name: names[id], sold }));
};

export const getHistoricalSales = async (days?: number): Promise<HistoricalPoint[]> => {
  let query = admin.firestore()
    .collection(COLLECTION_ORDERS)
    .where("paymentStatus", "==", "Paid");

  const lookback = days && days > 0 ? days : 365;
  const start = new Date();
  start.setDate(start.getDate() - lookback);
  query = query.where("createdAt", ">=", Timestamp.fromDate(start));
  
  const snap = await query.orderBy("createdAt", "asc").get();

  const dailyMap: Record<string, number> = {};
  snap.docs.forEach(doc => {
    const order = doc.data();
    const date = order.createdAt.toDate().toISOString().split("T")[0];
    dailyMap[date] = (dailyMap[date] || 0) + (order.total - (order.fee || 0));
  });

  return Object.entries(dailyMap).map(([date, netSales]) => ({ date, netSales }));
};
export const getNeuralStockRisks = async (daysToForecast = 14) => {
  const inventorySnap = await admin.firestore()
    .collection(COLLECTION_INVENTORY)
    .where("quantity", ">", 0)
    .get();

  const productIds = inventorySnap.docs.map(d => d.data().productId);
  const productsSnap = await Promise.all(
    productIds.map(id => admin.firestore().collection(COLLECTION_PRODUCTS).doc(id).get())
  );
  
  const productInfo = new Map(productsSnap.map(d => [d.id, d.data()]));

  // Calculate 30-day velocity for each product
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const ordersSnap = await admin.firestore()
    .collection(COLLECTION_ORDERS)
    .where("paymentStatus", "==", "Paid")
    .where("createdAt", ">=", Timestamp.fromDate(thirtyDaysAgo))
    .get();

  const velocityMap: Record<string, number> = {};
  ordersSnap.docs.forEach(doc => {
    const order = doc.data();
    if (order.items) {
      order.items.forEach((item: any) => {
        velocityMap[item.itemId] = (velocityMap[item.itemId] || 0) + (item.quantity / 30);
      });
    }
  });

  const risks: any[] = [];
  inventorySnap.docs.forEach(doc => {
    const data = doc.data();
    const velocity = velocityMap[data.productId] || 0;
    const currentStock = data.quantity || 0;
    const projectedDemand = velocity * daysToForecast;

    if (velocity > 0 && currentStock < projectedDemand) {
      const pData = productInfo.get(data.productId);
      risks.push({
        productId: data.productId,
        name: pData?.name || "Unknown Product",
        currentStock,
        projectedDemand: Math.ceil(projectedDemand),
        riskLevel: currentStock < (projectedDemand / 2) ? "CRITICAL" : "HIGH",
        daysRemaining: Math.floor(currentStock / velocity)
      });
    }
  });

  return risks.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 10);
};

import { adminFirestore } from "@/firebase/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";
import { toSafeLocaleString } from "./UtilService";
import { Order } from "@/model/Order";
import { OrderItem } from "@/model/OrderItem";
import { searchStockInventory } from "./AlgoliaService";
import dayjs from "dayjs";

export const getDailySaleReport = async (
  from: string,
  to: string,
  status: string = "Paid",
) => {
  try {
    let query = adminFirestore.collection("orders") as any;

    if (status !== "all") {
      if (status.toLowerCase() === "paid") {
        query = query.where("paymentStatus", "in", ["Paid", "PAID"]);
      } else {
        query = query.where("paymentStatus", "==", status);
      }
    }

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<=", Timestamp.fromDate(end));
    }

    query = query.orderBy("createdAt", "desc");

    const snap = await query.get();

    const orders: any[] = snap.docs.map((d) => ({
      orderId: d.id,
      ...d.data(),
      createdAt: toSafeLocaleString(d.data().createdAt),
      updatedAt: toSafeLocaleString(d.data().updatedAt),
    }));

    const getNetSale = (o: any) =>
      (o.total || 0) - (o.transactionFeeCharge || 0);
    const getSales = (o: any) => (o.total || 0) + (o.discount || 0);
    const getCOGS = (o: any) =>
      o.items.reduce(
        (c: number, i: any) => c + (i.bPrice || 0) * i.quantity,
        0,
      );

    // ---------- MAIN SUMMARY ----------
    const totalOrders = orders.length;
    const totalSales = orders.reduce((s, o) => s + getSales(o), 0);
    const totalNetSales = orders.reduce((s, o) => s + getNetSale(o), 0);
    const totalCOGS = orders.reduce((s, o) => s + getCOGS(o), 0);
    const totalGrossProfit = totalNetSales - totalCOGS;

    // New Metrics
    const totalGrossProfitMargin =
      totalNetSales > 0 ? (totalGrossProfit / totalNetSales) * 100 : 0;
    const averageOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;

    const totalShipping = orders.reduce((s, o) => s + (o.shippingFee || 0), 0);
    const totalDiscount = orders.reduce((s, o) => s + (o.discount || 0), 0);
    const totalTransactionFee = orders.reduce(
      (s, o) => s + (o.transactionFeeCharge || 0),
      0,
    );
    const totalItemsSold = orders.reduce(
      (count, o) => count + o.items.reduce((c, i) => c + i.quantity, 0),
      0,
    );
    const totalCouponDiscount = orders.reduce(
      (s, o) => s + (o.couponDiscount || 0),
      0,
    );
    const totalPromotionDiscount = orders.reduce(
      (s, o) => s + (o.promotionDiscount || 0),
      0,
    );

    // Combo Metrics
    const comboItemsSold = orders.reduce(
      (count, o) =>
        count +
        o.items
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + i.quantity, 0),
      0,
    );
    const comboSales = orders.reduce(
      (s, o) =>
        s +
        o.items
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.price || 0) * i.quantity, 0),
      0,
    );
    const comboCOGS = orders.reduce(
      (s, o) =>
        s +
        o.items
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.bPrice || 0) * i.quantity, 0),
      0,
    );
    const comboDiscount = orders.reduce(
      (s, o) =>
        s +
        o.items
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.discount || 0), 0),
      0,
    );
    const ordersWithCombos = orders.filter((o) =>
      o.items.some((i: any) => i.isComboItem === true),
    ).length;

    // ---------- DAILY SUMMARY ----------
    const dailyMap: Record<
      string,
      {
        date: string;
        orders: number;
        sales: number;
        netSales: number;
        cogs: number;
        grossProfit: number;
        grossProfitMargin: number;
        averageOrderValue: number;
        shipping: number;
        discount: number;
        transactionFee: number;
        itemsSold: number;
      }
    > = {};

    orders.forEach((o) => {
      const dateKey = o.createdAt.split(" ")[0]; // “YYYY-MM-DD”

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          orders: 0,
          sales: 0,
          netSales: 0,
          cogs: 0,
          grossProfit: 0,
          grossProfitMargin: 0,
          averageOrderValue: 0,
          shipping: 0,
          discount: 0,
          transactionFee: 0,
          itemsSold: 0,
        };
      }

      dailyMap[dateKey].orders += 1;

      // FIXED: deduct shipping from sales
      dailyMap[dateKey].sales += getSales(o);
      dailyMap[dateKey].netSales += getNetSale(o);
      dailyMap[dateKey].cogs += getCOGS(o);
      dailyMap[dateKey].grossProfit += getNetSale(o) - getCOGS(o);

      dailyMap[dateKey].shipping += o.shippingFee || 0;
      dailyMap[dateKey].discount += o.discount || 0;
      dailyMap[dateKey].transactionFee += o.transactionFeeCharge || 0;
      dailyMap[dateKey].itemsSold += o.items.reduce(
        (c, i) => c + i.quantity,
        0,
      );
    });

    // Calculate margins for each day
    Object.values(dailyMap).forEach((d) => {
      d.grossProfitMargin =
        d.netSales > 0 ? (d.grossProfit / d.netSales) * 100 : 0;
      d.averageOrderValue = d.orders > 0 ? d.netSales / d.orders : 0;
    });

    const daily = Object.values(dailyMap).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return {
      summary: {
        totalOrders,
        totalSales,
        totalNetSales,
        totalCOGS,
        totalGrossProfit,
        totalShipping,
        totalDiscount,
        totalCouponDiscount,
        totalPromotionDiscount,
        totalTransactionFee,
        totalItemsSold,
        // Combo metrics
        comboItemsSold,
        comboSales,
        comboCOGS,
        comboDiscount,
        ordersWithCombos,
        daily,
        from,
        to,
      },
    };
  } catch (error) {
    console.log("Sale report error:", error);
    throw error;
  }
};

export const getMonthlySummary = async (
  from: string,
  to: string,
  status: string = "Paid",
) => {
  try {
    let query = adminFirestore.collection("orders") as any;

    if (status !== "all") {
      if (status.toLowerCase() === "paid") {
        query = query.where("paymentStatus", "in", ["Paid", "PAID"]);
      } else {
        query = query.where("paymentStatus", "==", status);
      }
    }

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<=", Timestamp.fromDate(end));
    }

    query = query.orderBy("createdAt", "asc");
    const snap = await query.get();

    const orders: any[] = snap.docs.map((d) => ({
      orderId: d.id,
      ...d.data(),
      createdAt: d.data().createdAt.toDate(),
    }));

    const getNetSales = (o: any) =>
      (o.total || 0) - (o.transactionFeeCharge || 0);
    const getSales = (o: any) => (o.total || 0) + (o.discount || 0);
    const getCOGS = (o: any) =>
      (o.items || []).reduce(
        (c: number, i: any) => c + (i.bPrice || 0) * i.quantity,
        0,
      );

    // ---------- MAIN SUMMARY ----------
    const totalOrders = orders.length;
    const totalSales = orders.reduce((s, o) => s + getSales(o), 0); // FIXED
    const totalNetSales = orders.reduce((s, o) => s + getNetSales(o), 0);
    const totalCOGS = orders.reduce((s, o) => s + getCOGS(o), 0);
    const totalGrossProfit = totalNetSales - totalCOGS;

    // New Metrics
    const totalGrossProfitMargin =
      totalNetSales > 0 ? (totalGrossProfit / totalNetSales) * 100 : 0;
    const averageOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;

    const totalShipping = orders.reduce((s, o) => s + (o.shippingFee || 0), 0);
    const totalDiscount = orders.reduce((s, o) => s + (o.discount || 0), 0);
    const totalTransactionFee = orders.reduce(
      (s, o) => s + (o.transactionFeeCharge || 0),
      0,
    );
    const totalItemsSold = orders.reduce(
      (count, o) => count + (o.items?.reduce((c, i) => c + i.quantity, 0) || 0),
      0,
    );
    const totalCouponDiscount = orders.reduce(
      (s, o) => s + (o.couponDiscount || 0),
      0,
    );
    const totalPromotionDiscount = orders.reduce(
      (s, o) => s + (o.promotionDiscount || 0),
      0,
    );

    // Combo Metrics
    const comboItemsSold = orders.reduce(
      (count, o) =>
        count +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + i.quantity, 0),
      0,
    );
    const comboSales = orders.reduce(
      (s, o) =>
        s +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.price || 0) * i.quantity, 0),
      0,
    );
    const comboCOGS = orders.reduce(
      (s, o) =>
        s +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.bPrice || 0) * i.quantity, 0),
      0,
    );
    const comboDiscount = orders.reduce(
      (s, o) =>
        s +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.discount || 0), 0),
      0,
    );
    const ordersWithCombos = orders.filter((o) =>
      (o.items || []).some((i: any) => i.isComboItem === true),
    ).length;

    // ---------- MONTHLY SUMMARY ----------
    const monthlyMap: Record<
      string,
      {
        month: string;
        orders: number;
        sales: number;
        netSales: number;
        cogs: number;
        grossProfit: number;
        grossProfitMargin: number;
        averageOrderValue: number;
        shipping: number;
        discount: number;
        transactionFee: number;
        itemsSold: number;
      }
    > = {};

    orders.forEach((o) => {
      const date = o.createdAt as Date;
      if (!date || isNaN(date.getTime())) return;

      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}`;

      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = {
          month: monthKey,
          orders: 0,
          sales: 0,
          netSales: 0,
          cogs: 0,
          grossProfit: 0,
          grossProfitMargin: 0,
          averageOrderValue: 0,
          shipping: 0,
          discount: 0,
          transactionFee: 0,
          itemsSold: 0,
        };
      }

      monthlyMap[monthKey].orders += 1;

      // FIXED: subtract shipping from sales
      monthlyMap[monthKey].sales += getSales(o);
      monthlyMap[monthKey].netSales += getNetSales(o);
      monthlyMap[monthKey].cogs += getCOGS(o);
      monthlyMap[monthKey].grossProfit += getNetSales(o) - getCOGS(o);

      monthlyMap[monthKey].shipping += o.shippingFee || 0;
      monthlyMap[monthKey].discount += o.discount || 0;
      monthlyMap[monthKey].transactionFee += o.transactionFeeCharge || 0;
      monthlyMap[monthKey].itemsSold +=
        o.items?.reduce((c, i) => c + i.quantity, 0) || 0;
    });

    // Calculate margins for each month
    Object.values(monthlyMap).forEach((m) => {
      m.grossProfitMargin =
        m.netSales > 0 ? (m.grossProfit / m.netSales) * 100 : 0;
      m.averageOrderValue = m.orders > 0 ? m.netSales / m.orders : 0;
    });

    const monthly = Object.values(monthlyMap).sort(
      (a, b) =>
        new Date(a.month + "-01").getTime() -
        new Date(b.month + "-01").getTime(),
    );

    return {
      summary: {
        totalOrders,
        totalSales,
        totalNetSales,
        totalCOGS,
        totalGrossProfit,
        totalGrossProfitMargin,
        averageOrderValue,
        totalShipping,
        totalDiscount,
        totalCouponDiscount,
        totalPromotionDiscount,
        totalTransactionFee,
        totalItemsSold,
        // Combo metrics
        comboItemsSold,
        comboSales,
        comboCOGS,
        comboDiscount,
        ordersWithCombos,
        monthly,
        from,
        to,
      },
    };
  } catch (error) {
    console.error("Monthly Summary error:", error);
    throw error;
  }
};

export const getYearlySummary = async (
  from: string,
  to: string,
  status: string = "Paid",
) => {
  try {
    let query = adminFirestore.collection("orders") as any;

    if (status !== "all") {
      if (status.toLowerCase() === "paid") {
        query = query.where("paymentStatus", "in", ["Paid", "PAID"]);
      } else {
        query = query.where("paymentStatus", "==", status);
      }
    }

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<=", Timestamp.fromDate(end));
    }

    query = query.orderBy("createdAt", "asc");
    const snap = await query.get();

    const orders: any[] = snap.docs.map((d) => ({
      orderId: d.id,
      ...d.data(),
      createdAt: d.data().createdAt.toDate(),
    }));

    /// Gross sales = total - shipping + discount
    const getNetSales = (o: any) =>
      (o.total || 0) - (o.transactionFeeCharge || 0);
    const getSales = (o: any) => (o.total || 0) + (o.discount || 0);
    const getCOGS = (o: any) =>
      (o.items || []).reduce(
        (c: number, i: any) => c + (i.bPrice || 0) * i.quantity,
        0,
      );

    // ---------- MAIN SUMMARY ----------
    const totalOrders = orders.length;
    const totalSales = orders.reduce((s, o) => s + getSales(o), 0);
    const totalNetSales = orders.reduce((s, o) => s + getNetSales(o), 0);
    const totalCOGS = orders.reduce((s, o) => s + getCOGS(o), 0);
    const totalGrossProfit = totalNetSales - totalCOGS;

    // New Metrics
    const totalGrossProfitMargin =
      totalNetSales > 0 ? (totalGrossProfit / totalNetSales) * 100 : 0;
    const averageOrderValue = totalOrders > 0 ? totalNetSales / totalOrders : 0;

    const totalShipping = orders.reduce((s, o) => s + (o.shippingFee || 0), 0);
    const totalDiscount = orders.reduce((s, o) => s + (o.discount || 0), 0);
    const totalTransactionFee = orders.reduce(
      (s, o) => s + (o.transactionFeeCharge || 0),
      0,
    );
    const totalItemsSold = orders.reduce(
      (count, o) => count + (o.items?.reduce((c, i) => c + i.quantity, 0) || 0),
      0,
    );
    const totalCouponDiscount = orders.reduce(
      (s, o) => s + (o.couponDiscount || 0),
      0,
    );
    const totalPromotionDiscount = orders.reduce(
      (s, o) => s + (o.promotionDiscount || 0),
      0,
    );

    // Combo Metrics
    const comboItemsSold = orders.reduce(
      (count, o) =>
        count +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + i.quantity, 0),
      0,
    );
    const comboSales = orders.reduce(
      (s, o) =>
        s +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.price || 0) * i.quantity, 0),
      0,
    );
    const comboCOGS = orders.reduce(
      (s, o) =>
        s +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.bPrice || 0) * i.quantity, 0),
      0,
    );
    const comboDiscount = orders.reduce(
      (s, o) =>
        s +
        (o.items || [])
          .filter((i: any) => i.isComboItem === true)
          .reduce((c: number, i: any) => c + (i.discount || 0), 0),
      0,
    );
    const ordersWithCombos = orders.filter((o) =>
      (o.items || []).some((i: any) => i.isComboItem === true),
    ).length;

    // ---------- YEARLY SUMMARY ----------
    const yearlyMap: Record<
      string,
      {
        year: string;
        orders: number;
        sales: number;
        netSales: number;
        cogs: number;
        grossProfit: number;
        grossProfitMargin: number;
        averageOrderValue: number;
        shipping: number;
        discount: number;
        transactionFee: number;
        itemsSold: number;
        monthly: {
          month: string;
          orders: number;
          sales: number;
          netSales: number;
          cogs: number;
          grossProfit: number;
          grossProfitMargin: number;
          averageOrderValue: number;
          shipping: number;
          discount: number;
          transactionFee: number;
          itemsSold: number;
        }[];
      }
    > = {};

    orders.forEach((o) => {
      const date = o.createdAt as Date;
      if (!date || isNaN(date.getTime())) return;

      const yearKey = `${date.getFullYear()}`;
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}`;

      if (!yearlyMap[yearKey]) {
        yearlyMap[yearKey] = {
          year: yearKey,
          orders: 0,
          sales: 0,
          netSales: 0,
          cogs: 0,
          grossProfit: 0,
          grossProfitMargin: 0,
          averageOrderValue: 0,
          shipping: 0,
          discount: 0,
          transactionFee: 0,
          itemsSold: 0,
          monthly: [],
        };
      }

      // ---- YEARLY TOTALS (FIXED) ----
      yearlyMap[yearKey].orders += 1;
      yearlyMap[yearKey].sales += getSales(o);
      yearlyMap[yearKey].netSales += getNetSales(o);
      yearlyMap[yearKey].cogs += getCOGS(o);
      yearlyMap[yearKey].grossProfit += getNetSales(o) - getCOGS(o);

      yearlyMap[yearKey].shipping += o.shippingFee || 0;
      yearlyMap[yearKey].discount += o.discount || 0;
      yearlyMap[yearKey].transactionFee += o.transactionFeeCharge || 0;
      yearlyMap[yearKey].itemsSold +=
        o.items?.reduce((c, i) => c + i.quantity, 0) || 0;

      // ---- MONTHLY TOTALS (INSIDE YEAR — FIXED) ----
      const monthlyIndex = yearlyMap[yearKey].monthly.findIndex(
        (m) => m.month === monthKey,
      );

      if (monthlyIndex === -1) {
        yearlyMap[yearKey].monthly.push({
          month: monthKey,
          orders: 1,
          sales: getSales(o),
          netSales: getNetSales(o),
          cogs: getCOGS(o),
          grossProfit: getNetSales(o) - getCOGS(o),
          grossProfitMargin: 0, // Calculated later
          averageOrderValue: 0, // Calculated later
          shipping: o.shippingFee || 0,
          discount: o.discount || 0,
          transactionFee: o.transactionFeeCharge || 0,
          itemsSold: o.items?.reduce((c, i) => c + i.quantity, 0) || 0,
        });
      } else {
        const m = yearlyMap[yearKey].monthly[monthlyIndex];
        m.orders += 1;
        m.sales += getSales(o);
        m.netSales += getNetSales(o);
        m.cogs += getCOGS(o);
        m.grossProfit += getNetSales(o) - getCOGS(o);
        m.shipping += o.shippingFee || 0;
        m.discount += o.discount || 0;
        m.transactionFee += o.transactionFeeCharge || 0;
        m.itemsSold += o.items?.reduce((c, i) => c + i.quantity, 0) || 0;
      }
    });

    // Calculate margins for years and months
    Object.values(yearlyMap).forEach((y) => {
      y.grossProfitMargin =
        y.netSales > 0 ? (y.grossProfit / y.netSales) * 100 : 0;
      y.averageOrderValue = y.orders > 0 ? y.netSales / y.orders : 0;

      y.monthly.forEach((m) => {
        m.grossProfitMargin =
          m.netSales > 0 ? (m.grossProfit / m.netSales) * 100 : 0;
        m.averageOrderValue = m.orders > 0 ? m.netSales / m.orders : 0;
      });
    });

    // Sort years
    const yearly = Object.values(yearlyMap).sort(
      (a, b) => parseInt(a.year) - parseInt(b.year),
    );

    // Sort months inside each year
    yearly.forEach((y) => {
      y.monthly.sort(
        (a, b) =>
          new Date(a.month + "-01").getTime() -
          new Date(b.month + "-01").getTime(),
      );
    });

    return {
      summary: {
        totalOrders,
        totalSales,
        totalNetSales,
        totalCOGS,
        totalGrossProfit,
        totalShipping,
        totalDiscount,
        totalCouponDiscount,
        totalPromotionDiscount,
        totalTransactionFee,
        totalItemsSold,
        // Combo metrics
        comboItemsSold,
        comboSales,
        comboCOGS,
        comboDiscount,
        ordersWithCombos,
        yearly,
        from,
        to,
      },
    };
  } catch (error) {
    console.error("Yearly Summary error:", error);
    throw error;
  }
};

export const getTopSellingProducts = async (
  from?: string,
  to?: string,
  threshold?: number,
  status: string = "Paid",
) => {
  try {
    let query = adminFirestore.collection("orders") as any;

    if (status !== "all") {
      if (status.toLowerCase() === "paid") {
        query = query.where("paymentStatus", "in", ["Paid", "PAID"]);
      } else {
        query = query.where("paymentStatus", "==", status);
      }
    }

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      query = query
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<=", Timestamp.fromDate(end));
    }

    query.limit(threshold || 10);
    const snap = await query.get();
    const productMap: Record<string, any> = {};

    snap.docs.forEach((doc) => {
      const order: any = doc.data();
      const orderItems = order.items || [];
      const orderGrossSales = orderItems.reduce(
        (sum: number, i: any) => sum + (i.price || 0) * i.quantity,
        0,
      );
      const orderLevelDiscount =
        (order.couponDiscount || 0) + (order.promotionDiscount || 0);

      orderItems.forEach((item: any) => {
        const key = item.itemId + (item.variantId || "");

        if (!productMap[key]) {
          productMap[key] = {
            productId: item.itemId,
            variantId: item.variantId,
            name: item.name,
            variantName: item.variantName,
            totalQuantity: 0,
            totalSales: 0,
            totalNetSales: 0,
            totalCOGS: 0,
            totalGrossProfit: 0,
            totalDiscount: 0,
          };
        }

        const getSales = (item.price || 0) * item.quantity;
        const itemShare = orderGrossSales > 0 ? getSales / orderGrossSales : 0;
        const allocatedDiscount = orderLevelDiscount * itemShare;

        const getCOGS = (item.bPrice || 0) * item.quantity;
        const totalNetSales =
          getSales - (item.discount || 0) - allocatedDiscount;
        const totalGrossProfit = totalNetSales - getCOGS;

        productMap[key].totalQuantity += item.quantity;
        productMap[key].totalSales += getSales;
        productMap[key].totalNetSales += totalNetSales;
        productMap[key].totalCOGS += getCOGS;
        productMap[key].totalGrossProfit += totalGrossProfit;
        productMap[key].totalDiscount += item.discount || 0;
      });
    });

    const allProducts = Object.values(productMap)
      .map((p) => ({
        ...p,
        grossProfitMargin:
          p.totalNetSales > 0
            ? (p.totalGrossProfit / p.totalNetSales) * 100
            : 0,
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity);

    const total = allProducts.length;

    return {
      topProducts: allProducts,
      total,
    };
  } catch (error) {
    console.error("Top Selling Products error:", error);
    throw error;
  }
};

export const getSalesByCategory = async (
  from?: string,
  to?: string,
  status: string = "Paid",
) => {
  try {
    let query = adminFirestore.collection("orders") as any;

    if (status !== "all") {
      if (status.toLowerCase() === "paid") {
        query = query.where("paymentStatus", "in", ["Paid", "PAID"]);
      } else {
        query = query.where("paymentStatus", "==", status);
      }
    }

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<=", Timestamp.fromDate(end));
    }

    const snap = await query.get();

    const categoryMap: Record<string, any> = {};
    const productCache: Record<string, any> = {}; // cache products

    for (const doc of snap.docs) {
      const order: any = doc.data();
      const orderItems = order.items || [];
      const orderGrossSales = orderItems.reduce(
        (sum: number, i: any) => sum + (i.price || 0) * i.quantity,
        0,
      );
      const orderLevelDiscount =
        (order.couponDiscount || 0) + (order.promotionDiscount || 0);

      for (const item of orderItems) {
        // 3. Fetch product (with cache)
        let product: any;
        if (productCache[item.itemId]) {
          product = productCache[item.itemId];
        } else {
          const productSnap = await adminFirestore
            .collection("products")
            .doc(item.itemId)
            .get();
          product = productSnap.exists ? productSnap.data() : null;
          productCache[item.itemId] = product;
        }

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

        const getSales = (item.price || 0) * item.quantity;
        const getCOGS = (item.bPrice || 0) * item.quantity;

        // FIXED: Distribute transaction fee proportionally
        const orderTotal = (order.total || 0) - (order.shippingFee || 0);
        const itemShareByTotal = orderTotal > 0 ? getSales / orderTotal : 0;
        const itemTransactionFee =
          (order.transactionFeeCharge || 0) * itemShareByTotal;

        // Distribute discount proportionally
        const itemShareByGross =
          orderGrossSales > 0 ? getSales / orderGrossSales : 0;
        const allocatedDiscount = orderLevelDiscount * itemShareByGross;

        const getNetSales =
          getSales -
          (item.discount || 0) -
          allocatedDiscount -
          itemTransactionFee;
        const getGrossProfit = getNetSales - getCOGS;

        // 5. Update category totals
        categoryMap[category].totalQuantity += item.quantity;
        categoryMap[category].totalSales += getSales;
        categoryMap[category].totalNetSales += getNetSales;
        categoryMap[category].totalCOGS += getCOGS;
        categoryMap[category].totalGrossProfit += getGrossProfit;
        categoryMap[category].totalDiscount += item.discount || 0;
        categoryMap[category].totalOrders += 1;
      }
    }

    const categories = Object.values(categoryMap)
      .map((c) => ({
        ...c,
        grossProfitMargin:
          c.totalNetSales > 0
            ? (c.totalGrossProfit / c.totalNetSales) * 100
            : 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales);

    return { categories };
  } catch (error) {
    console.error("Sales by Category error:", error);
    throw error;
  }
};

export const getSalesByBrand = async (from?: string, to?: string) => {
  try {
    let query = adminFirestore
      .collection("orders")
      .where("paymentStatus", "in", ["Paid", "PAID"]);

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<=", Timestamp.fromDate(end));
    }

    const snap = await query.get();

    const brandMap: Record<string, any> = {};
    const productCache: Record<string, any> = {}; // reduce reads

    for (const doc of snap.docs) {
      const order = doc.data();
      for (const item of order.items || []) {
        let product: any;

        // Lookup from cache
        if (productCache[item.itemId]) {
          product = productCache[item.itemId];
        } else {
          const productSnap = await adminFirestore
            .collection("products")
            .doc(item.itemId)
            .get();
          product = productSnap.exists ? productSnap.data() : null;
          productCache[item.itemId] = product;
        }

        const brand = product?.brand || "Unknown";

        if (!brandMap[brand]) {
          brandMap[brand] = {
            brand,
            totalQuantity: 0,
            totalSales: 0,
            totalNetSales: 0,
            totalCOGS: 0,
            totalGrossProfit: 0,
            totalDiscount: 0,
            totalOrders: 0,
          };
        }

        const getSales = (item.price || 0) * item.quantity;
        const getCOGS = (item.bPrice || 0) * item.quantity;

        // FIXED: Distribute transaction fee proportionally
        const orderTotal = (order.total || 0) - (order.shippingFee || 0);
        const itemShare = orderTotal > 0 ? getSales / orderTotal : 0;
        const itemTransactionFee =
          (order.transactionFeeCharge || 0) * itemShare;

        const getNetSales =
          getSales - (item.discount || 0) - itemTransactionFee;
        const getGrossProfit = getNetSales - getCOGS;

        brandMap[brand].totalQuantity += item.quantity;
        brandMap[brand].totalSales += getSales;
        brandMap[brand].totalNetSales += getNetSales;
        brandMap[brand].totalCOGS += getCOGS;
        brandMap[brand].totalGrossProfit += getGrossProfit;
        brandMap[brand].totalDiscount += item.discount || 0;
        brandMap[brand].totalOrders += 1;
      }
    }

    const brands = Object.values(brandMap)
      .map((b) => ({
        ...b,
        grossProfitMargin:
          b.totalNetSales > 0
            ? (b.totalGrossProfit / b.totalNetSales) * 100
            : 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales);

    return { brands };
  } catch (error) {
    console.error("Sales by Brand error:", error);
    throw error;
  }
};

export const getSalesVsDiscount = async (
  from?: string,
  to?: string,
  groupBy: "day" | "month" = "day",
) => {
  try {
    let query = adminFirestore
      .collection("orders")
      .where("paymentStatus", "in", ["Paid", "PAID"]);

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", start)
        .where("createdAt", "<=", end);
    }

    const snap = await query.get();
    const reportMap: Record<string, any> = {};

    snap.docs.forEach((doc) => {
      const order = doc.data();
      const dateObj = order.createdAt.toDate
        ? order.createdAt.toDate()
        : new Date(order.createdAt);

      // Group key (day or month)
      let key = "";
      if (groupBy === "month") {
        key = `${dateObj.getFullYear()}-${String(
          dateObj.getMonth() + 1,
        ).padStart(2, "0")}`;
      } else {
        key = dateObj.toISOString().split("T")[0]; // yyyy-mm-dd
      }

      if (!reportMap[key]) {
        reportMap[key] = {
          period: key,
          totalSales: 0,
          totalNetSales: 0,
          totalDiscount: 0,
          totalTransactionFee: 0,
          totalOrders: 0,
        };
      }

      const sale = (order.total || 0) + (order.discount || 0);
      const transactionFee = order.transactionFeeCharge || 0;
      const netSales = (order.total || 0) - (order.transactionFeeCharge || 0);

      reportMap[key].totalSales += sale;
      reportMap[key].totalNetSales += netSales;
      reportMap[key].totalDiscount += order.discount || 0;
      reportMap[key].totalTransactionFee += transactionFee;
      reportMap[key].totalOrders += 1;
    });

    return {
      report: Object.values(reportMap).sort((a, b) =>
        a.period > b.period ? 1 : -1,
      ),
    };
  } catch (error) {
    console.error("Sales vs Discount service error:", error);
    throw error;
  }
};

const normalizeKey = (str: string = "") => {
  return str.trim().toLowerCase().replace(/\s+/g, " ");
};

const toTitleCase = (str: string = "") => {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
};

export const getSalesByPaymentMethod = async (from?: string, to?: string) => {
  try {
    let query = adminFirestore
      .collection("orders")
      .where("paymentStatus", "in", ["Paid", "PAID"]);

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", start)
        .where("createdAt", "<=", end);
    }

    const snap = await query.get();
    const map: Record<string, any> = {};

    snap.docs.forEach((doc) => {
      const order = doc.data() as any;

      // === CASE 1: Split payments ===
      if (order.paymentReceived?.length) {
        order.paymentReceived.forEach((p: any) => {
          const normalized = normalizeKey(p.paymentMethod || "unknown");

          if (!map[normalized]) {
            map[normalized] = {
              paymentMethod: toTitleCase(normalized),
              totalAmount: 0,
              totalOrders: 0,
              transactions: 0,
            };
          }

          map[normalized].totalAmount += p.amount || 0;
          map[normalized].transactions += 1;
        });

        order.paymentReceived.forEach((p: any) => {
          const normalized = normalizeKey(p.paymentMethod || "unknown");
          map[normalized].totalOrders += 1;
        });
      } else {
        const normalized = normalizeKey(order.paymentMethod || "unknown");

        if (!map[normalized]) {
          map[normalized] = {
            paymentMethod: toTitleCase(normalized),
            totalAmount: 0,
            totalOrders: 0,
            transactions: 0,
          };
        }

        map[normalized].totalAmount += order.total || 0;
        map[normalized].totalOrders += 1;
        map[normalized].transactions += 1;
      }
    });

    return {
      paymentMethods: Object.values(map).sort(
        (a, b) => b.totalAmount - a.totalAmount,
      ),
    };
  } catch (err) {
    console.error("Sales by payment method error:", err);
    throw err;
  }
};

export const getRefundsAndReturns = async (from?: string, to?: string) => {
  try {
    let query = adminFirestore
      .collection("orders")
      .where("paymentStatus", "in", ["Refunded"]);

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", start)
        .where("createdAt", "<=", end);
    }

    const snap = await query.get();

    const result = {
      totalOrders: 0,
      totalRefundAmount: 0,
      totalRestockedItems: 0,
      items: [] as any[],
    };

    snap.docs.forEach((doc) => {
      const order = doc.data() as any;

      let refundAmount = 0;

      // If split payments exist → sum all reversed/refunded amounts
      if (order.paymentReceived?.length) {
        refundAmount = order.paymentReceived
          .filter((p: any) => p.amount < 0) // refunded amounts are negative
          .reduce((sum: number, p: any) => sum + Math.abs(p.amount), 0);
      } else {
        // Old structure (full refund)
        if (order.paymentStatus === "Refunded") refundAmount = order.total;
      }

      const restockedItems = order.items?.length ?? 0;

      result.totalOrders++;
      result.totalRefundAmount += refundAmount;
      if (order.restocked) result.totalRestockedItems += restockedItems;

      result.items.push({
        orderId: order.orderId,
        status: order.status,
        refundAmount,
        restocked: order.restocked || false,
        restockedAt: toSafeLocaleString(order.restockedAt) || null,
        createdAt: toSafeLocaleString(order.createdAt),
      });
    });

    return result;
  } catch (err) {
    console.error("Refunds & Returns report error:", err);
    throw err;
  }
};

export interface LiveStockItem {
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

export const fetchLiveStock = async (
  stockId: string = "all",
): Promise<{
  stock: LiveStockItem[];
  total: number;
  summary: {
    totalProducts: number;
    totalQuantity: number;
    totalValuation: number;
  };
}> => {
  try {
    const filters = stockId !== "all" ? `stockId:"${stockId}"` : "";

    // Algolia for efficient retrieval
    const { hits, nbHits } = await searchStockInventory("", {
      filters,
      hitsPerPage: 1000, // Large enough for live stock report, or handle pagination if needed
    });

    const inventoryDocs = hits;
    const total = nbHits;
    const stockList: LiveStockItem[] = [];
    const productIds = Array.from(
      new Set(inventoryDocs.map((d: any) => d.productId)),
    );
    const stockIds = Array.from(
      new Set(inventoryDocs.map((d: any) => d.stockId)),
    );

    // Helper to split array into chunks of 30
    const chunkArray = <T>(arr: T[], chunkSize: number) =>
      arr.reduce((result: T[][], item, index) => {
        const chunkIndex = Math.floor(index / chunkSize);
        result[chunkIndex] = result[chunkIndex] || [];
        result[chunkIndex].push(item);
        return result;
      }, []);

    // Fetch products in batches of 30
    const productMap: Record<string, any> = {};
    for (const chunk of chunkArray(productIds, 30)) {
      const productSnaps = await adminFirestore
        .collection("products")
        .where("productId", "in", chunk)
        .get();
      productSnaps.docs.forEach((p) => {
        const data = p.data();
        productMap[data.productId] = data;
      });
    }

    // Fetch stocks in batches of 30
    const stockMap: Record<string, any> = {};
    for (const chunk of chunkArray(stockIds, 30)) {
      const stockSnaps = await adminFirestore
        .collection("stocks")
        .where("id", "in", chunk)
        .get();
      stockSnaps.docs.forEach((s) => {
        const data = s.data();
        stockMap[data.id] = data;
      });
    }

    let totalQuantity = 0;
    let totalValuation = 0;

    inventoryDocs.forEach((d: any) => {
      const data = d;
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
        id: d.objectID || d.id,
        productId: data.productId,
        productName: product?.name || "",
        variantId: data.variantId,
        variantName: variant?.variantName || data.variantName || "",
        size: data.size,
        stockId: data.stockId,
        stockName: stock?.name || "",
        quantity: data.quantity || 0,
        buyingPrice,
        valuation,
      });
    });

    return {
      stock: stockList,
      total,
      summary: {
        totalProducts: stockList.length,
        totalQuantity,
        totalValuation,
      },
    };
  } catch (err) {
    console.error("Live Stock Service Error:", err);
    throw err;
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
  threshold: number;
  buyingPrice?: number;
  valuation?: number;
}

export const fetchLowStock = async (
  threshold: number = 10,
  stockId: string = "all",
): Promise<{
  stock: LowStockItem[];
  total: number;
  summary: {
    totalProducts: number;
    totalQuantity: number;
    totalValuation: number;
  };
}> => {
  try {
    // Build query
    let inventoryQuery: FirebaseFirestore.Query = adminFirestore
      .collection("stock_inventory")
      .where("quantity", "<=", threshold)
      .orderBy("quantity", "asc");

    if (stockId !== "all") {
      inventoryQuery = inventoryQuery.where("stockId", "==", stockId);
    }

    // Fetch paginated inventory
    const inventorySnap = await inventoryQuery.get();

    // Total count
    const totalSnap =
      stockId === "all"
        ? await adminFirestore
          .collection("stock_inventory")
          .where("quantity", "<=", threshold)
          .get()
        : await adminFirestore
          .collection("stock_inventory")
          .where("quantity", "<=", threshold)
          .where("stockId", "==", stockId)
          .get();

    const total = totalSnap.size;

    const stockList: LowStockItem[] = [];

    // Collect productIds and stockIds
    const productIds = inventorySnap.docs.map((d) => d.data().productId);
    const stockIds = inventorySnap.docs.map((d) => d.data().stockId);

    // Helper for batching 'in' queries (max 30)
    const batchFetch = async (
      collection: string,
      field: string,
      ids: string[],
    ) => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 30)
        chunks.push(ids.slice(i, i + 30));

      const result: FirebaseFirestore.DocumentData[] = [];
      for (const chunk of chunks) {
        const snap = await adminFirestore
          .collection(collection)
          .where(field, "in", chunk)
          .get();
        snap.docs.forEach((d) => result.push(d.data()));
      }
      return result;
    };

    // Fetch products
    const products = productIds.length
      ? await batchFetch("products", "productId", productIds)
      : [];
    const productMap: Record<string, any> = {};
    products.forEach((p) => (productMap[p.productId] = p));

    // Fetch stocks
    const stocks = stockIds.length
      ? await batchFetch("stocks", "id", stockIds)
      : [];
    const stockMap: Record<string, any> = {};
    stocks.forEach((s) => (stockMap[s.id] = s));

    let totalQuantity = 0;
    let totalValuation = 0;

    inventorySnap.docs.forEach((d) => {
      const data = d.data();
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
        id: d.id,
        productId: data.productId,
        productName: product?.name || "",
        variantId: data.variantId,
        variantName: variant?.variantName || data.variantName || "",
        size: data.size,
        stockId: data.stockId,
        stockName: stock?.name || "",
        quantity: data.quantity || 0,
        threshold,
        buyingPrice,
        valuation,
      });
    });

    return {
      stock: stockList,
      total,
      summary: {
        totalProducts: stockList.length,
        totalQuantity,
        totalValuation,
      },
    };
  } catch (err) {
    console.error("Low Stock Service Error:", err);
    throw err;
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

export interface StockValuationSummary {
  totalProducts: number;
  totalQuantity: number;
  totalValuation: number;
}

const chunkArray = <T>(arr: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
};

export const fetchStockValuationByStock = async (
  stockId: string,
): Promise<{ stock: StockValuationItem[]; summary: StockValuationSummary }> => {
  try {
    let inventoryQuery: FirebaseFirestore.Query =
      adminFirestore.collection("stock_inventory");

    if (stockId !== "all") {
      inventoryQuery = inventoryQuery.where("stockId", "==", stockId);
    }

    const inventorySnap = await inventoryQuery.get();

    if (inventorySnap.empty) {
      return {
        stock: [],
        summary: { totalProducts: 0, totalQuantity: 0, totalValuation: 0 },
      };
    }

    const inventoryDocs = inventorySnap.docs;
    const productIds = Array.from(
      new Set(inventoryDocs.map((d) => d.data().productId)),
    );
    const stockIds = Array.from(
      new Set(inventoryDocs.map((d) => d.data().stockId)),
    );

    // Fetch products in chunks of 30
    const productMap: Record<string, any> = {};
    const productChunks = chunkArray(productIds, 30);
    for (const chunk of productChunks) {
      const snap = await adminFirestore
        .collection("products")
        .where("productId", "in", chunk)
        .get();
      snap.docs.forEach((p) => {
        const data = p.data();
        productMap[data.productId] = data;
      });
    }

    // Fetch stocks in chunks of 30
    const stockMap: Record<string, any> = {};
    const stockChunks = chunkArray(stockIds, 30);
    for (const chunk of stockChunks) {
      const snap = await adminFirestore
        .collection("stocks")
        .where("id", "in", chunk)
        .get();
      snap.docs.forEach((s) => {
        const data = s.data();
        stockMap[data.id] = data;
      });
    }

    let totalQuantity = 0;
    let totalValuation = 0;

    const stockList: StockValuationItem[] = inventoryDocs.map((d) => {
      const data = d.data();
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
        id: d.id,
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
      stock: stockList,
      summary: {
        totalProducts: stockList.length,
        totalQuantity,
        totalValuation,
      },
    };
  } catch (err) {
    console.error("Stock Valuation Service Error:", err);
    throw err;
  }
};

export interface DailyRevenue {
  date: string;
  totalSales: number;
  totalNetSales: number;
  totalCOGS: number;
  totalOrders: number;
  totalDiscount: number;
  totalTransactionFee: number;
  totalExpenses: number;
  totalOtherIncome: number;
  grossProfit: number;
  grossProfitMargin: number;
  netProfit: number;
  netProfitMargin: number;
}

export interface RevenueReport {
  daily: DailyRevenue[];
  summary: Omit<DailyRevenue, "date">;
}

export const getDailyRevenueReport = async (
  from: string,
  to: string,
): Promise<RevenueReport> => {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  // Fetch paid orders
  const ordersSnapshot = await adminFirestore
    .collection("orders")
    .where("paymentStatus", "in", ["Paid", "PAID"])
    .where("createdAt", ">=", Timestamp.fromDate(fromDate))
    .where("createdAt", "<=", Timestamp.fromDate(toDate))
    .get();

  // Fetch approved expenses
  const expensesSnapshot = await adminFirestore
    .collection("expenses")
    // .where("type", "==", "expense") // Include income
    .where("status", "==", "APPROVED")
    .where("date", ">=", Timestamp.fromDate(fromDate))
    .where("date", "<=", Timestamp.fromDate(toDate))
    .get();

  // Group orders by date
  const ordersByDate: Record<string, Order[]> = {};
  ordersSnapshot.forEach((doc) => {
    const order = doc.data() as Order;
    const dateStr = (order.createdAt as Timestamp)
      .toDate()
      .toISOString()
      .split("T")[0];
    if (!ordersByDate[dateStr]) ordersByDate[dateStr] = [];
    ordersByDate[dateStr].push(order);
  });

  // Group expenses by date
  const expensesByDate: Record<string, number> = {};
  const incomeByDate: Record<string, number> = {};
  expensesSnapshot.forEach((doc) => {
    const expense = doc.data();
    const dateStr = (expense.date as Timestamp)
      .toDate()
      .toISOString()
      .split("T")[0];

    if (expense.type === "income") {
      if (!incomeByDate[dateStr]) incomeByDate[dateStr] = 0;
      incomeByDate[dateStr] += Number(expense.amount || 0);
    } else {
      // Default to expense
      if (!expensesByDate[dateStr]) expensesByDate[dateStr] = 0;
      expensesByDate[dateStr] += Number(expense.amount || 0);
    }
  });

  const daily: DailyRevenue[] = [];

  const summaryTotals = {
    totalSales: 0,
    totalNetSales: 0,
    totalCOGS: 0,
    totalOrders: 0,
    totalDiscount: 0,
    totalTransactionFee: 0,
    totalExpenses: 0,
    totalOtherIncome: 0,
    grossProfit: 0,
    grossProfitMargin: 0,
    netProfit: 0,
    netProfitMargin: 0,
  };

  Object.keys(ordersByDate)
    .sort()
    .forEach((dateStr) => {
      const dayOrders = ordersByDate[dateStr];
      const totalOrders = dayOrders.length;

      let totalSales = 0;
      let totalNetSales = 0;
      let totalCOGS = 0;
      let totalDiscount = 0;
      let totalTransactionFee = 0;

      dayOrders.forEach((o) => {
        const sales = (o.total || 0) + (o.discount || 0) - (o.fee || 0);
        const netSales = (o.total || 0) - (o.transactionFeeCharge || 0);
        const cogs = o.items.reduce(
          (sum, item) => sum + (item.bPrice || 0) * (item.quantity || 0),
          0,
        );

        totalSales += sales;
        totalNetSales += netSales;
        totalCOGS += cogs;
        totalDiscount += o.discount || 0;
        totalTransactionFee += o.transactionFeeCharge || 0;
      });

      const totalExpenses = expensesByDate[dateStr] || 0;
      const totalOtherIncome = incomeByDate[dateStr] || 0;

      const grossProfit = totalSales - totalCOGS;
      const grossProfitMargin =
        totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
      const netProfit =
        totalNetSales + totalOtherIncome - totalExpenses - totalCOGS;
      const netProfitMargin =
        totalNetSales > 0 ? (netProfit / totalNetSales) * 100 : 0;

      daily.push({
        date: dateStr,
        totalSales,
        totalNetSales,
        totalCOGS,
        totalOrders,
        totalDiscount,
        totalTransactionFee,
        totalExpenses,
        totalOtherIncome,
        grossProfit,
        grossProfitMargin,
        netProfit,
        netProfitMargin,
      });

      summaryTotals.totalSales += totalSales;
      summaryTotals.totalNetSales += totalNetSales;
      summaryTotals.totalCOGS += totalCOGS;
      summaryTotals.totalOrders += totalOrders;
      summaryTotals.totalDiscount += totalDiscount;
      summaryTotals.totalTransactionFee += totalTransactionFee;
      summaryTotals.totalExpenses += totalExpenses;
      summaryTotals.totalOtherIncome += totalOtherIncome;
      summaryTotals.grossProfit += grossProfit;
      summaryTotals.netProfit += netProfit;
    });

  summaryTotals.grossProfitMargin =
    summaryTotals.totalSales > 0
      ? (summaryTotals.grossProfit / summaryTotals.totalSales) * 100
      : 0;
  summaryTotals.netProfitMargin =
    summaryTotals.totalNetSales > 0
      ? (summaryTotals.netProfit / summaryTotals.totalNetSales) * 100
      : 0;

  return {
    daily,
    summary: summaryTotals,
  };
};

export interface MonthlyRevenue {
  month: string;
  totalSales: number;
  totalNetSales: number;
  totalCOGS: number;
  totalOrders: number;
  totalDiscount: number;
  totalTransactionFee: number;
  totalExpenses: number;
  totalOtherIncome: number;
  grossProfit: number;
  grossProfitMargin: number;
  netProfit: number;
  netProfitMargin: number;
}

export interface MonthlyRevenueReport {
  monthly: MonthlyRevenue[];
  summary: Omit<MonthlyRevenue, "month">;
}


export const getMonthlyRevenueReport = async (
  from: string,
  to: string,
): Promise<MonthlyRevenueReport> => {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  // Fetch paid orders
  const ordersSnapshot = await adminFirestore
    .collection("orders")
    .where("paymentStatus", "in", ["Paid", "PAID"])
    .where("createdAt", ">=", Timestamp.fromDate(fromDate))
    .where("createdAt", "<=", Timestamp.fromDate(toDate))
    .get();

  // Fetch approved expenses
  const expensesSnapshot = await adminFirestore
    .collection("expenses")
    // .where("type", "==", "expense") // Fetch all to include income
    .where("status", "==", "APPROVED")
    .where("date", ">=", Timestamp.fromDate(fromDate))
    .where("date", "<=", Timestamp.fromDate(toDate))
    .get();

  // Group orders by month YYYY-MM
  const ordersByMonth: Record<string, Order[]> = {};
  ordersSnapshot.forEach((doc) => {
    const order = doc.data() as Order;
    const date = (order.createdAt as Timestamp).toDate();

    const monthStr = `${date.getFullYear()}-${String(
      date.getMonth() + 1,
    ).padStart(2, "0")}`;

    if (!ordersByMonth[monthStr]) ordersByMonth[monthStr] = [];
    ordersByMonth[monthStr].push(order);
  });

  // Group expenses by month YYYY-MM
  const expensesByMonth: Record<string, number> = {};
  const incomeByMonth: Record<string, number> = {};
  expensesSnapshot.forEach((doc) => {
    const expense = doc.data();
    const date = (expense.date as Timestamp).toDate();

    const monthStr = `${date.getFullYear()}-${String(
      date.getMonth() + 1,
    ).padStart(2, "0")}`;

    if (expense.type.toLowerCase() === "income") {
      if (!incomeByMonth[monthStr]) incomeByMonth[monthStr] = 0;
      incomeByMonth[monthStr] += Number(expense.amount || 0);
    } else {
      if (!expensesByMonth[monthStr]) expensesByMonth[monthStr] = 0;
      expensesByMonth[monthStr] += Number(expense.amount || 0);
    }
  });

  const monthly: MonthlyRevenue[] = [];

  const summaryTotals = {
    totalSales: 0,
    totalNetSales: 0,
    totalCOGS: 0,
    totalOrders: 0,
    totalDiscount: 0,
    totalTransactionFee: 0,
    totalExpenses: 0,
    totalOtherIncome: 0,
    grossProfit: 0,
    grossProfitMargin: 0,
    netProfit: 0,
    netProfitMargin: 0,
  };

  Object.keys(ordersByMonth)
    .sort()
    .forEach((monthStr) => {
      const monthOrders = ordersByMonth[monthStr];
      const totalOrders = monthOrders.length;

      let totalSales = 0;
      let totalNetSales = 0;
      let totalCOGS = 0;
      let totalDiscount = 0;
      let totalTransactionFee = 0;

      monthOrders.forEach((o) => {
        const sales =
          (Number(o.total) || 0) +
          (Number(o.discount) || 0) -
          (Number(o.fee) || 0) -
          (Number(o.shippingFee) || 0);
        const netSales =
          (Number(o.total) || 0) -
          (Number(o.shippingFee) || 0) -
          (Number(o.transactionFeeCharge) || 0);
        const cogs = o.items.reduce(
          (sum, item) =>
            sum + Number(item.bPrice || 0) * Number(item.quantity || 0),
          0,
        );

        totalSales += sales;
        totalNetSales += netSales;
        totalCOGS += cogs;
        totalDiscount += Number(o.discount) || 0;
        totalTransactionFee += Number(o.transactionFeeCharge) || 0;
      });

      const totalExpenses = Number(expensesByMonth[monthStr] || 0);
      const totalOtherIncome = Number(incomeByMonth[monthStr] || 0);
      const grossProfit = totalSales - totalCOGS;
      const grossProfitMargin =
        totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
      const netProfit =
        totalNetSales + totalOtherIncome - totalExpenses - totalCOGS;
      const netProfitMargin =
        totalNetSales > 0 ? (netProfit / totalNetSales) * 100 : 0;

      monthly.push({
        month: monthStr,
        totalSales,
        totalNetSales,
        totalCOGS,
        totalOrders,
        totalDiscount,
        totalTransactionFee,
        totalExpenses,
        totalOtherIncome,
        grossProfit,
        grossProfitMargin,
        netProfit,
        netProfitMargin,
      });

      summaryTotals.totalSales += totalSales;
      summaryTotals.totalNetSales += totalNetSales;
      summaryTotals.totalCOGS += totalCOGS;
      summaryTotals.totalOrders += totalOrders;
      summaryTotals.totalDiscount += totalDiscount;
      summaryTotals.totalTransactionFee += totalTransactionFee;
      summaryTotals.totalExpenses += totalExpenses;
      summaryTotals.totalOtherIncome += totalOtherIncome;
      summaryTotals.grossProfit += grossProfit;
      summaryTotals.netProfit += netProfit;
    });

  summaryTotals.grossProfitMargin =
    summaryTotals.totalSales > 0
      ? (summaryTotals.grossProfit / summaryTotals.totalSales) * 100
      : 0;
  summaryTotals.netProfitMargin =
    summaryTotals.totalNetSales > 0
      ? (summaryTotals.netProfit / summaryTotals.totalNetSales) * 100
      : 0;

  return {
    monthly,
    summary: summaryTotals,
  };
};

export interface YearlyRevenue {
  year: string; // YYYY
  totalSales: number;
  totalNetSales: number;
  totalCOGS: number;
  totalOrders: number;
  totalDiscount: number;
  totalTransactionFee: number;
  totalExpenses: number;
  totalOtherIncome: number;
  grossProfit: number;
  grossProfitMargin: number;
  netProfit: number;
  netProfitMargin: number;
}

export interface YearlyRevenueReport {
  yearly: YearlyRevenue[];
  summary: Omit<YearlyRevenue, "year">;
}

export const getYearlyRevenueReport = async (
  from: string,
  to: string,
): Promise<YearlyRevenueReport> => {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);

  // Fetch paid orders
  const ordersSnapshot = await adminFirestore
    .collection("orders")
    .where("paymentStatus", "in", ["Paid", "PAID"])
    .where("createdAt", ">=", Timestamp.fromDate(fromDate))
    .where("createdAt", "<=", Timestamp.fromDate(toDate))
    .get();

  // Fetch approved expenses
  const expensesSnapshot = await adminFirestore
    .collection("expenses")
    // .where("type", "==", "expense") // Include income
    .where("status", "==", "APPROVED")
    .where("date", ">=", Timestamp.fromDate(fromDate))
    .where("date", "<=", Timestamp.fromDate(toDate))
    .get();

  // Group orders by year YYYY
  const ordersByYear: Record<string, Order[]> = {};
  ordersSnapshot.forEach((doc) => {
    const order = doc.data() as Order;
    const date = (order.createdAt as Timestamp).toDate();
    const yearStr = String(date.getFullYear());

    if (!ordersByYear[yearStr]) ordersByYear[yearStr] = [];
    ordersByYear[yearStr].push(order);
  });

  // Group expenses by year YYYY
  const expensesByYear: Record<string, number> = {};
  const incomeByYear: Record<string, number> = {};
  expensesSnapshot.forEach((doc) => {
    const expense = doc.data();
    const date = (expense.date as Timestamp).toDate();
    const yearStr = String(date.getFullYear());

    if (expense.type === "income") {
      if (!incomeByYear[yearStr]) incomeByYear[yearStr] = 0;
      incomeByYear[yearStr] += Number(expense.amount || 0);
    } else {
      if (!expensesByYear[yearStr]) expensesByYear[yearStr] = 0;
      expensesByYear[yearStr] += Number(expense.amount || 0);
    }
  });

  const yearly: YearlyRevenue[] = [];
  const summaryTotals = {
    totalSales: 0,
    totalNetSales: 0,
    totalCOGS: 0,
    totalOrders: 0,
    totalDiscount: 0,
    totalTransactionFee: 0,
    totalExpenses: 0,
    totalOtherIncome: 0,
    grossProfit: 0,
    grossProfitMargin: 0,
    netProfit: 0,
    netProfitMargin: 0,
  };

  Object.keys(ordersByYear)
    .sort()
    .forEach((yearStr) => {
      const yearOrders = ordersByYear[yearStr];
      const totalOrders = yearOrders.length;

      let totalSales = 0;
      let totalNetSales = 0;
      let totalCOGS = 0;
      let totalDiscount = 0;
      let totalTransactionFee = 0;

      yearOrders.forEach((o) => {
        const sales =
          (Number(o.total) || 0) +
          (Number(o.discount) || 0) -
          (Number(o.fee) || 0) -
          (Number(o.shippingFee) || 0);
        const netSales =
          (Number(o.total) || 0) -
          (Number(o.shippingFee) || 0) -
          (Number(o.transactionFeeCharge) || 0);
        const cogs = o.items.reduce(
          (sum, item) =>
            sum + Number(item.bPrice || 0) * Number(item.quantity || 0),
          0,
        );

        totalSales += sales;
        totalNetSales += netSales;
        totalCOGS += cogs;
        totalDiscount += Number(o.discount) || 0;
        totalTransactionFee += Number(o.transactionFeeCharge) || 0;
      });

      const totalExpenses = Number(expensesByYear[yearStr] || 0);
      const totalOtherIncome = Number(incomeByYear[yearStr] || 0);
      const grossProfit = totalSales - totalCOGS;
      const grossProfitMargin =
        totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
      const netProfit =
        totalNetSales + totalOtherIncome - totalExpenses - totalCOGS;
      const netProfitMargin =
        totalNetSales > 0 ? (netProfit / totalNetSales) * 100 : 0;

      yearly.push({
        year: yearStr,
        totalSales,
        totalNetSales,
        totalCOGS,
        totalOrders,
        totalDiscount,
        totalTransactionFee,
        totalExpenses,
        totalOtherIncome,
        grossProfit,
        grossProfitMargin,
        netProfit,
        netProfitMargin,
      });

      summaryTotals.totalSales += totalSales;
      summaryTotals.totalNetSales += totalNetSales;
      summaryTotals.totalCOGS += totalCOGS;
      summaryTotals.totalOrders += totalOrders;
      summaryTotals.totalDiscount += totalDiscount;
      summaryTotals.totalTransactionFee += totalTransactionFee;
      summaryTotals.totalExpenses += totalExpenses;
      summaryTotals.totalOtherIncome += totalOtherIncome;
      summaryTotals.grossProfit += grossProfit;
      summaryTotals.netProfit += netProfit;
    });

  summaryTotals.grossProfitMargin =
    summaryTotals.totalSales > 0
      ? (summaryTotals.grossProfit / summaryTotals.totalSales) * 100
      : 0;
  summaryTotals.netProfitMargin =
    summaryTotals.totalNetSales > 0
      ? (summaryTotals.netProfit / summaryTotals.totalNetSales) * 100
      : 0;

  return {
    yearly,
    summary: summaryTotals,
  };
};

export const getCashFlowReport = async (from: string, to: string) => {
  try {
    let query = adminFirestore
      .collection("orders")
      .where("paymentStatus", "in", ["Paid", "PAID"]);

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      query = query
        .where("createdAt", ">=", Timestamp.fromDate(start))
        .where("createdAt", "<=", Timestamp.fromDate(end));
    }

    query = query.orderBy("createdAt", "desc");

    const snap = await query.get();

    const orders = snap.docs.map((d) => ({
      orderId: d.id,
      ...d.data(),
      createdAt: toSafeLocaleString(d.data().createdAt),
    }));

    // Fetch approved expenses
    let expenseQuery = adminFirestore
      .collection("expenses")
      .where("type", "==", "expense")
      .where("status", "==", "APPROVED");

    if (from && to) {
      const start = new Date(from);
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);

      expenseQuery = expenseQuery
        .where("date", ">=", Timestamp.fromDate(start))
        .where("date", "<=", Timestamp.fromDate(end));
    }

    const expenseSnap = await expenseQuery.get();

    const expenses = expenseSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: toSafeLocaleString(d.data().createdAt),
    }));

    // Helper calculations
    // Cash In = Order Total (what customer paid)
    const getCashIn = (o: any) => o.total || 0;

    // Transaction Fee = The fee charged by payment gateway
    const getTransactionFee = (o: any) => o.transactionFeeCharge || 0;

    // Expenses
    const getExpenseAmount = (e: any) => e.amount || 0;

    // Net Cash Flow = Cash In - Transaction Fee - Expenses
    // Note: This is calculated per day or total, not per order

    // ---------- MAIN SUMMARY ----------
    const totalOrders = orders.length;
    let totalCashIn = orders.reduce((s, o) => s + getCashIn(o), 0);
    let totalTransactionFees = orders.reduce(
      (s, o) => s + getTransactionFee(o),
      0,
    );
    const totalExpenses = expenses.reduce((s, e) => s + getExpenseAmount(e), 0);
    let totalNetCashFlow = totalCashIn - totalTransactionFees - totalExpenses;

    // ---------- DAILY SUMMARY ----------
    const dailyMap: Record<
      string,
      {
        date: string;
        orders: number;
        cashIn: number;
        transactionFees: number;
        expenses: number;
        netCashFlow: number;
      }
    > = {};

    orders.forEach((o) => {
      const dateKey = o.createdAt.split(" ")[0];

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          orders: 0,
          cashIn: 0,
          transactionFees: 0,
          expenses: 0,
          netCashFlow: 0,
        };
      }

      dailyMap[dateKey].orders += 1;
      dailyMap[dateKey].cashIn += getCashIn(o);
      dailyMap[dateKey].transactionFees += getTransactionFee(o);
    });

    expenses.forEach((e) => {
      const dateKey = e.createdAt.split(" ")[0];

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          orders: 0,
          cashIn: 0,
          transactionFees: 0,
          expenses: 0,
          netCashFlow: 0,
        };
      }

      dailyMap[dateKey].expenses += getExpenseAmount(e);
    });

    // Calculate Net Cash Flow for each day
    Object.values(dailyMap).forEach((day) => {
      day.netCashFlow = day.cashIn - day.transactionFees - day.expenses;
    });

    const daily = Object.values(dailyMap).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return {
      summary: {
        totalOrders,
        totalCashIn,
        totalTransactionFees,
        totalExpenses,
        totalNetCashFlow,
        daily,
        from,
        to,
      },
    };
  } catch (error) {
    console.log("Cash Flow report error:", error);
    throw error;
  }
};

// ============================================================
// INDUSTRY-STANDARD REPORTS
// ============================================================

/**
 * Profit & Loss Statement Interface
 */
export interface ProfitLossStatement {
  period: { from: string; to: string };
  revenue: {
    grossSales: number;
    discounts: number;
    netSales: number;
    shippingIncome: number;
    otherIncome: number;
    totalRevenue: number;
  };
  costOfGoodsSold: {
    productCost: number;
    shippingCost: number;
    totalCOGS: number;
  };
  grossProfit: number;
  grossProfitMargin: number;
  operatingExpenses: {
    byCategory: { category: string; amount: number }[];
    totalExpenses: number;
  };
  operatingIncome: number;
  otherExpenses: {
    transactionFees: number;
    otherFees: number;
    totalOther: number;
  };
  netProfit: number;
  netProfitMargin: number;
}

/**
 * Get Profit & Loss Statement
 */
export const getProfitLossStatement = async (
  from: string,
  to: string,
): Promise<ProfitLossStatement> => {
  try {
    console.log(
      `[ReportService] Generating P&L Statement from ${from} to ${to}`,
    );

    const startTimestamp = Timestamp.fromDate(
      dayjs(from).startOf("day").toDate(),
    );
    const endTimestamp = Timestamp.fromDate(dayjs(to).endOf("day").toDate());

    // Fetch orders
    const ordersSnapshot = await adminFirestore
      .collection("orders")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .where("paymentStatus", "not-in", ["Failed", "Refunded"])
      .get();

    // Fetch expenses
    const expensesSnapshot = await adminFirestore
      .collection("expenses")
      .where("type", "==", "expense")
      .where("status", "==", "APPROVED")
      .where("date", ">=", startTimestamp)
      .where("date", "<=", endTimestamp)
      .get();

    // Collect product IDs for COGS
    const productIds = new Set<string>();
    ordersSnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      order.items?.forEach((item: any) => {
        if (item.itemId) productIds.add(item.itemId);
      });
    });

    // Fetch product costs
    const productDocs = await Promise.all(
      Array.from(productIds)
        .filter((id) => id && id.trim() !== "")
        .map((id) => adminFirestore.collection("products").doc(id).get()),
    );
    const productCostMap = new Map<string, number>();
    productDocs.forEach((doc) => {
      if (doc.exists) {
        productCostMap.set(doc.id, doc.data()?.buyingPrice || 0);
      }
    });

    // Calculate revenue
    let grossSales = 0;
    let netSales = 0;
    let totalDiscounts = 0;
    let totalTransactionFees = 0;
    let totalProductCost = 0;
    let totalOrderFee = 0;

    ordersSnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      const orderTotal = order.total || 0;
      const shippingFee = order.shippingFee || 0;
      const orderFee = (order as any).fee || 0;
      const discount = order.discount || 0;

      // Per order calculations
      // net sale = orderTotal - shippingFee - orderFee
      const orderNetSale = orderTotal - shippingFee - orderFee;
      // gross sale = netSale + discount
      const orderGrossSale = orderNetSale + discount;

      netSales += orderNetSale;
      grossSales += orderGrossSale;
      totalDiscounts += discount;
      totalTransactionFees += order.transactionFeeCharge || 0;
      totalOrderFee += orderFee;

      // Calculate COGS
      order.items?.forEach((item: any) => {
        const cost = item.bPrice || productCostMap.get(item.itemId) || 0;
        totalProductCost += cost * (item.quantity || 0);
      });
    });

    // Calculate expenses by category
    const expensesByCategory = new Map<string, number>();
    expensesSnapshot.docs.forEach((doc) => {
      const expense = doc.data();
      const category = expense.for || "Other";
      const amount = Number(expense.amount || 0);
      expensesByCategory.set(
        category,
        (expensesByCategory.get(category) || 0) + amount,
      );
    });

    const expenseCategoryArray: { category: string; amount: number }[] =
      Array.from(expensesByCategory.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount);

    const totalExpenses = expenseCategoryArray.reduce(
      (sum, e) => sum + e.amount,
      0,
    );

    // Total Revenue is product sales + shipping + other fees
    const totalShippingCollected = Array.from(ordersSnapshot.docs).reduce(
      (sum, doc) => sum + (doc.data().shippingFee || 0),
      0,
    );
    const totalRevenueValue = netSales + totalShippingCollected + totalOrderFee;

    // Calculate profit
    const grossProfitValue =
      totalRevenueValue - (totalProductCost + totalShippingCollected);
    const grossProfitMarginValue =
      totalRevenueValue > 0 ? (grossProfitValue / totalRevenueValue) * 100 : 0;
    const operatingIncomeValue = grossProfitValue - totalExpenses;
    // Net profit includes fee as income
    const netProfitValue =
      operatingIncomeValue - totalTransactionFees + totalOrderFee;
    const netProfitMarginValue =
      totalRevenueValue > 0 ? (netProfitValue / totalRevenueValue) * 100 : 0;

    return {
      period: { from, to },
      revenue: {
        grossSales,
        discounts: totalDiscounts,
        netSales,
        shippingIncome: totalShippingCollected,
        otherIncome: totalOrderFee,
        totalRevenue: totalRevenueValue,
      },
      costOfGoodsSold: {
        productCost: totalProductCost,
        shippingCost: totalShippingCollected,
        totalCOGS: totalProductCost + totalShippingCollected,
      },
      grossProfit: grossProfitValue,
      grossProfitMargin: Math.round(grossProfitMarginValue * 100) / 100,
      operatingExpenses: {
        byCategory: expenseCategoryArray,
        totalExpenses,
      },
      operatingIncome: operatingIncomeValue,
      otherExpenses: {
        transactionFees: totalTransactionFees,
        otherFees: 0,
        totalOther: totalTransactionFees,
      },
      netProfit: netProfitValue,
      netProfitMargin: Math.round(netProfitMarginValue * 100) / 100,
    };
  } catch (error) {
    console.error("[ReportService] P&L Statement error:", error);
    throw error;
  }
};

/**
 * Expense Report Interface
 */
export interface ExpenseReportItem {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  status: string;
  createdBy?: string;
}

export interface ExpenseReport {
  period: { from: string; to: string };
  expenses: ExpenseReportItem[];
  summary: {
    total: number;
    byCategory: { category: string; amount: number; percentage: number }[];
    count: number;
  };
}

/**
 * Get Expense Report
 */
export const getExpenseReport = async (
  from: string,
  to: string,
  category?: string,
): Promise<ExpenseReport> => {
  try {
    console.log(
      `[ReportService] Generating Expense Report from ${from} to ${to}`,
    );

    const startTimestamp = Timestamp.fromDate(
      dayjs(from).startOf("day").toDate(),
    );
    const endTimestamp = Timestamp.fromDate(dayjs(to).endOf("day").toDate());

    let query: FirebaseFirestore.Query = adminFirestore
      .collection("expenses")
      .where("type", "==", "expense")
      .where("date", ">=", startTimestamp)
      .where("date", "<=", endTimestamp);

    if (category && category !== "all") {
      query = query.where("category", "==", category);
    }

    const snapshot = await query.get();

    const expenses: ExpenseReportItem[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        date: toSafeLocaleString(data.date ?? data.createdAt),
        category: data.category || "Other",
        description: data.note || "",
        amount: Number(data.amount || 0),
        status: data.status || "PENDING",
        createdBy: data.createdBy,
      };
    });

    // Calculate summary
    const categoryTotals = new Map<string, number>();
    let total = 0;

    expenses.forEach((e) => {
      total += e.amount;
      categoryTotals.set(
        e.category,
        (categoryTotals.get(e.category) || 0) + e.amount,
      );
    });

    const byCategory = Array.from(categoryTotals.entries())
      .map(([cat, amount]) => ({
        category: cat,
        amount,
        percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      period: { from, to },
      expenses: expenses.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
      summary: {
        total,
        byCategory,
        count: expenses.length,
      },
    };
  } catch (error) {
    console.error("[ReportService] Expense Report error:", error);
    throw error;
  }
};

/**
 * Customer Analytics Interface
 */
export interface CustomerAnalytics {
  period: { from: string; to: string };
  overview: {
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    averageOrderValue: number;
    ordersPerCustomer: number;
  };
  topCustomers: {
    name: string;
    email?: string;
    phone?: string;
    totalOrders: number;
    totalSpent: number;
  }[];
  acquisitionBySource: { source: string; count: number; percentage: number }[];
}

/**
 * Get Customer Analytics
 */
export const getCustomerAnalytics = async (
  from: string,
  to: string,
): Promise<CustomerAnalytics> => {
  try {
    console.log(
      `[ReportService] Generating Customer Analytics from ${from} to ${to}`,
    );

    const startTimestamp = Timestamp.fromDate(
      dayjs(from).startOf("day").toDate(),
    );
    const endTimestamp = Timestamp.fromDate(dayjs(to).endOf("day").toDate());

    // Fetch orders in period
    const ordersSnapshot = await adminFirestore
      .collection("orders")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .where("paymentStatus", "in", ["Paid", "PAID"])
      .get();

    // Fetch orders before this period to identify returning customers
    const previousOrdersSnapshot = await adminFirestore
      .collection("orders")
      .where("createdAt", "<", startTimestamp)
      .where("paymentStatus", "in", ["Paid", "PAID"])
      .get();

    const previousCustomers = new Set<string>();
    previousOrdersSnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      const customerId =
        order.customer?.id || order.customer?.phone || order.customer?.email;
      if (customerId) previousCustomers.add(customerId);
    });

    // Analyze current period customers
    const customerData = new Map<
      string,
      {
        name: string;
        email?: string;
        phone?: string;
        orders: number;
        spent: number;
      }
    >();
    const sourceCounts = new Map<string, number>();
    let totalRevenue = 0;

    ordersSnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      const customer = order.customer;
      const customerId =
        customer?.id || customer?.phone || customer?.email || "guest";
      const orderTotal = order.total || 0;
      const source = order.from?.toString().toLowerCase() || "store";

      totalRevenue += orderTotal;
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

      if (customerData.has(customerId)) {
        const existing = customerData.get(customerId)!;
        existing.orders += 1;
        existing.spent += orderTotal;
      } else {
        customerData.set(customerId, {
          name: customer?.name || "Guest",
          email: customer?.email,
          phone: customer?.phone,
          orders: 1,
          spent: orderTotal,
        });
      }
    });

    const totalCustomers = customerData.size;
    const totalOrders = ordersSnapshot.size;

    // Count new vs returning
    let newCustomers = 0;
    let returningCustomers = 0;
    customerData.forEach((_, customerId) => {
      if (previousCustomers.has(customerId)) {
        returningCustomers++;
      } else {
        newCustomers++;
      }
    });

    // Top customers
    const topCustomers = Array.from(customerData.values())
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 10)
      .map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        totalOrders: c.orders,
        totalSpent: c.spent,
      }));

    // Acquisition by source
    const totalSourceCount = Array.from(sourceCounts.values()).reduce(
      (a, b) => a + b,
      0,
    );
    const acquisitionBySource = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({
        source: source.charAt(0).toUpperCase() + source.slice(1),
        count,
        percentage:
          totalSourceCount > 0
            ? Math.round((count / totalSourceCount) * 100)
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      period: { from, to },
      overview: {
        totalCustomers,
        newCustomers,
        returningCustomers,
        averageOrderValue:
          totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
        ordersPerCustomer:
          totalCustomers > 0
            ? Math.round((totalOrders / totalCustomers) * 100) / 100
            : 0,
      },
      topCustomers,
      acquisitionBySource,
    };
  } catch (error) {
    console.error("[ReportService] Customer Analytics error:", error);
    throw error;
  }
};

/**
 * Tax Report Interface
 */
export interface TaxReportItem {
  date: string;
  orderId: string;
  orderTotal: number;
  taxableAmount: number;
  taxCollected: number;
}

export interface TaxReport {
  period: { from: string; to: string };
  transactions: TaxReportItem[];
  summary: {
    totalOrders: number;
    totalSales: number;
    totalTaxableAmount: number;
    totalTaxCollected: number;
    effectiveTaxRate: number;
  };
}

/**
 * Get Tax Report
 */
export const getTaxReport = async (
  from: string,
  to: string,
): Promise<
  TaxReport & {
    taxSettings: { taxEnabled: boolean; taxName: string; taxRate: number };
  }
> => {
  try {
    console.log(`[ReportService] Generating Tax Report from ${from} to ${to}`);

    // Import tax settings dynamically to avoid circular dependency
    const { getTaxSettings } = await import("./TaxService");
    const taxSettings = await getTaxSettings();

    const startTimestamp = Timestamp.fromDate(
      dayjs(from).startOf("day").toDate(),
    );
    const endTimestamp = Timestamp.fromDate(dayjs(to).endOf("day").toDate());

    const ordersSnapshot = await adminFirestore
      .collection("orders")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .where("paymentStatus", "in", ["Paid", "PAID"])
      .get();

    const transactions: TaxReportItem[] = [];
    let totalSales = 0;
    let totalTaxableAmount = 0;
    let totalTaxCollected = 0;

    ordersSnapshot.docs.forEach((doc) => {
      const order = doc.data() as Order;
      const orderTotal = order.total || 0;
      const shippingFee = order.shippingFee || 0;

      // Calculate taxable amount based on settings
      let taxableAmount = orderTotal - shippingFee;
      if (taxSettings.applyToShipping) {
        taxableAmount = orderTotal;
      }

      // Skip if below minimum threshold
      if (
        taxSettings.minimumOrderForTax &&
        orderTotal < taxSettings.minimumOrderForTax
      ) {
        totalSales += orderTotal;
        transactions.push({
          date: toSafeLocaleString(order.createdAt),
          orderId: order.orderId || doc.id,
          orderTotal,
          taxableAmount: 0,
          taxCollected: 0,
        });
        return;
      }

      // Calculate tax based on settings
      let taxCollected = 0;
      if (taxSettings.taxEnabled && taxSettings.taxRate > 0) {
        if (taxSettings.taxIncludedInPrice) {
          // Tax included: extract from price
          taxCollected =
            taxableAmount - taxableAmount / (1 + taxSettings.taxRate / 100);
        } else {
          // Tax added on top
          taxCollected = (taxableAmount * taxSettings.taxRate) / 100;
        }
      }

      totalSales += orderTotal;
      totalTaxableAmount += taxableAmount;
      totalTaxCollected += Math.round(taxCollected * 100) / 100;

      transactions.push({
        date: toSafeLocaleString(order.createdAt),
        orderId: order.orderId || doc.id,
        orderTotal,
        taxableAmount,
        taxCollected: Math.round(taxCollected * 100) / 100,
      });
    });

    const effectiveTaxRate =
      totalTaxableAmount > 0
        ? (totalTaxCollected / totalTaxableAmount) * 100
        : 0;

    return {
      period: { from, to },
      transactions: transactions.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
      summary: {
        totalOrders: ordersSnapshot.size,
        totalSales,
        totalTaxableAmount,
        totalTaxCollected: Math.round(totalTaxCollected * 100) / 100,
        effectiveTaxRate: Math.round(effectiveTaxRate * 100) / 100,
      },
      taxSettings: {
        taxEnabled: taxSettings.taxEnabled,
        taxName: taxSettings.taxName,
        taxRate: taxSettings.taxRate,
      },
    };
  } catch (error) {
    console.error("[ReportService] Tax Report error:", error);
    throw error;
  }
};

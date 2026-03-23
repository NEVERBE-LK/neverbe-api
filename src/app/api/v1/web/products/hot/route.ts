import { getHotProducts } from "@/services/WebProductService";
import { NextResponse } from "next/server";

export const GET = async () => {
  try {
    const products = await getHotProducts();
    // Wrap in dataList for consistency with other listing endpoints
    return NextResponse.json({ dataList: products, total: products.length }, { status: 200 });
  } catch (error: any) {
    console.error("[Hot Products API] Error:", error.message);
    return NextResponse.json(
      { success: false, message: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
};

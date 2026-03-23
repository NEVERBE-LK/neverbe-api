import { getNewArrivals } from "@/services/WebProductService";
import { NextRequest, NextResponse } from "next/server";

export const GET = async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 1);
    const size = Number(url.searchParams.get("size") || 24);
    const inStockParam = url.searchParams.get("inStock");
    const inStock =
      inStockParam === null ? undefined : inStockParam === "true";
    const brand = url.searchParams.get("brand") || undefined;
    const category = url.searchParams.get("category") || undefined;
    const gender = url.searchParams.get("gender") || undefined;
    const tags = url.searchParams.getAll("tag");
    const sizes = url.searchParams.get("sizes")?.split(",").filter(Boolean);

    const result = await getNewArrivals({
      page,
      size,
      inStock,
      brand,
      category,
      gender,
      tags: tags.length > 0 ? tags : undefined,
      sizes: sizes && sizes.length > 0 ? sizes : undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error("[New Arrivals API] Error:", error.message);
    return NextResponse.json(
      { success: false, message: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
};

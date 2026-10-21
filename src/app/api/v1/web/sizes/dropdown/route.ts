import { getSizeDropdown } from "@/services/SizeService";
import { NextResponse } from "next/server";

export const GET = async () => {
  try {
    const sizes = await getSizeDropdown();
    return NextResponse.json(sizes, { status: 200 });
  } catch (e: any) {
    console.error("[Sizes API] Failed to fetch sizes:", e.message);
    return NextResponse.json(
      { message: "Internal Server Error", error: e.message },
      { status: 500 }
    );
  }
};

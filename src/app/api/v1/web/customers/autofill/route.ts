import { verifyToken } from "@/services/WebAuthService";
import { getUserAddresses } from "@/services/CustomerService";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const token = await verifyToken(req);
    const uid = token.uid;

    const addresses = await getUserAddresses(uid);
    
    const shipping = addresses.find(a => a.type === "Shipping");
    const billing = addresses.find(a => a.type === "Billing");

    return NextResponse.json({
      shipping: shipping || null,
      billing: billing || null,
    });
  } catch (error: any) {
    console.error("Error fetching autofill data:", error);
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
}

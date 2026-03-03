// app/api/v1/koko/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyToken } from "@/services/WebAuthService";

export const POST = async (req: NextRequest) => {
  try {
    console.log("[Koko Initiate API] Incoming request");

    // --- Step 1: Verify user token ---
    const idToken = await verifyToken(req);
    console.log("[Koko Initiate API] Token verified:", idToken.uid);

    // --- Step 2: Parse request body ---
    const body = await req.json();
    const { orderId, amount, firstName, lastName, email, description } = body;
    console.log("[Koko Initiate API] Request body:", body);

    // --- Step 3: Retrieve credentials from environment ---
    const merchantId = process.env.KOKO_MERCHANT_ID;
    const apiKey = process.env.KOKO_API_KEY;
    const privateKey = process.env.KOKO_PRIVATE_KEY;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    if (!merchantId || !apiKey || !privateKey || !baseUrl || !apiUrl) {
      throw new Error("Koko credentials or base URL missing in environment.");
    }
    console.log(
      "[Koko Initiate API] Credentials and base URL loaded successfully",
    );

    // --- Step 4: Construct callback URLs ---
    const returnUrl = `${baseUrl}/checkout/success/${orderId}`;
    const cancelUrl = `${baseUrl}/checkout`;
    const responseUrl = `${apiUrl}/api/v1/web/ipg/koko/notify`;
    console.log("[Koko Initiate API] Callback URLs:", {
      returnUrl,
      cancelUrl,
      responseUrl,
    });

    // --- Step 5: Build data string (Koko v1.05) ---
    const dataString =
      merchantId +
      amount +
      "LKR" +
      "customapi" +
      "1.0.1" +
      returnUrl +
      cancelUrl +
      orderId + // _orderId
      orderId + // _reference
      firstName +
      lastName +
      email +
      description +
      apiKey +
      responseUrl;
    console.log("[Koko Initiate API] Data string constructed:", dataString);

    // --- Step 6: Sign the data string ---
    const formattedPrivateKey = privateKey.replace(/\\n/g, "\n").trim();
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(dataString, "utf8");
    signer.end();
    const signature = signer.sign(formattedPrivateKey, "base64");
    console.log("[Koko Initiate API] Signature generated:", signature);

    // --- Step 7: Prepare payload for frontend ---
    const payload = {
      _mId: merchantId,
      api_key: apiKey,
      _returnUrl: returnUrl,
      _cancelUrl: cancelUrl,
      _responseUrl: responseUrl,
      _amount: amount,
      _currency: "LKR",
      _reference: orderId,
      _orderId: orderId,
      _pluginName: "customapi",
      _pluginVersion: "1.0.1",
      _description: description,
      _firstName: firstName,
      _lastName: lastName,
      _email: email,
      dataString,
      signature,
    };

    console.log("✅ Koko initiate payload prepared:", payload);
    return NextResponse.json(payload, { status: 200 });
  } catch (error: any) {
    console.error("❌ Koko initiate error:", error.message, error.stack);
    return NextResponse.json(
      { message: "Error initiating Koko payment", error: error.message },
      { status: 500 },
    );
  }
};

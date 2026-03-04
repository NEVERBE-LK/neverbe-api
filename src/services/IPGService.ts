import crypto from "crypto";
import md5 from "crypto-js/md5";

export class IPGService {
  /**
   * Generates the payload required to initiate a Koko payment
   */
  static generateKokoPayload(body: any) {
    const { orderId, amount, firstName, lastName, email, description } = body;

    const merchantId = process.env.KOKO_MERCHANT_ID;
    const apiKey = process.env.KOKO_API_KEY;
    const privateKey = process.env.KOKO_PRIVATE_KEY;
    const baseUrl = process.env.BASE_URL;
    const apiUrl = process.env.API_URL;

    if (!merchantId || !apiKey || !privateKey || !baseUrl || !apiUrl) {
      throw new Error("Koko credentials or base URL missing in environment.");
    }

    const returnUrl = `${baseUrl}/checkout/success/${orderId}`;
    const cancelUrl = `${baseUrl}/checkout`;
    const responseUrl = `${apiUrl}/api/v1/web/ipg/koko/notify`;

    const dataString =
      merchantId +
      amount +
      "LKR" +
      "customapi" +
      "1.0.1" +
      returnUrl +
      cancelUrl +
      orderId +
      orderId +
      firstName +
      lastName +
      email +
      description +
      apiKey +
      responseUrl;

    const formattedPrivateKey = privateKey.replace(/\\n/g, "\n").trim();
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(dataString, "utf8");
    signer.end();
    const signature = signer.sign(formattedPrivateKey, "base64");

    return {
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
  }

  /**
   * Verifies a Koko payment notification
   * @returns boolean true if signature is valid
   */
  static verifyKokoNotification(
    orderId: string,
    trnId: string,
    status: string,
    signature: string,
  ): boolean {
    let kokoPublicKey = process.env.KOKO_PUBLIC_KEY;
    if (!kokoPublicKey) {
      throw new Error("Koko public key not found in environment.");
    }
    kokoPublicKey = kokoPublicKey.replace(/\\n/g, "\n").trim();

    const dataToVerify = orderId + trnId + status;

    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(dataToVerify, "utf8");
    verifier.end();

    return verifier.verify(kokoPublicKey, signature, "base64");
  }

  /**
   * Generates the payload required to initiate a PayHere payment
   */
  static generatePayHerePayload(body: any) {
    const {
      orderId,
      amount,
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      items,
      returnUrl,
      cancelUrl,
      notifyUrl,
    } = body;

    const merchantId = process.env.PAYHERE_MERCHANT_ID!;
    const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET!;
    const currency = "LKR";

    if (!merchantId || !merchantSecret) {
      throw new Error("PayHere merchant credentials missing in environment.");
    }

    const amountFormatted = parseFloat(amount)
      .toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      .replace(/,/g, "");

    const hashedSecret = md5(merchantSecret).toString().toUpperCase();
    const hash = md5(
      merchantId + orderId + amountFormatted + currency + hashedSecret,
    )
      .toString()
      .toUpperCase();

    return {
      merchant_id: merchantId,
      return_url: returnUrl,
      cancel_url: cancelUrl,
      notify_url: notifyUrl,
      order_id: orderId,
      items,
      amount: amountFormatted,
      currency,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      address,
      city,
      country: "Sri Lanka",
      hash,
    };
  }

  /**
   * Verifies a PayHere payment notification
   * @returns boolean true if signature is valid
   */
  static verifyPayHereNotification(
    merchant_id: string,
    order_id: string,
    payhere_amount: string,
    payhere_currency: string,
    status_code: string,
    md5sig: string,
  ): boolean {
    const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET!;
    if (!merchantSecret) {
      throw new Error("PayHere merchant secret missing in environment");
    }
    const hashedSecret = md5(merchantSecret).toString().toUpperCase();

    const local_md5sig = md5(
      merchant_id +
        order_id +
        payhere_amount +
        payhere_currency +
        status_code +
        hashedSecret,
    )
      .toString()
      .toUpperCase();

    return local_md5sig === md5sig;
  }
}

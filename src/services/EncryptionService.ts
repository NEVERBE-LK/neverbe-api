import CryptoJS from "crypto-js";

const getSecretKey = () =>
  process.env.ENCRYPTION_KEY;

export const encryptData = (text: string, userId: string): string => {
  if (!text || !userId) return "";
  const uniqueKey = `${getSecretKey()}-${userId}`;
  return CryptoJS.AES.encrypt(text, uniqueKey).toString();
};

export const decryptData = (ciphertext: string, userId: string): string => {
  if (!ciphertext || !userId) return "";
  try {
    const uniqueKey = `${getSecretKey()}-${userId}`;
    const bytes = CryptoJS.AES.decrypt(ciphertext, uniqueKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error("Decryption failed:", error);
    return "";
  }
};

export const encryptOrderText = (text: string | undefined | null, orderId: string): string => {
  if (text === undefined || text === null) return text as any;
  if (text === "") return "";
  if (!orderId) return text;
  const uniqueKey = `${getSecretKey()}-${orderId}`;
  return CryptoJS.AES.encrypt(text, uniqueKey).toString();
};

export const decryptOrderText = (ciphertext: string | undefined | null, orderId: string): string => {
  if (ciphertext === undefined || ciphertext === null) return ciphertext as any;
  if (ciphertext === "") return "";
  if (!orderId) return ciphertext;
  try {
    const uniqueKey = `${getSecretKey()}-${orderId}`;
    const bytes = CryptoJS.AES.decrypt(ciphertext, uniqueKey);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (decrypted) return decrypted;
    return ciphertext;
  } catch (error) {
    return ciphertext;
  }
};

export const encryptOrderCustomer = (customer: any, orderId: string): any => {
  if (!customer || !orderId) return customer;
  return {
    ...customer,
    email: encryptOrderText(customer.email, orderId),
    phone: encryptOrderText(customer.phone, orderId),
    address: encryptOrderText(customer.address, orderId),
    shippingPhone: encryptOrderText(customer.shippingPhone, orderId),
    shippingAddress: encryptOrderText(customer.shippingAddress, orderId),
  };
};

export const decryptOrderCustomer = (customer: any, orderId: string): any => {
  if (!customer || !orderId) return customer;
  return {
    ...customer,
    email: decryptOrderText(customer.email, orderId),
    phone: decryptOrderText(customer.phone, orderId),
    address: decryptOrderText(customer.address, orderId),
    shippingPhone: decryptOrderText(customer.shippingPhone, orderId),
    shippingAddress: decryptOrderText(customer.shippingAddress, orderId),
  };
};


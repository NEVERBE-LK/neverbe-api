import { adminFirestore } from "@/firebase/firebaseAdmin";
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import stringify from "json-stable-stringify";

const HASH_LEDGER_COLLECTION = "hash_ledger";

export const generateDocumentHash = (docData: any) => {
  const dataToHash = { ...docData };
  const canonicalString = stringify(dataToHash);
  const hashingString = `${canonicalString}${process.env.HASH_SECRET}`;
  const hash = crypto.createHash("sha256").update(hashingString).digest("hex");

  return hash;
};

export const validateDocumentIntegrity = async (
  collectionName: string,
  docId: string,
) => {
  try {
    const docRef = adminFirestore.collection(collectionName).doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.warn(`Document ${collectionName}/${docId} not found.`);
      return false;
    }
    const docData = doc.data();

    const ledgerId = `hash_${docId}`;
    const hashRef = adminFirestore
      .collection(HASH_LEDGER_COLLECTION)
      .doc(ledgerId);
    const hashDoc = await hashRef.get();

    if (!hashDoc.exists) {
      console.warn(`Hash ledger not found for ${collectionName}/${docId}.`);
      return false;
    }
    const storedHash = hashDoc?.data()?.hashValue;

    const currentHash = generateDocumentHash(docData);

    if (currentHash === storedHash) {
      const message = `✅ Integrity check PASSED for ${collectionName}/${docId}.`;
      console.log(message);
      return true;
    } else {
      const message = `🚨 TAMPERING DETECTED for ${collectionName}/${docId}`;
      console.warn(message);
      console.log("Stored Hash:", storedHash);
      console.log("New Hash: ", currentHash);
      return false;
    }
  } catch (error) {
    console.error(
      `Error during validation for ${collectionName}/${docId}:`,
      error,
    );
    throw error;
  }
};

export const updateOrAddOrderHash = async (data: any) => {
  try {
    const hashValue = generateDocumentHash(data);
    const ledgerId = `hash_${data.orderId}`;

    // 3. Save to the ledger
    await adminFirestore.collection(HASH_LEDGER_COLLECTION).doc(ledgerId).set(
      {
        id: ledgerId,
        hashValue: hashValue,
        sourceCollection: "orders",
        sourceDocId: data.orderId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    console.log(`Hash ledger updated/created for: ${ledgerId}`);
  } catch (error) {
    console.error(`Failed to create hash:`, error);
    throw error;
  }
};

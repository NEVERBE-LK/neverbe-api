import { adminFirestore } from "../src/firebase/firebaseAdmin";

const SMS_TEMPLATES_COLLECTION = "sms_templates";

async function updateTemplates() {
  try {
    console.log("Updating existing SMS templates to remove redundancy...");

    // 1. EBILL_SENT
    await adminFirestore.collection(SMS_TEMPLATES_COLLECTION).doc("EBILL_SENT").set({
      en: "NEVERBE: Thank you for your purchase!",
      common: "View & download your eBill here: {{ebillUrl}}",
    }, { merge: true });
    console.log("- Updated EBILL_SENT");

    // 2. STATUS_COMPLETED
    await adminFirestore.collection(SMS_TEMPLATES_COLLECTION).doc("STATUS_COMPLETED").set({
      en: "NEVERBE: Great news {{name}}! Your order #{{orderId}} is completed & shipped.",
      common: "{{trackingInfo}}",
    }, { merge: true });
    console.log("- Updated STATUS_COMPLETED");

    console.log("Templates updated successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Update failed:", error);
    process.exit(1);
  }
}

updateTemplates();

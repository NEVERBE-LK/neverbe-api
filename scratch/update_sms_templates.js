const admin = require('firebase-admin');

// Initialize with environment variables or default credentials
// Since this is running on the user's machine where the API usually runs, 
// it should have access to the service account or default credentials.
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
}

const db = admin.firestore();
const SMS_TEMPLATES_COLLECTION = "sms_templates";

async function updateTemplates() {
  try {
    console.log("Updating existing SMS templates to remove redundancy...");

    // 1. EBILL_SENT
    await db.collection(SMS_TEMPLATES_COLLECTION).doc("EBILL_SENT").set({
      en: "NEVERBE: Thank you for your purchase!",
      si: "NEVERBE: ඔබගේ මිලදී ගැනීමට ස්තූතියි!",
      ta: "உங்கள் கொள்முதலுக்கு நன்றி!",
      common: "View & download your eBill here: {{ebillUrl}}",
    }, { merge: true });
    console.log("- Updated EBILL_SENT");

    // 2. STATUS_COMPLETED
    await db.collection(SMS_TEMPLATES_COLLECTION).doc("STATUS_COMPLETED").set({
      en: "NEVERBE: Great news {{name}}! Your order #{{orderId}} is completed & shipped.",
      si: "NEVERBE: සුභ ආරංචියක් {{name}}! ඔබගේ ඇණවුම #{{orderId}} දැන් සම්පූර්ණ කර එවා ඇත.",
      ta: "நற்செயி {{name}}! உங்கள் ஆர்டர் #{{orderId}} முடிக்கப்பட்டு அனுப்பப்பட்டது.",
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

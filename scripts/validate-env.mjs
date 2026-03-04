import { existsSync } from "fs";

// In local development, load .env file if it exists.
// In Firebase App Hosting (Cloud Build / Cloud Run), secrets are already
// injected into process.env directly — no .env file exists there.
if (existsSync(".env")) {
  const dotenv = await import("dotenv");
  dotenv.config();
  console.log("[validate-env] Loaded variables from .env (local development)");
} else {
  console.log("[validate-env] No .env file found — using injected environment (production)");
}

// Public env vars available at BUILD time (set in apphosting.yaml env: block)
const requiredBuildVars = [
  "BASE_URL",
  "API_URL",
  "ALGOLIA_APP_ID",
  "ALGOLIA_SEARCH_API_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
];

// Secrets that are only available at RUNTIME (injected by Cloud Run, not at build time)
// These are checked separately and only warn — they are validated at runtime by the services themselves.
const runtimeSecrets = [
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "TEXT_API_KEY",
  "HASH_SECRET",
  "KOKO_MERCHANT_ID",
  "KOKO_API_KEY",
  "KOKO_PRIVATE_KEY",
  "KOKO_PUBLIC_KEY",
  "RECAPTCHA_SECRET_KEY",
  "PAYHERE_MERCHANT_SECRET",
  "PAYHERE_MERCHANT_ID",
  "GEMINI_API_KEY",
];

const missingBuildVars = requiredBuildVars.filter((v) => !process.env[v]);

if (missingBuildVars.length > 0) {
  console.error(
    `\n🚨 BUILD FAILED: Missing required public environment variables:\n` +
    missingBuildVars.map((v) => `   - ${v}`).join("\n") +
    `\nThese must be set in the env: section of apphosting.yaml.\n`
  );
  process.exit(1);
}

console.log("✅ All required build-time environment variables are present.\n");

// Log public vars
console.log("--- Public Env Vars (BUILD) ---");
for (const envVar of requiredBuildVars) {
  const val = process.env[envVar] || "";
  const last3 = val.length >= 3 ? val.slice(-3) : val;
  console.log(`  ${envVar}: ****${last3}`);
}

// Log runtime secrets (may be empty at build time — that's expected)
console.log("\n--- Runtime Secrets (available after deploy) ---");
for (const envVar of runtimeSecrets) {
  const val = process.env[envVar] || "";
  if (val) {
    const last3 = val.length >= 3 ? val.slice(-3) : val;
    console.log(`  ${envVar}: ****${last3}`);
  } else {
    console.log(`  ${envVar}: (will be injected at runtime)`);
  }
}
console.log("------------------------------------------------\n");

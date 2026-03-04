import React from "react";
import { adminFirestore, adminAuth } from "@/firebase/firebaseAdmin";

export const dynamic = "force-dynamic";

async function checkDatabase() {
  try {
    // Simple read operation to verify Firestore connectivity
    await adminFirestore.collection("_health_check_").limit(1).get();
    return "Connected";
  } catch (error) {
    console.error("Firestore health check failed:", error);
    return "Disconnected";
  }
}

async function checkAuth() {
  try {
    // Simple read operation to verify Auth connectivity
    await adminAuth.listUsers(1);
    return "Active";
  } catch (error) {
    console.error("Auth health check failed:", error);
    return "Disconnected";
  }
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

function formatMemory(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

// Next.js Server Component
export default async function Home() {
  const envStatus =
    process.env.NODE_ENV === "production" ? "Production" : "Development";
  const projectId = process.env.FIREBASE_PROJECT_ID || "Unknown Project";

  // Perform health checks concurrently
  const [dbStatus, authStatus] = await Promise.all([
    checkDatabase(),
    checkAuth(),
  ]);

  const isSystemOnline = dbStatus === "Connected" && authStatus === "Active";
  const nodeVersion = process.version;
  const memoryUsage = formatMemory(process.memoryUsage().rss);
  const uptime = formatUptime(process.uptime());
  const serverTime =
    new Date().toLocaleTimeString("en-US", {
      timeZone: "UTC",
      timeStyle: "short",
    }) + " UTC";

  return (
    <main className="w-full max-w-4xl bg-gray-900 border border-gray-800 rounded-3xl p-8 sm:p-12 shadow-2xl relative overflow-hidden">
      {/* Background Decorative Glow */}
      <div className="absolute top-0 right-0 -mr-24 -mt-24 w-64 h-64 bg-green-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-24 -mb-24 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-gray-800 pb-8 mb-8 gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white uppercase mb-2">
              NEVERBE API
            </h1>
            <p className="text-gray-400 text-sm sm:text-base font-medium font-mono">
              Core Backend Services v1.0
            </p>
          </div>
          <div
            className={`flex items-center gap-3 bg-gray-800/50 px-4 py-2 rounded-full border border-gray-700/50 shadow-inner ${isSystemOnline ? "" : "opacity-80 border-red-900/50"}`}
          >
            {isSystemOnline ? (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
            ) : (
              <span className="relative flex h-3 w-3">
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
            )}
            <span
              className={`${isSystemOnline ? "text-green-400" : "text-red-400"} text-sm font-bold tracking-wider uppercase`}
            >
              {isSystemOnline ? "System Online" : "System Degraded"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Row 1 */}
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Environment
            </p>
            <p className="text-white text-base sm:text-lg font-semibold">
              {envStatus}
            </p>
          </div>
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Database
            </p>
            <p
              className={`${dbStatus === "Connected" ? "text-white" : "text-red-400"} text-base sm:text-lg font-semibold`}
            >
              {dbStatus}
            </p>
          </div>
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Firebase Auth
            </p>
            <p
              className={`${authStatus === "Active" ? "text-white" : "text-red-400"} text-base sm:text-lg font-semibold`}
            >
              {authStatus}
            </p>
          </div>
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Data Node
            </p>
            <p
              className="text-white text-base sm:text-lg font-semibold truncate"
              title={projectId}
            >
              {projectId}
            </p>
          </div>

          {/* Row 2 */}
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Node.js
            </p>
            <p className="text-white text-base sm:text-lg font-mono">
              {nodeVersion}
            </p>
          </div>
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Memory Usage
            </p>
            <p className="text-white text-base sm:text-lg font-mono">
              {memoryUsage}
            </p>
          </div>
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Uptime
            </p>
            <p className="text-white text-base sm:text-lg font-mono">
              {uptime}
            </p>
          </div>
          <div className="bg-gray-800/30 rounded-2xl p-5 border border-gray-800/80 hover:bg-gray-800/50 transition-colors">
            <p className="text-gray-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1">
              Server Time
            </p>
            <p className="text-white text-base sm:text-lg font-mono">
              {serverTime}
            </p>
          </div>
        </div>

        <div className="mt-12 text-center border-t border-gray-800 pt-8">
          <p className="text-gray-600 text-xs font-medium tracking-widest uppercase">
            Restricted System • Unauthorized access is strictly prohibited
          </p>
        </div>
      </div>
    </main>
  );
}

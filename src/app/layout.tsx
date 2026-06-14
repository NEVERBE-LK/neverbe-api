import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neverbe API Server",
  description: "Core backend server for Neverbe E-commerce and POS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-gray-950 text-gray-50 flex flex-col items-center justify-center p-4">
        {children}
      </body>
    </html>
  );
}

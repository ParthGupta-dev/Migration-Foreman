import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Migration Foreman",
  description: "Autonomous, test-verified code migration campaigns",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-slate-800 px-6 py-4">
            <h1 className="text-lg font-semibold tracking-tight">
              Migration Foreman
            </h1>
          </header>
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}

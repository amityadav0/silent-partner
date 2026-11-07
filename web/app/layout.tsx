import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";

export const metadata: Metadata = { title: "Silent Partner", description: "Private copy-trading vaults on NEAR Confidential Intents." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}

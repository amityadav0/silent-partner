import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Footer, Nav } from "./ui";

export const metadata: Metadata = { title: "Silent Partner", description: "Copy the trader, not the crowd. Private copy-trading vaults on NEAR Confidential Intents." };

// Built into the static export, so visitors make no request to a font provider.
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Runs before first paint: the stored choice, else the system preference, else light.
const THEME_BOOT = `(function(){var t;try{t=localStorage.getItem("sp.theme")}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <WalletProvider>
          <Nav />
          <main className="pb-16 pt-2">{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}

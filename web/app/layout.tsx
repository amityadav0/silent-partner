import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Footer, Nav } from "./ui";
import { Onboard } from "./onboard";
import { Welcome } from "./welcome";

const SITE = "https://amityadav0.github.io/silent-partner";
const DESCRIPTION = "Copy the trader, not the crowd. Private copy-trading vaults on NEAR Confidential Intents: same trade, same price, nothing to front-run.";
export const metadata: Metadata = {
  title: "Silent Partner",
  description: DESCRIPTION,
  openGraph: { title: "Silent Partner: copy the trader, not the crowd", description: DESCRIPTION, url: `${SITE}/`, siteName: "Silent Partner", images: [{ url: `${SITE}/og.png`, width: 1200, height: 630, alt: "A trade ticket stamped SEALED, every field redacted" }] },
  twitter: { card: "summary_large_image", title: "Silent Partner: copy the trader, not the crowd", description: DESCRIPTION, images: [`${SITE}/og.png`] },
};

// Built into the static export, so visitors make no request to a font provider.
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Runs before first paint: the stored choice, else light (the stronger look, and it matches the X cards).
const THEME_BOOT = `(function(){var t;try{t=localStorage.getItem("sp.theme")}catch(e){}document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <WalletProvider>
          <Nav />
          <Onboard />
          <main className="pb-16 pt-2">{children}</main>
          <Footer />
          <Welcome />
        </WalletProvider>
      </body>
    </html>
  );
}

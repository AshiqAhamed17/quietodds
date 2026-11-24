import type { Metadata, Viewport } from "next";
import { Playfair_Display, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/SiteFooter";

const serif = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://quietodds.vercel.app";
const DESCRIPTION =
  "Private prediction markets on Ethereum. Bet, swap and claim with zero-knowledge proofs, so nobody sees your bet.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "QuietOdds · Private prediction markets", template: "%s · QuietOdds" },
  description: DESCRIPTION,
  applicationName: "QuietOdds",
  openGraph: { type: "website", siteName: "QuietOdds", title: "QuietOdds · Private prediction markets", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "QuietOdds · Private prediction markets", description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#050506", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <Nav />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}

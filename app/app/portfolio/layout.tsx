import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Your private balance, open bets and winnings, rebuilt in your browser from your viewing key.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Swap",
  description: "Swap ETH and USDC on Uniswap v4, shield part of it into your private balance, and add a private bet.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

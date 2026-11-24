import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Deposit & withdraw",
  description: "Move USDC or ETH into the shielded pool, and withdraw privately to any address.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

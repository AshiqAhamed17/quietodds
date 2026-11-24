import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Batch swaps",
  description: "Join a private batch swap: one trade for everyone, at a Chainlink-checked price, claimed privately.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

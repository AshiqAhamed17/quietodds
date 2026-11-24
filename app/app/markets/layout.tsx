import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Markets",
  description: "Live prediction markets on football, F1 and crypto prices. Odds are public; who bet what stays private.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IS_TESTNET, NETWORK_LABEL, REPO } from "@/lib/contract";

const LINKS = [
  { href: `${REPO}#readme`, label: "Docs", external: true },
  { href: "/verified", label: "Security", external: false },
  { href: `${REPO}/blob/main/docs/threat-model.md`, label: "Threat model", external: true },
  { href: REPO, label: "GitHub", external: true },
];

/// Links + network line, shared by every page's footer.
export function FooterBar() {
  return (
    <>
      <div className="wrap foot-links">
        {LINKS.map((l) =>
          l.external ? (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
              {l.label} ↗
            </a>
          ) : (
            <Link key={l.label} href={l.href}>
              {l.label}
            </Link>
          ),
        )}
      </div>
      <div className="wrap foot-btm">
        <span>© {new Date().getFullYear()} QuietOdds</span>
        <span>{IS_TESTNET ? `Public beta on ${NETWORK_LABEL} · no real funds` : "Public beta · not audited"}</span>
      </div>
    </>
  );
}

/// Compact footer for app pages. The landing page has its own with the wordmark.
export function SiteFooter() {
  const path = usePathname();
  if (path === "/") return null;
  return (
    <footer className="site-foot">
      <FooterBar />
    </footer>
  );
}

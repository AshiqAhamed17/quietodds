import { MarketList } from "@/components/MarketList";
import { AmbientField } from "@/components/AmbientField";
import { Explainer } from "@/components/Explainer";
import { DEPLOYMENT, REPO, explorerAddress } from "@/lib/contract";

export default function MarketsPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
      <p className="eyebrow">On Sepolia</p>
      <h1>Markets</h1>
      <p className="lead">
        Odds are public, bettors aren&apos;t. Every bet comes from a shielded balance through a relayer, and every
        market is settled by a Chainlink CRE workflow or a Chainlink price feed.
      </p>
        <Explainer
          title="How QuietOdds markets work"
          steps={[
            <><b>Deposit once</b>: USDC goes into the shielded pool as a hidden note (or shield it mid-swap through our Uniswap hook).</>,
            <><b>Bet privately</b>: your browser proves you own a note; a relayer submits the bet. On chain it&apos;s just &quot;someone bet X on side Y&quot;.</>,
            <><b>Resolve</b>: after close, a Chainlink CRE workflow fetches the result (ESPN, or a Chainlink feed) under DON consensus and settles it.</>,
            <><b>Claim</b>: winners prove a winning position in zero knowledge and get a hidden balance note; withdraw to any fresh address.</>,
          ]}
          links={[
            { label: "Markets", href: explorerAddress(DEPLOYMENT.markets) },
            { label: "ShieldedPool", href: explorerAddress(DEPLOYMENT.pool) },
            { label: "Source", href: REPO },
          ]}
        />
        <MarketList />
      </main>
    </>
  );
}

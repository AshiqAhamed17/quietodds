"use client";

import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { CHAIN } from "@/lib/contract";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <button className="btn primary" onClick={() => connect({ connector: connectors[0] })} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== CHAIN.id) {
    return (
      <button className="btn" onClick={() => switchChain({ chainId: CHAIN.id })}>
        Switch to Sepolia
      </button>
    );
  }

  const short = `${address!.slice(0, 6)}…${address!.slice(-4)}`;
  const hue = 200 + (parseInt(address!.slice(2, 6), 16) % 60);
  return (
    <div className="wallet-cluster">
      <button className="btn wallet-chip" onClick={() => disconnect()} title="Disconnect">
        <span className="wallet-dot" style={{ background: `hsl(${hue} 70% 70%)` }} />
        <span className="mono">{short}</span>
      </button>
    </div>
  );
}

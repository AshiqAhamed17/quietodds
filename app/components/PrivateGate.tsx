"use client";

import { useAccount } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { usePrivateAccount } from "./PrivateAccount";

/// Children render only once the wallet is connected and the private account
/// unlocked and scanned. Otherwise it shows the next step.
export function PrivateGate({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  const { isConnected } = useAccount();
  const acct = usePrivateAccount();
  if (!isConnected) {
    return (
      <div className="gate">
        <p className="hint">Connect your wallet to act privately.</p>
        <ConnectButton />
      </div>
    );
  }
  if (!acct.keys) {
    return (
      <div className="gate">
        {!compact && (
          <p className="hint">
            Sign once (no gas) to unlock your private account. Your keys stay in this tab&apos;s memory.
          </p>
        )}
        <div className="sides">
          <button className="btn primary" onClick={() => void acct.unlock()} disabled={acct.unlocking}>
            {acct.unlocking ? "Waiting…" : "Unlock private account"}
          </button>
          <button className="btn" onClick={() => void acct.unlockWithPasskey().catch((e) => alert(e.message))} disabled={acct.unlocking}>
            Use a passkey
          </button>
        </div>
      </div>
    );
  }
  if (acct.scan.phase !== "done" && acct.notes.length === 0) {
    return (
      <div className="gate">
        <p className="hint mono">{acct.scan.error ?? acct.scan.detail ?? "Scanning…"}</p>
        <div className="scanbar-track">
          <div className="scanbar-fill" style={{ width: `${Math.round(acct.scan.progress * 100)}%` }} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

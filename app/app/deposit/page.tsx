"use client";

import { useState } from "react";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { ASSET, deriveNote, encryptNote } from "@quietodds/lib";
import { AmbientField } from "@/components/AmbientField";
import { ActionStatus, useAction } from "@/components/ActionStatus";
import { PrivateGate } from "@/components/PrivateGate";
import { usePrivateAccount } from "@/components/PrivateAccount";
import { DEPLOYMENT, erc20Abi, explorerAddress, shieldedPoolAbi } from "@/lib/contract";
import { relayedSpend } from "@/lib/private";

const ASSETS = [
  { id: ASSET.USDC, label: "USDC", decimals: 6, token: DEPLOYMENT.usdc },
  { id: ASSET.WETH, label: "WETH", decimals: 18, token: DEPLOYMENT.weth },
] as const;

const wethAbi = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const;
const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: d === 6 ? 2 : 6 });

export default function DepositPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Shielded pool</p>
        <h1>Deposit &amp; withdraw</h1>
        <p className="lead">
          Depositing is public (your wallet sends tokens to the pool). Everything after it is private: bets, swaps,
          claims and withdrawals spend hidden notes through the relayer. Withdraw to a fresh address and nothing links it
          back to the deposit.
        </p>
        <PrivateGate>
          <div className="two-col">
            <Deposit />
            <Withdraw />
          </div>
        </PrivateGate>
      </main>
    </>
  );
}

function Deposit() {
  const acct = usePrivateAccount();
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [asset, setAsset] = useState(0);
  const [amount, setAmount] = useState("2");
  const { state, run } = useAction();
  const a = ASSETS[asset];

  const { data: wallet, refetch } = useReadContracts({
    contracts: ASSETS.map((x) => ({ abi: erc20Abi, address: x.token, functionName: "balanceOf" as const, args: [address!] as const })),
    query: { enabled: !!address },
  });
  const balance = (wallet?.[asset]?.result as bigint | undefined) ?? 0n;

  const wait = async (hash: `0x${string}`) => {
    const r = await client!.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
    return r;
  };

  const deposit = () =>
    run(async (onStep) => {
      const value = parseUnits(amount, a.decimals);
      if (value <= 0n) throw new Error("Enter an amount");
      const have = await client!.readContract({ abi: erc20Abi, address: a.token, functionName: "balanceOf", args: [address!] });
      if (value > have) throw new Error(`Your wallet has ${fmt(have, a.decimals)} ${a.label}`);
      onStep("sync");
      const fresh = await acct.sync();
      const index = acct.reserveIndices(fresh.notes, 1);
      const note = deriveNote(acct.keys!, index);
      const ct = await encryptNote(acct.keys!.viewingKey, { kind: "balance", index, asset: a.id, amount: value });
      onStep("relay");
      const allowance = await client!.readContract({ abi: erc20Abi, address: a.token, functionName: "allowance", args: [address!, DEPLOYMENT.pool] });
      if (allowance < value) {
        await wait(await writeContractAsync({ abi: erc20Abi, address: a.token, functionName: "approve", args: [DEPLOYMENT.pool, value] }));
      }
      const hash = await writeContractAsync({
        abi: shieldedPoolAbi,
        address: DEPLOYMENT.pool,
        functionName: "deposit",
        args: [a.id, value, note.precommitment, ct],
      });
      await wait(hash);
      void refetch();
      void acct.rescan();
      return { txHash: hash, summary: `Deposited ${amount} ${a.label} into your private balance.` };
    });

  const wrap = () =>
    run(async (onStep) => {
      onStep("relay");
      const hash = await writeContractAsync({ abi: wethAbi, address: DEPLOYMENT.weth, functionName: "deposit", value: parseUnits(amount, 18) });
      await wait(hash);
      void refetch();
      return { txHash: hash, summary: `Wrapped ${amount} ETH to WETH. Now deposit it.` };
    });

  return (
    <section className="panel">
      <h2>Deposit</h2>
      <div className="form">
        <div className="sides">
          {ASSETS.map((x, i) => (
            <button key={x.label} className={`btn ${asset === i ? "on" : ""}`} onClick={() => setAsset(i)}>
              {x.label}
            </button>
          ))}
        </div>
        <label>
          Amount · wallet {fmt(balance, a.decimals)} {a.label}
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button className="btn primary" onClick={() => void deposit()} disabled={state.busy}>
          {state.busy ? "Working…" : `Deposit ${amount || 0} ${a.label}`}
        </button>
        {a.id === ASSET.WETH && (
          <button className="btn" onClick={() => void wrap()} disabled={state.busy}>
            Wrap {amount || 0} ETH → WETH first
          </button>
        )}
        <p className="hint">
          Public: your wallet and the amount. The note it creates is a commitment only your keys can open, with an encrypted
          backup so you can always recover it. Need test USDC? Circle&apos;s faucet (faucet.circle.com) or swap on our pool.
        </p>
        <a className="doclink mono" href={explorerAddress(DEPLOYMENT.pool)} target="_blank" rel="noreferrer">
          ShieldedPool ↗
        </a>
        <ActionStatus state={state} steps={{ sync: "Picking your next note through Anon-RPC", relay: "Confirm in your wallet (approve, then deposit)" }} />
      </div>
    </section>
  );
}

function Withdraw() {
  const acct = usePrivateAccount();
  const [asset, setAsset] = useState(0);
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const { state, run } = useAction();
  const a = ASSETS[asset];
  const priv = asset === 0 ? acct.balances.usdc : acct.balances.weth;

  const withdraw = () =>
    run(async (onStep) => {
      if (!isAddress(to)) throw new Error("Enter the address to withdraw to");
      const r = await relayedSpend({
        account: acct,
        asset: a.id,
        amount: amount.trim() === "" || amount === "max" ? "max" : parseUnits(amount, a.decimals),
        action: { type: "withdraw", recipient: to as Address },
        onStep,
      });
      return { txHash: r.txHash, summary: `Sent ${fmt(r.amount, a.decimals)} ${a.label} to ${to.slice(0, 8)}…; relayer fee ${fmt(r.fee, a.decimals)}.` };
    });

  return (
    <section className="panel" id="withdraw">
      <h2>Withdraw privately</h2>
      <div className="form">
        <div className="sides">
          {ASSETS.map((x, i) => (
            <button key={x.label} className={`btn ${asset === i ? "on" : ""}`} onClick={() => setAsset(i)}>
              {x.label}
            </button>
          ))}
        </div>
        <label>
          Amount (empty = whole largest note) · private {fmt(priv, a.decimals)} {a.label}
          <input inputMode="decimal" value={amount} placeholder="max" onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          To address (use a fresh one)
          <input value={to} placeholder="0x…" onChange={(e) => setTo(e.target.value.trim())} />
        </label>
        <button className="btn primary" onClick={() => void withdraw()} disabled={state.busy}>
          {state.busy ? "Working…" : `Withdraw ${a.label}`}
        </button>
        <p className="hint">
          The relayer sends it, so your depositing wallet never appears. The recipient and fee are bound into the proof: the
          relayer can&apos;t redirect the funds.
        </p>
        <ActionStatus state={state} />
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { BetQueueList } from "@/components/BetQueue";
import { Switch } from "@/components/Switch";
import { ApiSwap } from "@/components/ApiSwap";
import { betQueue } from "@/lib/betQueue";
import { formatEther, formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import {
  ASSET,
  MAX_PRICE_LIMIT,
  MIN_PRICE_LIMIT,
  deriveNote,
  encryptNote,
  poolSwapTestAbi,
  shieldHookData,
} from "@quietodds/lib";
import { AmbientField } from "@/components/AmbientField";
import { ActionStatus, useAction } from "@/components/ActionStatus";
import { PrivateGate } from "@/components/PrivateGate";
import { usePrivateAccount } from "@/components/PrivateAccount";
import { DEPLOYMENT, Status, erc20Abi, explorerAddress } from "@/lib/contract";
import { isClosed, useMarkets } from "@/hooks/useMarkets";
import { usdc } from "@/lib/format";

/// Uniswap's v4 Quoter on Sepolia: simulates the swap through our hook (fee rule included).
const QUOTER = "0x68aFa8b853cAa7a2D40B0F6AEE5C4DbC147C8244" as const;
const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const key = DEPLOYMENT.poolKey;
const BET_FEE = 50_000n; // relayer's bet fee floor (0.05 USDC)


export default function SwapPage() {
  return (
    <>
      <AmbientField />
      <main className="wrap page">
        <p className="eyebrow">Uniswap v4 · QuietOddsHook</p>
        <h1>Swap, shield, bet</h1>
        <p className="lead">
          Swap ETH and USDC on our hooked Uniswap v4 pool. Toggle <b>Shield</b> and the hook moves part of the USDC
          straight into your private balance in the same swap. Toggle <b>Add a bet</b> and that private USDC is bet a random
          1–10 minutes later through the relayer, so the bet can&apos;t be matched to your swap.
        </p>
        <PrivateGate>
          <SwapForm />
        </PrivateGate>
      </main>
    </>
  );
}

function SwapForm() {
  const acct = usePrivateAccount();
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { markets } = useMarkets();
  const open = useMemo(() => markets.filter((m) => m.status === Status.Open && !isClosed(m)), [markets]);

  const [usdcIn, setUsdcIn] = useState(true);
  const [amount, setAmount] = useState("3");
  const [shieldOn, setShieldOn] = useState(true);
  const [shield, setShield] = useState("1");
  const [betOn, setBetOn] = useState(false);
  const [marketId, setMarketId] = useState<string>("");
  const [side, setSide] = useState(0);
  const { state, run } = useAction();

  const market = open.find((m) => m.id.toString() === marketId) ?? open[0];

  const parse = (v: string, d: number) => {
    try {
      return v ? parseUnits(v, d) : 0n;
    } catch {
      return 0n;
    }
  };
  const amountIn = parse(amount, usdcIn ? 6 : 18);
  const shieldAmt = shieldOn ? parse(shield, 6) : 0n;

  // Quote what the pool swaps: with USDC in, the shield is carved from the input first.
  const swapped = usdcIn ? amountIn - shieldAmt : amountIn;
  const { data: quoteOut, error: quoteError } = useQuery({
    queryKey: ["quote", usdcIn, swapped.toString()],
    enabled: !!client && swapped > 0n,
    queryFn: async () => {
      const { result } = await client!.simulateContract({
        address: QUOTER,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ poolKey: key, zeroForOne: !usdcIn, exactAmount: swapped, hookData: "0x" }],
      });
      return result[0];
    },
  });
  const receive = quoteOut === undefined ? undefined : usdcIn ? quoteOut : quoteOut - shieldAmt;

  const swap = () =>
    run(async (onStep) => {
      if (amountIn <= 0n) throw new Error("Enter an amount");
      if (shieldOn && shieldAmt <= 0n) throw new Error("Enter how much USDC to shield");
      if (usdcIn && shieldAmt >= amountIn) throw new Error("The shield must be less than the USDC you swap");
      if (!usdcIn && receive !== undefined && receive <= 0n) throw new Error("The shield is more than the swap's USDC output");
      if (betOn && shieldAmt <= BET_FEE) throw new Error("Shield more than the 0.05 USDC relayer fee to bet");
      if (betOn && !market) throw new Error("No open market to bet on");

      let hookData: `0x${string}` = "0x";
      if (shieldOn) {
        onStep("sync");
        const fresh = await acct.sync();
        const index = acct.reserveIndices(fresh.notes, 1);
        const note = deriveNote(acct.keys!, index);
        const ct = await encryptNote(acct.keys!.viewingKey, { kind: "balance", index, asset: ASSET.USDC, amount: shieldAmt });
        hookData = shieldHookData(shieldAmt, note.precommitment, ct);
      }

      onStep("relay");
      if (usdcIn) {
        const allowance = await client!.readContract({ abi: erc20Abi, address: DEPLOYMENT.usdc, functionName: "allowance", args: [address!, DEPLOYMENT.poolSwapTest] });
        if (allowance < amountIn) {
          const h = await writeContractAsync({ abi: erc20Abi, address: DEPLOYMENT.usdc, functionName: "approve", args: [DEPLOYMENT.poolSwapTest, amountIn] });
          await client!.waitForTransactionReceipt({ hash: h });
        }
      }
      const hash = await writeContractAsync({
        address: DEPLOYMENT.poolSwapTest,
        abi: poolSwapTestAbi,
        functionName: "swap",
        args: [
          key,
          { zeroForOne: !usdcIn, amountSpecified: -amountIn, sqrtPriceLimitX96: usdcIn ? MAX_PRICE_LIMIT : MIN_PRICE_LIMIT },
          { takeClaims: false, settleUsingBurn: false },
          hookData,
        ],
        value: usdcIn ? 0n : amountIn,
      });
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Swap reverted: ${hash}`);
      void acct.rescan();

      if (betOn && market) {
        const delay = 60_000 + Math.floor(Math.random() * 9 * 60_000);
        betQueue.add(address!, {
          market: market.id.toString(),
          question: market.question,
          side,
          sideLabel: market.outcomes[side],
          amount: (shieldAmt - BET_FEE).toString(),
          dueAt: Date.now() + delay,
        });
      }
      return {
        txHash: hash,
        summary: shieldOn
          ? `Swapped and shielded ${usdc(shieldAmt)} into your private balance.${betOn ? " Your private bet is queued below." : ""}`
          : "Swapped.",
      };
    });

  return (
    <div className="two-col">
      <section className="panel">
        <h2>Swap</h2>
        <div className="form">
          <div className="sides">
            <button className={`btn ${usdcIn ? "on" : ""}`} onClick={() => { setUsdcIn(true); setAmount("3"); }}>
              USDC → ETH
            </button>
            <button className={`btn ${!usdcIn ? "on" : ""}`} onClick={() => { setUsdcIn(false); setAmount("0.002"); }}>
              ETH → USDC
            </button>
          </div>
          <label>
            You pay ({usdcIn ? "USDC" : "ETH"})
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>

          <Switch
            checked={shieldOn}
            onChange={(on) => { setShieldOn(on); if (!on) setBetOn(false); }}
            title="Shield USDC into my private balance"
            detail="The hook turns part of the swap into a private note, in the same transaction."
          />
          {shieldOn && (
            <label>
              Shield amount (USDC) · {usdcIn ? "taken from what you pay" : "taken from the USDC you receive"}
              <input inputMode="decimal" value={shield} onChange={(e) => setShield(e.target.value)} />
            </label>
          )}

          <Switch
            checked={betOn}
            disabled={!shieldOn}
            onChange={setBetOn}
            title="Add a private bet with the shielded USDC"
            detail={shieldOn ? "Sent by the relayer 1–10 minutes later, so it can't be matched to this swap." : "Turn on shielding first."}
          />
          {betOn && (
            <>
              <label>
                Market
                <select value={market?.id.toString() ?? ""} onChange={(e) => { setMarketId(e.target.value); setSide(0); }}>
                  {open.map((m) => (
                    <option key={m.id.toString()} value={m.id.toString()}>
                      {m.question}
                    </option>
                  ))}
                </select>
              </label>
              {market && (
                <div className="sides">
                  {market.outcomes.map((o, i) => (
                    <button key={o} className={`btn ${side === i ? "on" : ""}`} onClick={() => setSide(i)}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="kv">
            <span>You receive (to your wallet)</span>
            <b>
              {quoteError
                ? "no quote"
                : receive === undefined
                  ? "…"
                  : usdcIn
                    ? `${Number(formatEther(receive)).toFixed(6)} ETH`
                    : `${Number(formatUnits(receive > 0n ? receive : 0n, 6)).toFixed(2)} USDC`}
            </b>
          </div>
          {shieldOn && (
            <div className="kv">
              <span>Into your private balance</span>
              <b>{usdc(shieldAmt)}</b>
            </div>
          )}
          {betOn && market && (
            <div className="kv">
              <span>Private bet, 1–10 min later</span>
              <b>
                {usdc(shieldAmt > BET_FEE ? shieldAmt - BET_FEE : 0n)} on {market.outcomes[side]}
              </b>
            </div>
          )}
          <button className="btn primary" onClick={() => void swap()} disabled={state.busy}>
            {state.busy ? "Working…" : betOn ? "Swap, shield and queue bet" : shieldOn ? "Swap and shield" : "Swap"}
          </button>
          <ActionStatus state={state} steps={{ sync: "Building your private note", relay: "Confirm the swap in your wallet" }} />
          {!shieldOn && <ApiSwap usdcIn={usdcIn} amountIn={amountIn} ourOut={receive} />}
        </div>
      </section>

      <section className="panel">
        <h2>What the chain sees</h2>
        <p className="hint">
          <b>The swap</b> (from your wallet): you swapped and shielded some USDC. No market, no side.
        </p>
        <p className="hint">
          <b>The bet</b> (from the relayer, minutes later): someone bet on a side. No wallet.
        </p>
        <p className="hint">
          The hook also makes same-block sandwiches unprofitable: a block-start guard and a directional fee that charges the
          back-run the size of the price move, paid to LPs.
        </p>
        <a className="doclink mono" href={explorerAddress(DEPLOYMENT.hook)} target="_blank" rel="noreferrer">
          QuietOddsHook ↗
        </a>
        <BetQueueList />
      </section>
    </div>
  );
}

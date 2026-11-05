// The relayer pays gas for spends and redeems, so a user's wallet never
// appears next to their bets. It is untrusted: the proof binds its address
// and fee, so it can only submit a call exactly as the user built it, or
// refuse. Everything here is about refusing early and cheaply.
import {
  BaseError, ContractFunctionRevertedError, parseAbi, zeroAddress, type Account, type Address, type Chain,
  type Hex, type PublicClient, type Transport, type WalletClient,
} from "viem";
import {
  ACTION, ASSET, TAG, marketsAbi, redeemPublicInputs, shieldedPoolAbi, spendPublicInputs,
  type RedeemArgs, type RedeemTerms, type SpendArgs,
} from "@quietodds/lib";
import type { CircuitName, Prover } from "@quietodds/lib/prover";
import type { FeePolicy } from "./config.ts";

export class RelayError extends Error {
  constructor(public status: 400 | 409 | 500 | 503, message: string) {
    super(message);
  }
}

export interface SpendRequest {
  args: SpendArgs;
  proof: Hex;
  changeCiphertext: Hex;
  outCiphertext: Hex;
}

export interface RedeemRequest {
  args: RedeemArgs;
  proof: Hex;
  outCiphertext: Hex;
}

export interface RelayResult {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: string;
  gasUsed: string;
}

export interface Quote {
  relayer: Address;
  chainId: number;
  gasPrice: string;
  validForSeconds: number;
  /** Minimum fee per call kind, in the asset's base units. */
  fees: { withdraw: { usdc: string; weth: string }; bet: { usdc: string }; redeem: { usdc: string } };
}

/** Pool backups are a few hundred bytes; cap them so calldata stays cheap. */
const MAX_CIPHERTEXT_BYTES = 1024;
const QUOTE_TTL_MS = 15_000;

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);

export interface RelayerDeps {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  prover: Prover;
  pool: Address;
  markets: Address;
  ethUsdFeed?: Address;
  fees: FeePolicy;
  log?: (line: string) => void;
}

export function createRelayer(d: RelayerDeps) {
  const account = d.walletClient.account;
  const log = d.log ?? ((line: string) => console.log(line));
  const inFlight = new Set<bigint>();
  let queue: Promise<unknown> = Promise.resolve();
  let cached: { at: number; quote: Quote; raw: Record<string, bigint> } | undefined;

  async function gasPrice() {
    const block = await d.publicClient.getBlock();
    return (block.baseFeePerGas ?? 0n) * 2n + d.fees.priorityFee;
  }

  async function ethUsd8(): Promise<bigint> {
    if (d.ethUsdFeed) {
      try {
        const [, answer] = await d.publicClient.readContract({ address: d.ethUsdFeed, abi: feedAbi, functionName: "latestRoundData" });
        if (answer > 0n) return answer;
      } catch {
        // fall through to the fallback price
      }
    }
    return d.fees.ethUsdFallback * 10n ** 8n;
  }

  async function quoteRaw() {
    if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached;
    const [price, usd] = await Promise.all([gasPrice(), ethUsd8()]);
    const wei = (gas: bigint) => (gas * price * d.fees.marginBps) / 10_000n;
    const usdc = (gas: bigint) => {
      const v = (wei(gas) * usd) / 10n ** 20n; // wei * $/ETH(8dp) -> USDC(6dp)
      return v > d.fees.minUsdc ? v : d.fees.minUsdc;
    };
    const weth = (gas: bigint) => (wei(gas) > d.fees.minWeth ? wei(gas) : d.fees.minWeth);
    const raw = {
      withdrawUsdc: usdc(d.fees.spendGas),
      withdrawWeth: weth(d.fees.spendGas),
      betUsdc: usdc(d.fees.spendGas),
      redeemUsdc: usdc(d.fees.redeemGas),
    };
    const quote: Quote = {
      relayer: account.address,
      chainId: d.walletClient.chain.id,
      gasPrice: price.toString(),
      validForSeconds: QUOTE_TTL_MS / 1000,
      fees: {
        withdraw: { usdc: raw.withdrawUsdc.toString(), weth: raw.withdrawWeth.toString() },
        bet: { usdc: raw.betUsdc.toString() },
        redeem: { usdc: raw.redeemUsdc.toString() },
      },
    };
    cached = { at: Date.now(), quote, raw };
    return cached;
  }

  async function requireFee(fee: bigint, key: string) {
    const { raw } = await quoteRaw();
    const min = (raw[key] * d.fees.toleranceBps) / 10_000n;
    if (fee < min) throw new RelayError(400, `fee too low: need at least ${min}`);
  }

  function checkCommon(relayer: Address, ciphertexts: Hex[]) {
    if (relayer.toLowerCase() !== account.address.toLowerCase()) {
      throw new RelayError(400, `proof names relayer ${relayer}, this relayer is ${account.address}`);
    }
    for (const c of ciphertexts) {
      if ((c.length - 2) / 2 > MAX_CIPHERTEXT_BYTES) throw new RelayError(400, "ciphertext too large");
    }
  }

  async function checkState(root: bigint, nullifierHash: bigint) {
    if (inFlight.has(nullifierHash)) throw new RelayError(409, "this note is already being spent");
    const [known, spent] = await Promise.all([
      d.publicClient.readContract({ address: d.pool, abi: shieldedPoolAbi, functionName: "isKnownRoot", args: [root] }),
      d.publicClient.readContract({ address: d.pool, abi: shieldedPoolAbi, functionName: "nullified", args: [nullifierHash] }),
    ]);
    if (spent) throw new RelayError(409, "note already spent");
    if (!known) throw new RelayError(409, "unknown or expired root: rebuild the proof from a fresh tree");
  }

  async function verify(circuit: CircuitName, proof: Hex, publicInputs: Hex[]) {
    if (!(await d.prover.verify(circuit, proof, publicInputs))) throw new RelayError(400, "invalid proof");
  }

  /** Serialized so nonces never collide; one transaction at a time. */
  function send(label: string, nullifierHash: bigint, call: { functionName: "spend" | "redeem"; args: readonly unknown[] }) {
    inFlight.add(nullifierHash);
    const job = queue.then(async (): Promise<RelayResult> => {
      const request = { address: d.pool, abi: shieldedPoolAbi, account, ...call } as const;
      try {
        // A revert here costs nothing; on chain it would cost the relayer gas.
        await d.publicClient.simulateContract(request as never);
        // The node's estimate, never a local one: Sepolia's gas schedule
        // prices storage and code far above what Foundry/viem assume.
        const gas = await d.publicClient.estimateContractGas(request as never);
        const tip = d.fees.priorityFee;
        const block = await d.publicClient.getBlock();
        const hash = await d.walletClient.writeContract(<never>{
          ...(request as object),
          gas: (gas * 12n) / 10n,
          maxPriorityFeePerGas: tip,
          maxFeePerGas: (block.baseFeePerGas ?? 0n) * 2n + tip,
        });
        const receipt = await d.publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
        log(`${label} ${hash} ${receipt.status} gas=${receipt.gasUsed}`);
        return {
          txHash: hash,
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        };
      } catch (e) {
        throw toRelayError(e);
      } finally {
        inFlight.delete(nullifierHash);
      }
    });
    queue = job.catch(() => undefined);
    return job;
  }

  return {
    address: account.address,

    async quote(): Promise<Quote> {
      return (await quoteRaw()).quote;
    },

    async spend(r: SpendRequest): Promise<RelayResult> {
      const a = r.args;
      checkCommon(a.relayer, [r.changeCiphertext, r.outCiphertext]);
      if (a.asset !== ASSET.USDC && a.asset !== ASSET.WETH) throw new RelayError(400, "unknown asset");
      let feeKey: string;
      if (a.actionType === ACTION.WITHDRAW) {
        if (a.recipient === zeroAddress) throw new RelayError(400, "withdraw needs a recipient");
        feeKey = a.asset === ASSET.USDC ? "withdrawUsdc" : "withdrawWeth";
      } else if (a.actionType === ACTION.BET) {
        if (a.asset !== ASSET.USDC) throw new RelayError(400, "bets are USDC only");
        feeKey = "betUsdc";
      } else {
        throw new RelayError(400, "unsupported action");
      }
      await requireFee(a.fee, feeKey);
      await checkState(a.root, a.nullifierHash);
      await verify("spend", r.proof, spendPublicInputs(a));
      const label = a.actionType === ACTION.BET ? "bet" : "withdraw";
      return send(label, a.nullifierHash, {
        functionName: "spend",
        args: [a, r.proof, r.changeCiphertext, r.outCiphertext],
      });
    },

    async redeem(r: RedeemRequest): Promise<RelayResult> {
      const a = r.args;
      checkCommon(a.relayer, [r.outCiphertext]);
      if (a.kind !== TAG.POSITION) throw new RelayError(400, "unsupported redeem kind");
      await requireFee(a.fee, "redeemUsdc");
      await checkState(a.root, a.nullifierHash);
      let terms: RedeemTerms;
      try {
        const [num, den, requiredSide, anySide] = await d.publicClient.readContract({
          address: d.markets, abi: marketsAbi, functionName: "redeemTerms", args: [a.id],
        });
        terms = { num, den, requiredSide: BigInt(requiredSide), anySide };
      } catch {
        throw new RelayError(409, "market is not resolved yet");
      }
      await verify("redeem", r.proof, redeemPublicInputs(a, terms));
      return send("redeem", a.nullifierHash, { functionName: "redeem", args: [a, r.proof, r.outCiphertext] });
    },

    async health() {
      const [block, balance] = await Promise.all([
        d.publicClient.getBlockNumber(),
        d.publicClient.getBalance({ address: account.address }),
      ]);
      return {
        ok: balance > 0n,
        relayer: account.address,
        chainId: d.walletClient.chain.id,
        pool: d.pool,
        block: block.toString(),
        balanceWei: balance.toString(),
        queued: inFlight.size,
      };
    },
  };
}

export type Relayer = ReturnType<typeof createRelayer>;

function toRelayError(e: unknown): RelayError {
  if (e instanceof RelayError) return e;
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert) return new RelayError(409, `reverted: ${revert.data?.errorName ?? revert.reason ?? "unknown"}`);
    return new RelayError(503, `chain error: ${e.shortMessage}`);
  }
  return new RelayError(500, "internal error");
}

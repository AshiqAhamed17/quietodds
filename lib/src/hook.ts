// QuietOddsHook: shield part of a swap's USDC into the private balance.
import { encodeAbiParameters, type Hex } from "viem";

/** hookData for a shield-on-swap; the leaf is built by ShieldedPool from `amount`. */
export const shieldHookData = (amount: bigint, precommitment: bigint, ciphertext: Hex): Hex =>
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], [amount, precommitment, ciphertext]);

/** v4-core's PoolSwapTest router (Sepolia), enough for scripts and demos. */
export const poolSwapTestAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
] as const;

/** No price limit, in each direction (TickMath.MIN/MAX_SQRT_PRICE -/+ 1). */
export const MIN_PRICE_LIMIT = 4295128740n;
export const MAX_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n;

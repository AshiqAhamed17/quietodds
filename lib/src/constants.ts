// Must match circuits/lib/src/note.nr and contracts/src/ShieldedPool.sol.

/** BN254 scalar field. Every hash input, output and public input lives below it. */
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const MERKLE_DEPTH = 20;
/** The pool remembers this many recent roots; proofs must use one of them. */
export const ROOT_HISTORY = 64;

export const TAG = { BALANCE: 1n, POSITION: 2n, TICKET: 3n, NULLIFIER: 9n } as const;
export const ASSET = { USDC: 1n, WETH: 2n } as const;
export const ACTION = { WITHDRAW: 1n, BET: 2n, BATCH_JOIN: 3n } as const;

export type AssetId = (typeof ASSET)[keyof typeof ASSET];

export const ASSET_DECIMALS: Record<string, number> = { "1": 6, "2": 18 };
export const ASSET_SYMBOL: Record<string, string> = { "1": "USDC", "2": "WETH" };

/** Contract-side cap on deposits and stakes (the redeem circuit's u96 range). */
export const MAX_AMOUNT = 2n ** 96n - 1n;

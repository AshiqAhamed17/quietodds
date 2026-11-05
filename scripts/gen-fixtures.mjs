// Generates real proof fixtures for the Foundry tests. Each scenario mirrors
// the exact tree state the matching test builds on-chain, so the roots agree.
// Output: contracts/test/fixtures/<name>.json  { proof, publicInputs, ctx }
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { merklePath, MERKLE_DEPTH } from "./lib/merkle.mjs";
import { ACTION, ASSET, TAG_POSITION, balanceLeaf, nullifierHash, positionLeaf, precommitment } from "./lib/notes.mjs";
import { prove } from "./lib/prove.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../contracts/test/fixtures");
mkdirSync(OUT, { recursive: true });

const hex = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");
const RELAYER = 0x000000000000000000000000000000000000beefn;
const USDC = (n) => BigInt(Math.round(n * 1e6));

function save(name, result, ctx) {
  const ctxHex = Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, hex(v)]));
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ ...result, ctx: ctxHex }, null, 2) + "\n");
  console.log(`wrote ${name}.json (${result.publicInputs.length} public inputs)`);
}

// --- spend_bet: deposit 100 USDC (leaf 0), then bet 50 on market 1 side 0, fee 1 USDC.
{
  const nullifier = 101n, secret = 202n;
  const pc = precommitment(nullifier, secret);
  const amount = USDC(100);
  const leaves = [balanceLeaf(ASSET.USDC, amount, pc)];
  const path = merklePath(leaves, 0);
  const change = USDC(49), changePc = 303n, fee = USDC(1), publicAmount = USDC(50);
  const witness = {
    amount, nullifier, secret,
    path_indices: path.indices, path_siblings: path.siblings,
    change, change_precommitment: changePc,
    root: path.root,
    nullifier_hash: nullifierHash(nullifier),
    asset: ASSET.USDC,
    change_commitment: balanceLeaf(ASSET.USDC, change, changePc),
    public_amount: publicAmount,
    action_type: ACTION.BET,
    action_param1: 1n,
    action_param2: 0n,
    out_precommitment: 404n,
    relayer: RELAYER,
    fee,
    recipient: 0n,
  };
  save("spend_bet", prove("spend", witness, "spend_bet"), { depositAmount: amount, depositPrecommitment: pc, depositLeaf: leaves[0] });
}

// --- redeem_win: a 50 USDC position on market 1 side 0 (leaf 0); side 0 wins
// with num = 198, den = 70 (user-flows.md example). Relayer fee 0.5 USDC.
{
  const nullifier = 505n, secret = 606n;
  const pc = precommitment(nullifier, secret);
  const stake = USDC(50), num = USDC(198), den = USDC(70);
  const payout = (stake * num) / den;
  const fee = USDC(0.5), outPc = 707n;
  const leaves = [positionLeaf(1n, 0n, stake, pc)];
  const path = merklePath(leaves, 0);
  const witness = {
    x: stake, side: 0n, nullifier, secret,
    path_indices: path.indices, path_siblings: path.siblings,
    payout, out_precommitment: outPc,
    root: path.root,
    nullifier_hash: nullifierHash(nullifier),
    kind: TAG_POSITION,
    id: 1n,
    required_side: 0n,
    any_side: 0n,
    num, den,
    asset_out: ASSET.USDC,
    out_commitment: balanceLeaf(ASSET.USDC, payout - fee, outPc),
    relayer: RELAYER,
    fee,
  };
  save("redeem_win", prove("redeem", witness, "redeem_win"), { positionPrecommitment: pc, positionLeaf: leaves[0], payout });
}

console.log(`tree depth ${MERKLE_DEPTH}`);

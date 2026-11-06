import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import {
  ASSET, ACTION, MerkleTree, balanceLeaf, deriveNote, encryptNote, keysFromSpendingKey, positionLeaf, ticketLeaf,
  redeemPublicInputs, scanNotes, spendPublicInputs, buildRedeem, buildSpend, ticketTerms, unspentTickets,
  type OwnedNote,
} from "../src/index.ts";
import { Prover } from "../src/prover.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../contracts/test/fixtures/${name}.json`, import.meta.url), "utf8")) as {
    proof: Hex;
    publicInputs: Hex[];
  };

const RELAYER = getAddress("0x000000000000000000000000000000000000bEEF");
let prover: Prover;

beforeAll(async () => {
  prover = await Prover.create();
}, 60_000);
afterAll(async () => prover?.destroy());

describe("bb.js matches the bb CLI that generated the verifiers", () => {
  it("accepts CLI proofs", async () => {
    for (const [circuit, name] of [["spend", "bet_priya"], ["redeem", "redeem_priya_win"]] as const) {
      const f = fixture(name);
      expect(await prover.verify(circuit, f.proof, f.publicInputs)).toBe(true);
    }
  }, 120_000);

  it("rejects a tampered public input", async () => {
    const f = fixture("withdraw_priya");
    const pi = [...f.publicInputs];
    pi[4] = `0x${(BigInt(pi[4]) + 1n).toString(16).padStart(64, "0")}`;
    expect(await prover.verify("spend", f.proof, pi)).toBe(false);
  }, 60_000);
});

describe("deposit -> bet -> redeem with derived keys", () => {
  const keys = keysFromSpendingKey(424242n);
  const tree = new MerkleTree([123n, 456n]); // someone else's leaves first
  let deposit: OwnedNote;

  it("proves a bet whose public inputs equal the contract arguments", async () => {
    const d = deriveNote(keys, 0);
    const amount = 100_000_000n;
    const leafIndex = tree.insert(balanceLeaf(ASSET.USDC, amount, d.precommitment));
    const ct = await encryptNote(keys.viewingKey, { kind: "balance", index: 0, asset: ASSET.USDC, amount });
    [deposit] = await scanNotes(keys, [{ index: leafIndex, leaf: tree.leaves[leafIndex], ciphertext: ct }], () => false);

    const plan = await buildSpend({
      keys, note: deposit, tree, publicAmount: 30_000_000n, fee: 250_000n, relayer: RELAYER,
      action: { type: "bet", market: 3n, side: 2n }, changeIndex: 1,
    });
    expect(plan.created.map((n) => n.index)).toEqual([1, 2]);
    const { proof, publicInputs } = await prover.prove("spend", plan.inputs);
    expect(publicInputs).toEqual(spendPublicInputs(plan.args));
    expect(await prover.verify("spend", proof, publicInputs)).toBe(true);

    // What the pool will insert: the change leaf, then the position it builds.
    tree.insert(plan.args.changeCommitment);
    tree.insert(positionLeaf(3n, 2n, 30_000_000n, plan.args.outPrecommitment));
  }, 120_000);

  it("proves a winning redeem", async () => {
    const posData = { kind: "position", index: 2, market: 3n, side: 2n, stake: 30_000_000n } as const;
    const ct = await encryptNote(keys.viewingKey, posData);
    const [position] = await scanNotes(keys, [{ index: 4, leaf: tree.leaves[4], ciphertext: ct }], () => false);
    expect(position?.data.kind).toBe("position");

    const terms = { num: 99_000_000n, den: 45_000_000n, requiredSide: 2n, anySide: false };
    const plan = await buildRedeem({ keys, note: position, tree, terms, fee: 100_000n, relayer: RELAYER, outIndex: 3 });
    expect(plan.payout).toBe(66_000_000n);
    const { proof, publicInputs } = await prover.prove("redeem", plan.inputs);
    expect(publicInputs).toEqual(redeemPublicInputs(plan.args, terms));
    expect(await prover.verify("redeem", proof, publicInputs)).toBe(true);

    await expect(
      buildRedeem({ keys, note: position, tree, terms: { ...terms, requiredSide: 0n }, fee: 0n, relayer: RELAYER, outIndex: 3 }),
    ).rejects.toThrow("losing side");
  }, 120_000);

  it("refuses to overspend a note", async () => {
    await expect(
      buildSpend({
        keys, note: deposit, tree, publicAmount: 100_000_000n, fee: 1n, relayer: RELAYER,
        action: { type: "withdraw", recipient: RELAYER }, changeIndex: 5,
      }),
    ).rejects.toThrow("amount exceeds note");
  });
});

describe("deposit -> batch join -> ticket redeem", () => {
  const keys = keysFromSpendingKey(777n);
  const tree = new MerkleTree([9n]);

  it("joins a batch and redeems the ticket for its share of the output", async () => {
    const d = deriveNote(keys, 0);
    const amount = 10_000_000n;
    const i0 = tree.insert(balanceLeaf(ASSET.USDC, amount, d.precommitment));
    const ct0 = await encryptNote(keys.viewingKey, { kind: "balance", index: 0, asset: ASSET.USDC, amount });
    const [deposit] = await scanNotes(keys, [{ index: i0, leaf: tree.leaves[i0], ciphertext: ct0 }], () => false);

    const join = await buildSpend({
      keys, note: deposit, tree, publicAmount: 4_000_000n, fee: 50_000n, relayer: RELAYER,
      action: { type: "batchJoin", batch: 7n }, changeIndex: 1,
    });
    expect(join.args.actionType).toBe(ACTION.BATCH_JOIN);
    expect(join.args.actionParam1).toBe(7n);
    const sp = await prover.prove("spend", join.inputs);
    expect(sp.publicInputs).toEqual(spendPublicInputs(join.args));
    expect(await prover.verify("spend", sp.proof, sp.publicInputs)).toBe(true);

    // The pool inserts the change, then the ticket it builds; our scan finds the ticket.
    tree.insert(join.args.changeCommitment);
    const ti = tree.insert(ticketLeaf(7n, 4_000_000n, join.args.outPrecommitment));
    const notes = await scanNotes(keys, [{ index: ti, leaf: tree.leaves[ti], ciphertext: join.outCiphertext }], () => false);
    const [ticket] = unspentTickets(notes);
    expect(ticket.data).toMatchObject({ kind: "ticket", batch: 7n, amountIn: 4_000_000n });

    // Batch 7 swapped 12 USDC in for 0.0053 WETH out: 4/12 of it, in WETH.
    const terms = ticketTerms(5_300_000_000_000_000n, 12_000_000n, ASSET.WETH);
    const redeem = await buildRedeem({ keys, note: ticket, tree, terms, fee: 10n ** 13n, relayer: RELAYER, outIndex: 3 });
    expect(redeem.payout).toBe((4_000_000n * 5_300_000_000_000_000n) / 12_000_000n);
    expect(redeem.created[0]).toMatchObject({ kind: "balance", asset: ASSET.WETH, amount: redeem.payout - 10n ** 13n });
    const rp = await prover.prove("redeem", redeem.inputs);
    expect(rp.publicInputs).toEqual(redeemPublicInputs(redeem.args, terms));
    expect(await prover.verify("redeem", rp.proof, rp.publicInputs)).toBe(true);
  }, 120_000);
});

import { describe, expect, it } from "vitest";
import { poseidon2 } from "poseidon-lite";
import { privateKeyToAccount } from "viem/accounts";
import {
  ASSET, KEY_MESSAGE, MerkleTree, ZEROS, decryptNote, deriveNote, encryptNote, keysFromSignature,
  keysFromSpendingKey, nextNoteIndex, scanNotes, shieldedBalance, balanceLeaf, type PoolLeaf,
} from "../src/index.ts";
import story from "../../contracts/test/fixtures/story.json" with { type: "json" };

/** Straightforward level-by-level rebuild, as in Obscura's merkle.ts. */
function naiveRoot(leaves: bigint[]): bigint {
  let level = leaves.slice();
  for (let d = 0; d < 20; d++) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(poseidon2([level[i], level[i + 1] ?? ZEROS[d]]));
    level = next.length ? next : [ZEROS[d + 1]];
  }
  return level[0];
}

describe("merkle", () => {
  it("empty root is the zero subtree", () => {
    expect(new MerkleTree().root).toBe(ZEROS[20]);
  });

  it("incremental tree matches a full rebuild at every size", () => {
    const tree = new MerkleTree();
    const leaves: bigint[] = [];
    for (let i = 0; i < 9; i++) {
      const leaf = BigInt(i * 7919 + 1);
      tree.insert(leaf);
      leaves.push(leaf);
      expect(tree.root).toBe(naiveRoot(leaves));
    }
  });

  it("paths hash back to the root", () => {
    const tree = new MerkleTree(story.leaves.map(BigInt));
    for (let i = 0; i < tree.size; i++) {
      const p = tree.path(i);
      let node = tree.leaves[i];
      for (let d = 0; d < 20; d++) {
        node = p.indices[d] === 0n ? poseidon2([node, p.siblings[d]]) : poseidon2([p.siblings[d], node]);
      }
      expect(node).toBe(tree.root);
    }
  });
});

describe("keys and backups", () => {
  const keys = keysFromSpendingKey(12345n);

  it("same wallet signature gives the same keys", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const a = keysFromSignature(await account.signMessage({ message: KEY_MESSAGE }));
    const b = keysFromSignature(await account.signMessage({ message: KEY_MESSAGE }));
    expect(a.spendingKey).toBe(b.spendingKey);
    expect(deriveNote(a, 3)).toEqual(deriveNote(b, 3));
  });

  it("note secrets differ per index", () => {
    expect(deriveNote(keys, 0).nullifier).not.toBe(deriveNote(keys, 1).nullifier);
    expect(deriveNote(keys, 0).nullifier).not.toBe(deriveNote(keys, 0).secret);
  });

  it("round-trips a backup and rejects other keys", async () => {
    const note = { kind: "position", index: 4, market: 2n, side: 1n, stake: 5_000_000n } as const;
    const ct = await encryptNote(keys.viewingKey, note);
    expect(await decryptNote(keys.viewingKey, ct)).toEqual(note);
    expect(await decryptNote(keysFromSpendingKey(999n).viewingKey, ct)).toBeNull();
    expect(await decryptNote(keys.viewingKey, "0x")).toBeNull();
  });

  it("scan finds our notes, skips others and forged backups, marks spent", async () => {
    const other = keysFromSpendingKey(777n);
    const mine0 = { kind: "balance", index: 0, asset: ASSET.USDC, amount: 100n } as const;
    const mine1 = { kind: "balance", index: 1, asset: ASSET.USDC, amount: 40n } as const;
    const theirs = { kind: "balance", index: 0, asset: ASSET.USDC, amount: 5n } as const;
    const leafOf = (k: typeof keys, n: typeof mine0 | typeof mine1 | typeof theirs) =>
      balanceLeaf(n.asset, n.amount, deriveNote(k, n.index).precommitment);
    const leaves: PoolLeaf[] = [
      { index: 0, leaf: leafOf(keys, mine0), ciphertext: await encryptNote(keys.viewingKey, mine0) },
      { index: 1, leaf: leafOf(other, theirs), ciphertext: await encryptNote(other.viewingKey, theirs) },
      // A backup claiming 1,000 for a leaf that really holds 40 is ignored.
      { index: 2, leaf: leafOf(keys, mine1), ciphertext: await encryptNote(keys.viewingKey, { ...mine1, amount: 1000n }) },
      { index: 3, leaf: leafOf(keys, mine1), ciphertext: await encryptNote(keys.viewingKey, mine1) },
    ];
    const spent = deriveNote(keys, 0).nullifierHash;
    const notes = await scanNotes(keys, leaves, (h) => h === spent);
    expect(notes.map((n) => n.leafIndex)).toEqual([0, 3]);
    expect(notes[0].spent).toBe(true);
    expect(shieldedBalance(notes, ASSET.USDC)).toBe(40n);
    expect(nextNoteIndex(notes)).toBe(2);
  });
});

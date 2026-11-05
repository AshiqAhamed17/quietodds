// Fixed-depth Poseidon Merkle tree, identical to circuits/lib/src/merkle.nr and
// contracts/src/PoseidonMerkleTree.sol: empty leaves are 0, parents are
// Poseidon(left, right), and missing right nodes use the zero-subtree hash.
import { poseidon2 } from "poseidon-lite";
import { MERKLE_DEPTH } from "./constants.ts";

export const ZEROS: readonly bigint[] = (() => {
  const z = [0n];
  for (let i = 1; i <= MERKLE_DEPTH; i++) z.push(poseidon2([z[i - 1], z[i - 1]]));
  return z;
})();

/** Sibling + direction bit per level (0 = this node is the left child). */
export interface MerklePath {
  indices: bigint[];
  siblings: bigint[];
  root: bigint;
}

/**
 * The tree rebuilt from leaves in insertion order. Keeps every level, so a
 * path or the root is O(depth) after an O(n) build, and appends are O(depth).
 */
export class MerkleTree {
  private levels: bigint[][] = Array.from({ length: MERKLE_DEPTH + 1 }, () => []);

  constructor(leaves: readonly bigint[] = []) {
    for (const leaf of leaves) this.insert(leaf);
  }

  get size() {
    return this.levels[0].length;
  }

  get leaves(): readonly bigint[] {
    return this.levels[0];
  }

  insert(leaf: bigint): number {
    let idx = this.levels[0].length;
    if (idx >= 2 ** MERKLE_DEPTH) throw new Error("tree full");
    this.levels[0].push(leaf);
    for (let d = 0; d < MERKLE_DEPTH; d++) {
      const parent = idx >> 1;
      const left = this.levels[d][parent * 2];
      const right = this.levels[d][parent * 2 + 1] ?? ZEROS[d];
      this.levels[d + 1][parent] = poseidon2([left, right]);
      idx = parent;
    }
    return this.levels[0].length - 1;
  }

  get root(): bigint {
    return this.levels[MERKLE_DEPTH][0] ?? ZEROS[MERKLE_DEPTH];
  }

  path(leafIndex: number): MerklePath {
    if (leafIndex < 0 || leafIndex >= this.size) throw new Error(`leaf ${leafIndex} not in tree`);
    const indices: bigint[] = [];
    const siblings: bigint[] = [];
    let idx = leafIndex;
    for (let d = 0; d < MERKLE_DEPTH; d++) {
      indices.push(BigInt(idx & 1));
      siblings.push(this.levels[d][idx ^ 1] ?? ZEROS[d]);
      idx >>= 1;
    }
    return { indices, siblings, root: this.root };
  }

  indexOf(leaf: bigint): number {
    return this.levels[0].indexOf(leaf);
  }
}

export const merklePath = (leaves: readonly bigint[], leafIndex: number) => new MerkleTree(leaves).path(leafIndex);
export const merkleRoot = (leaves: readonly bigint[]) => new MerkleTree(leaves).root;

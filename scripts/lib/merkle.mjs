// Fixed-depth Poseidon Merkle tree, identical to circuits/lib/src/merkle.nr and
// contracts/src/PoseidonMerkleTree.sol: empty leaves are 0, parents are
// Poseidon(left, right), missing right nodes use the zero-subtree hash.
import { poseidon2 } from "poseidon-lite";

export const MERKLE_DEPTH = 20;

export const ZEROS = (() => {
  const z = [0n];
  for (let i = 1; i <= MERKLE_DEPTH; i++) z.push(poseidon2([z[i - 1], z[i - 1]]));
  return z;
})();

/** Authentication path for `leafIndex` in a tree holding `leaves` in insertion order. */
export function merklePath(leaves, leafIndex) {
  const indices = [];
  const siblings = [];
  let idx = leafIndex;
  let level = leaves.slice();

  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    siblings.push(siblingIdx < level.length ? level[siblingIdx] : ZEROS[depth]);
    indices.push(isRight ? 1n : 0n);

    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon2([level[i], i + 1 < level.length ? level[i + 1] : ZEROS[depth]]));
    }
    level = next.length ? next : [ZEROS[depth + 1]];
    idx = Math.floor(idx / 2);
  }
  return { indices, siblings, root: level[0] };
}

export function merkleRoot(leaves) {
  if (leaves.length === 0) return ZEROS[MERKLE_DEPTH];
  return merklePath(leaves, 0).root;
}

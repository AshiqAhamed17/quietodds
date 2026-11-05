// Prints the reference Poseidon (circomlib, BN254) hashes for every arity
// QuietOdds uses. The same vectors are asserted in the Noir lib tests and in
// contracts/test/PoseidonParity.t.sol, so all three implementations agree.
import { poseidon2, poseidon4, poseidon5 } from "poseidon-lite";

const vectors = {
  "hash_2([1,2])": poseidon2([1n, 2n]),
  "hash_4([1,2,3,4])": poseidon4([1n, 2n, 3n, 4n]),
  "hash_5([1,2,3,4,5])": poseidon5([1n, 2n, 3n, 4n, 5n]),
};

for (const [name, v] of Object.entries(vectors)) {
  console.log(`${name} = 0x${v.toString(16).padStart(64, "0")}`);
}

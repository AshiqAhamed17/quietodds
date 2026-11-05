// Proves and verifies the QuietOdds circuits with noir_js + bb.js, in the
// browser or in Node. Versions are pinned to the toolchain that produced the
// on-chain verifiers (nargo 1.0.0-beta.25, bb 5.1.0); a drift here gives
// proofs that verify locally but fail on chain.
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit, Noir } from "@noir-lang/noir_js";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import type { InputMap } from "./witness.ts";

export type CircuitName = "spend" | "redeem";

export interface Proof {
  proof: Hex;
  publicInputs: Hex[];
}

/** ZK UltraHonk with the keccak transcript, matching the Solidity verifiers. */
const TARGET = { verifierTarget: "evm" } as const;

const loaders: Record<CircuitName, () => Promise<CompiledCircuit>> = {
  spend: () => import("../circuits/spend.json", { with: { type: "json" } }).then((m) => m.default as unknown as CompiledCircuit),
  redeem: () => import("../circuits/redeem.json", { with: { type: "json" } }).then((m) => m.default as unknown as CompiledCircuit),
};

export class Prover {
  private circuits = new Map<CircuitName, { circuit: CompiledCircuit; backend: UltraHonkBackend; noir?: Noir }>();

  private constructor(private api: Barretenberg) {}

  /** One Barretenberg instance (WASM, multi-threaded where available). */
  static async create(opts: { threads?: number } = {}): Promise<Prover> {
    return new Prover(await Barretenberg.new(opts));
  }

  private async load(name: CircuitName) {
    let c = this.circuits.get(name);
    if (!c) {
      const circuit = await loaders[name]();
      c = { circuit, backend: new UltraHonkBackend(circuit.bytecode, this.api) };
      this.circuits.set(name, c);
    }
    return c;
  }

  async prove(name: CircuitName, inputs: InputMap): Promise<Proof> {
    const c = await this.load(name);
    // noir_js only executes witnesses; verify-only users (the relayer) never load it.
    if (!c.noir) c.noir = new (await import("@noir-lang/noir_js")).Noir(c.circuit);
    const { witness } = await c.noir.execute(inputs);
    const backend = c.backend;
    const { proof, publicInputs } = await backend.generateProof(witness, TARGET);
    return { proof: bytesToHex(proof), publicInputs: publicInputs.map((p) => p as Hex) };
  }

  async verify(name: CircuitName, proof: Hex, publicInputs: Hex[]): Promise<boolean> {
    const { backend } = await this.load(name);
    try {
      return await backend.verifyProof({ proof: hexToBytes(proof), publicInputs }, TARGET);
    } catch {
      return false;
    }
  }

  async destroy() {
    await this.api.destroy();
  }
}

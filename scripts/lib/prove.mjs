// Proves a circuit from a JS witness with nargo + bb (keccak UltraHonk, the
// EVM-verifiable flavor), and returns { proof, publicInputs } as hex.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CIRCUITS = join(dirname(fileURLToPath(import.meta.url)), "../../circuits");

const toToml = (v) => (Array.isArray(v) ? `[${v.map(toToml).join(", ")}]` : `"0x${BigInt(v).toString(16)}"`);

export function prove(circuit, witness, name) {
  const proverName = `Prover_${name}`;
  writeFileSync(
    join(CIRCUITS, circuit, `${proverName}.toml`),
    Object.entries(witness).map(([k, v]) => `${k} = ${toToml(v)}`).join("\n") + "\n",
  );
  const out = join(CIRCUITS, "target", "fixtures", name);
  mkdirSync(out, { recursive: true });

  const run = (cmd, args) => execFileSync(cmd, args, { cwd: CIRCUITS, stdio: ["ignore", "pipe", "pipe"] });
  run("nargo", ["execute", "--package", circuit, "-p", proverName, name]);
  run("bb", ["prove", "--scheme", "ultra_honk", "--oracle_hash", "keccak", "-b", `./target/${circuit}.json`, "-w", `./target/${name}.gz`, "-k", `./target/${circuit}/vk`, "-o", out]);
  run("bb", ["verify", "--scheme", "ultra_honk", "--oracle_hash", "keccak", "-k", `./target/${circuit}/vk`, "-p", join(out, "proof"), "-i", join(out, "public_inputs")]);

  const proof = readFileSync(join(out, "proof"));
  const pub = readFileSync(join(out, "public_inputs"));
  const publicInputs = [];
  for (let i = 0; i < pub.length; i += 32) publicInputs.push("0x" + pub.subarray(i, i + 32).toString("hex"));
  return { proof: "0x" + proof.toString("hex"), publicInputs };
}

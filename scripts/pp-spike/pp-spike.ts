// Phase 1.1 spike: can a QuietOdds contract be the Privacy Pools v2 `transact`
// processor, with QuietOdds' own `data` bound into the proof?
//
//   npm run spike -- setup     derive keys, register the keystore, deposit 2 USDC
//   npm run spike -- status    sync notes and show their ASP status
//   npm run spike -- deploy    deploy the throwaway SpikeProcessor (contracts/test/spike)
//   npm run spike -- fund [usdc]  prove a transact with processor = SpikeProcessor and
//                                 data = abi.encode(precommitment, ciphertext, relayer, fee),
//                                 then submit it from a different wallet
//
// Uses USER2 from the repo's .env as the Privacy Pools account and the deployer as
// the stand-in relayer. Keys are never printed. Note state lives in .pp-state/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseEventLogs,
  parseUnits,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  APP_IDENTIFIER,
  CryptoService,
  DEFAULT_CIRCUIT_MANIFEST,
  DEFAULT_IPFS_GATEWAY_URLS,
  DEPLOYMENTS,
  PoolSessionBuilder,
} from "@0xbow/privacy-pools-v2-sdk";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SEPOLIA_V9_CIRCUITS = JSON.parse(readFileSync(new URL("./sepolia-v9-circuits.json", import.meta.url), "utf8"));
const STATE = fileURLToPath(new URL("./.pp-state/", import.meta.url));
if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`);
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set in .env`);
  return v as Hex;
};

// publicnode: the SDK scans logs over wide block ranges, which free Alchemy keys refuse.
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const USDC: Address = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ASP_URL = "https://api-dev.0xbow.io";
// 0xbow's staging relayer on Sepolia (docs: deployments/sepolia). The builder needs at
// least one; the spike never relays through it.
const RELAYER = {
  url: "https://relayer-v2-staging-149184580131.us-east1.run.app",
  name: "0xBow Relayer",
  chainId: 11155111,
  chainType: "evm" as const,
  status: "active" as const,
  address: "0x4Ba5fF376865b370790A56276C63e7984DCFf1f7" as Address,
  processorAddress: "0x762665Dc7aAeeA25DC1759AEBef1F61730497f6e" as Address,
};

// PoolVault.transact (V9). Declared in the SDK's types but missing from its JS exports.
const PROOF = { name: "_proof", type: "tuple", components: [
  { name: "pA", type: "uint256[2]" }, { name: "pB", type: "uint256[2][2]" },
  { name: "pC", type: "uint256[2]" }, { name: "pubSignals", type: "uint256[][]" },
] } as const;
const POOL_VAULT_TRANSACT_ABI = [{
  type: "function", name: "transact", stateMutability: "nonpayable", outputs: [],
  inputs: [
    PROOF,
    { name: "_transactParams", type: "tuple", components: [{ name: "processor", type: "address" }, { name: "data", type: "bytes" }] },
    { name: "_noteData", type: "tuple[]", components: [{ name: "hint", type: "bytes32" }, { name: "data", type: "bytes" }] },
  ],
}] as const;

const owner = privateKeyToAccount(need("USER2_PRIVATE_KEY"));
const relayer = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY"));
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const ownerWallet = createWalletClient({ chain: sepolia, transport: http(RPC), account: owner });
const relayerWallet = createWalletClient({ chain: sepolia, transport: http(RPC), account: relayer });
const vault = (DEPLOYMENTS as Record<number, { poolAddress: Address }>)[11155111].poolAddress;

// Reference EIP-712 payload from 0xbow's sample app (apps/sample/src/keystore/
// secretDerivationPayload.ts). It must stay byte-for-byte stable: it is part of the key.
function derivationPayload(signer: Address) {
  return {
    domain: {
      name: "Standardized Secret Derivation",
      version: "1",
      verifyingContract: "0x0000000000000000000000000000000000000000" as Address,
      salt: keccak256(toHex(APP_IDENTIFIER)),
    },
    message: {
      purpose:
        "This signature is used to deterministically derive application-specific secrets from your master seed. It is not a transaction and will not cost any gas.",
      addressHash: keccak256(toBytes(signer)),
    },
    primaryType: "SecretDerivation" as const,
    types: {
      SecretDerivation: [
        { name: "purpose", type: "string" },
        { name: "addressHash", type: "bytes32" },
      ],
    },
  };
}

async function session() {
  const payload = derivationPayload(owner.address);
  const signature = await ownerWallet.signTypedData(payload);
  const keys = new CryptoService().deriveKeysFromSignature({
    signature,
    signerAddress: owner.address,
    addressHash: payload.message.addressHash,
    revocableKeyIndex: "0x0",
  });
  mkdirSync(STATE, { recursive: true });
  return PoolSessionBuilder.create({
    chainId: 11155111,
    rpcUrl: RPC,
    ownerAddress: owner.address,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protocolKeys: { ...(keys as any), revocableKeyIndex: "0x0" },
    aspUrl: ASP_URL,
    relayers: [RELAYER],
    // ipfs.io (the SDK default) rate-limits; these served the artifacts on 28 Nov 2026.
    circuitGatewayUrls: ["https://ipfs.filebase.io/ipfs", "https://gateway.pinata.cloud/ipfs", ...DEFAULT_IPFS_GATEWAY_URLS],
    // Sepolia V9 still verifies with SDK 1.0.0's dev keys: its deposit verifier holds the
    // 1.0.0 verification key, not 1.1.0's ceremony keys. So pin the 1.0.0 manifest
    // (same circuits, different keys). Its sha256 digests also need a 0x prefix to pass
    // the builder schema (true of 1.1.0's own default manifest too).
    circuitManifest: Object.fromEntries(
      Object.entries(SEPOLIA_V9_CIRCUITS).map(([k, v]) => [
        k,
        Object.fromEntries(Object.entries(v as Record<string, string>).map(([f, x]) => [f, /Sha256$/.test(f) && !x.startsWith("0x") ? `0x${x}` : x])),
      ]),
    ) as unknown as typeof DEFAULT_CIRCUIT_MANIFEST,
    walletInteractor: { type: "viem", walletClient: ownerWallet },
    persistentStorage: { type: "file", dirPath: STATE },
  });
}

type Sess = Awaited<ReturnType<typeof session>>;

async function notes(s: Sess) {
  await s.discoverNotes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (await s.exportAccount()).notes as any[];
  for (const n of all) {
    console.log(`  ${n.status.padEnd(8)} ${formatUnits(BigInt(n.value), 6)} USDC  commitment ${String(n.commitment).slice(0, 12)}…`);
  }
  if (all.length === 0) console.log("  (no notes)");
  return all;
}

const spikeFile = `${STATE}spike.json`;
const spikeAddress = (): Address => {
  if (!existsSync(spikeFile)) throw new Error("run `deploy` first");
  return JSON.parse(readFileSync(spikeFile, "utf8")).address;
};
const spikeAbi = JSON.parse(
  readFileSync(`${ROOT}contracts/out/SpikeProcessor.sol/SpikeProcessor.json`, "utf8"),
).abi;

async function setup() {
  const s = await session();
  if (!(await s.isKeystoreRegistered())) {
    console.log("registering keystore (2 txs)…");
    await s.registerKeystore();
  } else console.log("keystore already registered");
  if ((await notes(s)).length > 0) return console.log("already deposited");
  console.log("depositing 2 USDC (+1% vetting fee)…");
  const r = await s.deposit({ tokenId: USDC, value: toHex(parseUnits("2", 6)) });
  console.log("deposit tx", r.txHash);
  await notes(s);
}

async function status() {
  const s = await session();
  console.log(`account ${owner.address}`);
  await notes(s);
}

async function deploy() {
  const out = JSON.parse(readFileSync(`${ROOT}contracts/out/SpikeProcessor.sol/SpikeProcessor.json`, "utf8"));
  const hash = await relayerWallet.deployContract({
    abi: out.abi,
    bytecode: out.bytecode.object,
    args: [vault, USDC, owner.address],
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (!r.contractAddress) throw new Error(`deploy failed: ${hash}`);
  mkdirSync(STATE, { recursive: true });
  writeFileSync(spikeFile, JSON.stringify({ address: r.contractAddress, tx: hash }, null, 2));
  console.log(`SpikeProcessor ${r.contractAddress}  (${hash})`);
}

async function fund(amountUsdc: string) {
  const spike = spikeAddress();
  const s = await session();
  const active = (await notes(s)).filter((n) => n.status === "ACTIVE" && BigInt(n.tokenId ?? USDC) !== 0n);
  if (active.length === 0) throw new Error("no ACTIVE note yet: the ASP has not approved the deposit");
  const note = active[0];
  const amount = parseUnits(amountUsdc, 6);
  if (BigInt(note.value) < amount) throw new Error(`note holds ${formatUnits(BigInt(note.value), 6)} USDC`);

  // What the real PrivacyPoolsDepositor will decode: a QuietOdds note precommitment,
  // its encrypted backup, and who may relay it for what fee. Dummy values are enough
  // to show the proof binds them.
  const precommitment = keccak256(toHex("quietodds spike precommitment"));
  const ciphertext = toHex("quietodds spike ciphertext");
  const fee = parseUnits("0.05", 6);
  const data = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes" }, { type: "address" }, { type: "uint256" }],
    [precommitment, ciphertext, relayer.address, fee],
  );

  // The public session API always encodes PayoutRouting; the orchestrator underneath
  // takes a `transactParams` override. `pendingKeystoreRegistration: false` keeps the
  // normal keystore proof but skips the SDK's own simulation, which would revert:
  // only the processor contract may send this transact.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const core = (s as any).delegates.withdraw.core;
  console.log("proving transact (processor = SpikeProcessor, custom data)…");
  const t0 = Date.now();
  const res = await core.prepareTransact({
    inputCommitments: [note.commitment],
    amount: toHex(amount),
    tokenId: USDC,
    relayAddress: relayer.address,
    feeAmount: "0x0",
    processorAddress: spike,
    amountOut: toHex(amount),
    recipientAddress: spike,
    transactParams: { processor: spike, data },
    pendingKeystoreRegistration: false,
  });
  console.log(`proved in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const { args } = decodeFunctionData({ abi: POOL_VAULT_TRANSACT_ABI, data: res.transactTx.data as Hex });
  const [proof, params, noteData] = args as unknown as [unknown, { processor: Address; data: Hex }, unknown[]];
  if (params.processor.toLowerCase() !== spike.toLowerCase() || params.data !== data) {
    throw new Error("the SDK did not bind our processor and data");
  }

  console.log("submitting SpikeProcessor.fund from the stand-in relayer…");
  const hash = await relayerWallet.writeContract({ address: spike, abi: spikeAbi, functionName: "fund", args: [proof, data, noteData] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`fund reverted: ${hash}`);
  const [ev] = parseEventLogs({ abi: spikeAbi, logs: r.logs, eventName: "Funded" }) as unknown as [
    { args: { precommitment: Hex; relayer: Address; fee: bigint; received: bigint } },
  ];
  console.log(`OK  tx ${hash}  gas ${r.gasUsed}`);
  console.log(`    processor received ${formatUnits(ev.args.received, 6)} USDC`);
  console.log(`    decoded precommitment ${ev.args.precommitment.slice(0, 12)}…, relayer ${ev.args.relayer}, fee ${formatUnits(ev.args.fee, 6)}`);
  writeFileSync(`${STATE}result.json`, JSON.stringify({ tx: hash, gas: r.gasUsed.toString(), spike, received: ev.args.received.toString() }, null, 2));
}

const [cmd = "status", arg] = process.argv.slice(2);
const run = { setup, status, deploy, fund: () => fund(arg ?? "1") }[cmd];
if (!run) throw new Error(`unknown command ${cmd}`);
try {
  await run();
  process.exit(0);
} catch (e) {
  // Errors can echo RPC URLs (which may embed API keys): redact them.
  const msg = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replace(/https?:\/\/\S+/g, "<url>");
  console.error(msg.slice(0, 1500));
  process.exit(1);
}

// Creates QuietOdds markets on Sepolia from the deployer (the Markets owner).
//
//   npm run markets -w scripts -- launch        F1 + price markets for judging week
//   npm run markets -w scripts -- demo [min]    replay markets for a demo video,
//                                               closing in `min` minutes (default 8)
//
// A replay market asks about an event that has already finished, so right
// after it closes the CRE workflow can resolve it from ESPN and the demo can
// show bet → close → resolve → claim in one sitting:
//   cd cre && cre workflow simulate resolver --target staging-settings \
//     --non-interactive --trigger-index 0 -e ../.env --broadcast
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia as chain } from "viem/chains";
import { marketsAbi, sepolia } from "@quietodds/lib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`);
const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");

const ETH_USD: Address = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
const BTC_USD: Address = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";
const PRICE = 0;
const SPORTS = 1;
const F1_SIDES = "Kimi Antonelli|Max Verstappen|Lewis Hamilton|Anyone else";

interface Spec {
  question: string;
  outcomes: string;
  close: number; // unix seconds
  source: number;
  ref?: string;
  feed?: Address;
  threshold?: bigint; // 8 decimals
}

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const usd8 = (dollars: number) => BigInt(dollars) * 10n ** 8n;

const LAUNCH: Spec[] = [
  // ESPN F1 events: São Paulo 600057448 (race 8 Nov 17:00 UTC), Las Vegas 600057449 (race 22 Nov 04:00 UTC).
  { question: "Who wins the São Paulo Grand Prix? (Nov 8)", outcomes: F1_SIDES, close: at("2026-11-08T17:00:00Z"), source: SPORTS, ref: "espn:racing/f1:600057448" },
  { question: "Who wins the Las Vegas Grand Prix? (Nov 21)", outcomes: F1_SIDES, close: at("2026-11-22T04:00:00Z"), source: SPORTS, ref: "espn:racing/f1:600057449" },
  { question: "Will ETH be above $2,200 at 12:00 UTC on Nov 8?", outcomes: "No|Yes", close: at("2026-11-08T12:00:00Z"), source: PRICE, feed: ETH_USD, threshold: usd8(2200) },
  { question: "Will BTC be above $76,000 at 12:00 UTC on Nov 9?", outcomes: "No|Yes", close: at("2026-11-09T12:00:00Z"), source: PRICE, feed: BTC_USD, threshold: usd8(76_000) },
];

function demo(minutes: number): Spec[] {
  const close = Math.floor(Date.now() / 1000) + minutes * 60;
  return [
    // Verstappen won in Mexico City on Nov 1, so this resolves to side 1.
    { question: "[Replay] Who won the Mexico City Grand Prix? (raced Nov 1)", outcomes: F1_SIDES, close, source: SPORTS, ref: "espn:racing/f1:600057447" },
    { question: "[Replay] Liverpool vs Arsenal (played Nov 1)", outcomes: "Liverpool|Draw|Arsenal", close, source: SPORTS, ref: "espn:soccer/eng.1:401879246" },
  ];
}

const pub = createPublicClient({ chain, transport: http(process.env.SEPOLIA_RPC_URL) });
const wallet = createWalletClient({ chain, transport: http(process.env.SEPOLIA_RPC_URL), account: privateKeyToAccount(key) });
const fees = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n };

async function create(s: Spec) {
  const sides = s.outcomes.split("|").length;
  const hash = await wallet.writeContract({
    address: sepolia.markets,
    abi: marketsAbi,
    functionName: "createMarket",
    args: [s.question, s.outcomes, sides, BigInt(s.close), s.source, s.ref ?? "", s.feed ?? "0x0000000000000000000000000000000000000000", s.threshold ?? 0n],
    ...fees,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`createMarket reverted: ${hash}`);
  const [log] = parseEventLogs({ abi: marketsAbi, logs: r.logs, eventName: "MarketCreated" });
  console.log(`#${log.args.marketId}  ${s.question}  (closes ${new Date(s.close * 1000).toISOString()})  ${hash}`);
}

const [mode = "launch", arg] = process.argv.slice(2);
const specs = mode === "demo" ? demo(Number(arg ?? 8)) : mode === "launch" ? LAUNCH : null;
if (!specs) throw new Error(`unknown mode "${mode}": use launch or demo [minutes]`);
for (const s of specs) await create(s);

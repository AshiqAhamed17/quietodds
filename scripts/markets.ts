// Creates QuietOdds markets on Sepolia from the deployer (the Markets owner).
//
//   npm run markets -w scripts -- december      football, F1 and price markets for December 2026
//   npm run markets -w scripts -- launch        the November 2026 launch set (already created)
//   npm run markets -w scripts -- demo [min]    replay markets for a demo video,
//                                               closing in `min` minutes (default 8)
//
// Football markets close at kick-off and F1 markets at lights out. Sports sides
// are "Home|Draw|Away" (CRE reads ESPN's home/away score); F1 sides must match
// ESPN's driver names, with "Anyone else" last.
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

// ESPN ids and kick-off times checked on 28 Nov 2026. Chainlink on Sepolia read
// ETH ≈ $1,645 and BTC ≈ $59,200, so the price lines sit close to spot.
const F1_DEC = "Kimi Antonelli|Max Verstappen|Lando Norris|Anyone else";
const DECEMBER: Spec[] = [
  { question: "Arsenal vs Manchester City (Premier League, Nov 29)", outcomes: "Arsenal|Draw|Manchester City", close: at("2026-11-29T16:30:00Z"), source: SPORTS, ref: "espn:soccer/eng.1:401878753" },
  { question: "Who wins the Qatar Grand Prix? (Nov 29)", outcomes: F1_DEC, close: at("2026-11-29T16:00:00Z"), source: SPORTS, ref: "espn:racing/f1:600057450" },
  { question: "Barcelona vs Atlético Madrid (La Liga, Dec 2)", outcomes: "Barcelona|Draw|Atlético Madrid", close: at("2026-12-02T20:30:00Z"), source: SPORTS, ref: "espn:soccer/esp.1:401882700" },
  { question: "Chelsea vs Liverpool (Premier League, Dec 5)", outcomes: "Chelsea|Draw|Liverpool", close: at("2026-12-05T12:30:00Z"), source: SPORTS, ref: "espn:soccer/eng.1:401879213" },
  { question: "Who wins the Abu Dhabi Grand Prix? (Dec 6)", outcomes: F1_DEC, close: at("2026-12-06T13:00:00Z"), source: SPORTS, ref: "espn:racing/f1:600057451" },
  { question: "Barcelona vs Manchester City (Champions League, Dec 8)", outcomes: "Barcelona|Draw|Manchester City", close: at("2026-12-08T20:00:00Z"), source: SPORTS, ref: "espn:soccer/uefa.champions:401915285" },
  { question: "Arsenal vs Real Madrid (Champions League, Dec 9)", outcomes: "Arsenal|Draw|Real Madrid", close: at("2026-12-09T20:00:00Z"), source: SPORTS, ref: "espn:soccer/uefa.champions:401915367" },
  { question: "Manchester City vs Chelsea (Premier League, Dec 12)", outcomes: "Manchester City|Draw|Chelsea", close: at("2026-12-12T17:30:00Z"), source: SPORTS, ref: "espn:soccer/eng.1:401878742" },
  { question: "Napoli vs AC Milan (Serie A, Dec 13)", outcomes: "Napoli|Draw|AC Milan", close: at("2026-12-13T19:45:00Z"), source: SPORTS, ref: "espn:soccer/ita.1:401875028" },
  { question: "Will ETH be above $1,700 at 12:00 UTC on Dec 5?", outcomes: "No|Yes", close: at("2026-12-05T12:00:00Z"), source: PRICE, feed: ETH_USD, threshold: usd8(1_700) },
  { question: "Will BTC be above $60,000 at 12:00 UTC on Dec 7?", outcomes: "No|Yes", close: at("2026-12-07T12:00:00Z"), source: PRICE, feed: BTC_USD, threshold: usd8(60_000) },
  { question: "Will ETH end 2026 above $2,000? (Dec 31, 23:00 UTC)", outcomes: "No|Yes", close: at("2026-12-31T23:00:00Z"), source: PRICE, feed: ETH_USD, threshold: usd8(2_000) },
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
const specs = mode === "demo" ? demo(Number(arg ?? 8)) : mode === "december" ? DECEMBER : mode === "launch" ? LAUNCH : null;
if (!specs) throw new Error(`unknown mode "${mode}": use december, launch or demo [minutes]`);
for (const s of specs) await create(s);

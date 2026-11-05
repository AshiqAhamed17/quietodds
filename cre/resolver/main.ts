// QuietOdds resolver. Every run: read open markets past their close time
// from Markets, fetch each result (Chainlink price feed or ESPN), agree on it
// across the DON, and send one signed report to ResolverReceiver, which
// resolves or cancels the markets on chain.
import {
	bytesToHex,
	consensusMedianAggregation,
	cre,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	json,
	LAST_FINALIZED_BLOCK_NUMBER,
	LATEST_BLOCK_NUMBER,
	ok,
	prepareReportRequest,
	Runner,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	type Hex,
	parseAbi,
	parseAbiParameters,
	zeroAddress,
} from 'viem'
import { z } from 'zod'
import {
	type Action,
	espnUrl,
	priceOutcome,
	SOURCE_PRICE,
	SOURCE_SPORTS,
	sportsOutcome,
	STATUS_OPEN,
	toAction,
} from './logic'

export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	markets: z.string(),
	receiver: z.string(),
	/** "latest" for fast demos, "finalized" for production. */
	readAt: z.enum(['latest', 'finalized']).default('finalized'),
	/** Keeps a run inside CRE's per-execution call limits. */
	maxMarketsPerRun: z.number().int().positive().default(4),
	espnBaseUrl: z.string().default('https://site.api.espn.com/apis/site/v2/sports'),
	gasLimit: z.string().default('2000000'),
})
export type Config = z.infer<typeof configSchema>

const marketsAbi = parseAbi([
	'function marketCount() view returns (uint256)',
	'struct Market { string question; string outcomes; uint8 numSides; uint64 closeTime; uint8 source; string sourceRef; address priceFeed; int256 threshold; uint8 status; uint8 winningSide; uint256 pot; uint256 protocolFee; }',
	'function getMarket(uint256 marketId) view returns (Market)',
])
const feedAbi = parseAbi([
	'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
])

/** Runs on each node; the DON takes the median of the result codes. */
export const fetchSportsCode = (requester: HTTPSendRequester, url: string, numSides: number): number => {
	const res = requester.sendRequest({ url, method: 'GET', cacheSettings: { store: false } }).result()
	if (!ok(res)) throw new Error(`ESPN request failed: HTTP ${res.statusCode}`)
	return sportsOutcome(json(res) as Parameters<typeof sportsOutcome>[0], numSides)
}

export const onCron = (runtime: Runtime<Config>): string => {
	const cfg = runtime.config
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName })
	if (!network) throw new Error(`unknown chain ${cfg.chainSelectorName}`)
	const evm = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const http = new cre.capabilities.HTTPClient()
	const at = cfg.readAt === 'latest' ? LATEST_BLOCK_NUMBER : LAST_FINALIZED_BLOCK_NUMBER

	const read = <const A extends readonly unknown[]>(to: string, abi: A, functionName: string, args: unknown[] = []) => {
		const data = encodeFunctionData({ abi, functionName, args } as never)
		const res = evm
			.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to: to as Address, data }), blockNumber: at })
			.result()
		return decodeFunctionResult({ abi, functionName, data: bytesToHex(res.data) } as never) as unknown
	}

	const now = BigInt(Math.floor(runtime.now().getTime() / 1000))
	const count = read(cfg.markets, marketsAbi, 'marketCount') as bigint
	const actions: Action[] = []
	let checked = 0

	for (let id = 1n; id <= count && checked < cfg.maxMarketsPerRun; id++) {
		const m = read(cfg.markets, marketsAbi, 'getMarket', [id]) as {
			question: string
			numSides: number
			closeTime: bigint
			source: number
			sourceRef: string
			priceFeed: Address
			threshold: bigint
			status: number
		}
		if (m.status !== STATUS_OPEN || m.closeTime > now) continue
		checked++

		let code: number
		if (m.source === SOURCE_PRICE) {
			const [, price, , updatedAt] = read(m.priceFeed, feedAbi, 'latestRoundData') as [bigint, bigint, bigint, bigint, bigint]
			code = priceOutcome(price, updatedAt, m.closeTime, m.threshold)
		} else if (m.source === SOURCE_SPORTS) {
			code = http
				.sendRequest(runtime, fetchSportsCode, consensusMedianAggregation<number>())(
					espnUrl(m.sourceRef, cfg.espnBaseUrl),
					m.numSides,
				)
				.result()
		} else {
			continue
		}
		const action = toAction(id, code, m.numSides)
		runtime.log(`market ${id} "${m.question}": ${action ? `kind ${action.kind} outcome ${action.outcome}` : 'no result yet'}`)
		if (action) actions.push(action)
	}

	if (actions.length === 0) return `checked ${checked} closed market(s), nothing to report`

	const payload = encodeAbiParameters(parseAbiParameters('(uint8 kind, uint256 id, uint8 outcome)[]'), [actions])
	const report = runtime.report(prepareReportRequest(payload as Hex)).result()
	const tx = evm
		.writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } })
		.result()
	if (tx.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`report write failed: ${tx.errorMessage || tx.txStatus}`)
	}
	const hash = bytesToHex(tx.txHash ?? new Uint8Array(32))
	return `reported ${actions.length} action(s) [${actions.map((a) => `${a.id}:${a.kind}/${a.outcome}`).join(', ')}] tx ${hash}`
}

export const initWorkflow = (config: Config) => {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
}

export async function main() {
	const runner = await Runner.newRunner({ configSchema })
	await runner.run(initWorkflow)
}

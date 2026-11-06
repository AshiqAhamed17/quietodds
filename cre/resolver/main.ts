// QuietOdds resolver. Every run: read open markets past their close time
// from Markets, fetch each result (Chainlink price feed or ESPN), agree on it
// across the DON, and send one signed report to ResolverReceiver, which
// resolves or cancels the markets on chain. The same report executes any
// private batch swap whose interval is over and donates the markets' 1% fee
// to the Uniswap pool's LPs.
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
	espnOutcome,
	STATUS_OPEN,
	toAction,
	upkeepActions,
} from './logic'

export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	markets: z.string(),
	receiver: z.string(),
	batches: z.string(),
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
const batchesAbi = parseAbi([
	'function currentBatch(uint8 direction) view returns (uint256)',
	'function isExecutable(uint256 batchId) view returns (bool)',
])
const feesAbi = parseAbi(['function feesAccrued() view returns (uint256)'])
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const multicallAbi = parseAbi([
	'struct Call3 { address target; bool allowFailure; bytes callData; }',
	'struct Result { bool success; bytes returnData; }',
	'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])
const feedAbi = parseAbi([
	'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
])

/** Runs on each node; the DON takes the median of the result codes. */
export const fetchSportsCode = (
	requester: HTTPSendRequester,
	url: string,
	sourceRef: string,
	numSides: number,
	outcomes: string,
): number => {
	const res = requester.sendRequest({ url, method: 'GET', cacheSettings: { store: false } }).result()
	if (!ok(res)) throw new Error(`ESPN request failed: HTTP ${res.statusCode}`)
	return espnOutcome(sourceRef, json(res), numSides, outcomes)
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

	// CRE caps chain reads per run (15), so everything is read through Multicall3:
	// one call for every market plus the batch/fee state, one for batch readiness
	// and one for the price feeds of the closed price markets. Four reads total,
	// however many markets exist.
	type Call = { to: string; abi: readonly unknown[]; functionName: string; args?: unknown[] }
	const multi = (calls: Call[]): unknown[] => {
		if (calls.length === 0) return []
		const results = read(MULTICALL3, multicallAbi, 'aggregate3', [
			calls.map((c) => ({
				target: c.to as Address,
				allowFailure: false,
				callData: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args ?? [] } as never),
			})),
		]) as { success: boolean; returnData: Hex }[]
		return results.map((r, i) => decodeFunctionResult({ abi: calls[i].abi, functionName: calls[i].functionName, data: r.returnData } as never))
	}

	const now = BigInt(Math.floor(runtime.now().getTime() / 1000))
	const count = read(cfg.markets, marketsAbi, 'marketCount') as bigint
	const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1))
	const state = multi([
		...ids.map((id) => ({ to: cfg.markets, abi: marketsAbi, functionName: 'getMarket', args: [id] })),
		{ to: cfg.batches, abi: batchesAbi, functionName: 'currentBatch', args: [0] },
		{ to: cfg.batches, abi: batchesAbi, functionName: 'currentBatch', args: [1] },
		{ to: cfg.markets, abi: feesAbi, functionName: 'feesAccrued' },
	])
	type M = {
		question: string
		outcomes: string
		numSides: number
		closeTime: bigint
		source: number
		sourceRef: string
		priceFeed: Address
		threshold: bigint
		status: number
	}
	const due = ids
		.map((id, i) => ({ id, m: state[i] as M }))
		.filter(({ m }) => m.status === STATUS_OPEN && m.closeTime <= now)
		.slice(0, cfg.maxMarketsPerRun)
	const [batch0, batch1, fees] = state.slice(ids.length) as [bigint, bigint, bigint]

	const priced = due.filter(({ m }) => m.source === SOURCE_PRICE)
	const rounds = multi(priced.map(({ m }) => ({ to: m.priceFeed, abi: feedAbi, functionName: 'latestRoundData' }))) as [
		bigint,
		bigint,
		bigint,
		bigint,
		bigint,
	][]

	const actions: Action[] = []
	for (const { id, m } of due) {
		let code: number
		if (m.source === SOURCE_PRICE) {
			const [, price, , updatedAt] = rounds[priced.findIndex((p) => p.id === id)]
			code = priceOutcome(price, updatedAt, m.closeTime, m.threshold)
		} else if (m.source === SOURCE_SPORTS) {
			code = http
				.sendRequest(runtime, fetchSportsCode, consensusMedianAggregation<number>())(
					espnUrl(m.sourceRef, cfg.espnBaseUrl),
					m.sourceRef,
					m.numSides,
					m.outcomes,
				)
				.result()
		} else {
			continue
		}
		const action = toAction(id, code, m.numSides)
		runtime.log(`market ${id} "${m.question}": ${action ? `kind ${action.kind} outcome ${action.outcome}` : 'no result yet'}`)
		if (action) actions.push(action)
	}
	const checked = due.length

	// Upkeep: ready batches (USDC->WETH, WETH->USDC) and the LP donation.
	const executable = multi([batch0, batch1].map((id) => ({ to: cfg.batches, abi: batchesAbi, functionName: 'isExecutable', args: [id] }))) as boolean[]
	const ready = [batch0, batch1].filter((_, i) => executable[i])
	const upkeep = upkeepActions(ready, fees, actions)
	for (const a of upkeep) runtime.log(a.kind === 3 ? `batch ${a.id} ready to execute` : `donating market fees to LPs`)
	actions.push(...upkeep)

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

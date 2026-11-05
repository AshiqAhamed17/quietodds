// Pure, deterministic pieces of the resolver: no SDK, no I/O. Unit-tested.

/** ResolverReceiver action kinds. */
export const KIND_RESOLVE = 1
export const KIND_CANCEL = 2

/** Markets.Status / Markets.Source */
export const STATUS_OPEN = 1
export const SOURCE_PRICE = 0
export const SOURCE_SPORTS = 1

/** Consensus codes for a sports result: a side, or one of these. */
export const PENDING = -1
export const CANCEL = 100

export interface Action {
	kind: number
	id: bigint
	outcome: number
}

/** "espn:soccer/eng.1:401878757" -> the ESPN single-event scoreboard URL. */
export function espnUrl(sourceRef: string, base: string): string {
	const m = /^espn:([a-z]+)\/([a-z0-9._]+):([0-9]+)$/.exec(sourceRef)
	if (!m) throw new Error(`bad sports sourceRef: ${sourceRef}`)
	return `${base}/${m[1]}/${m[2]}/scoreboard/${m[3]}`
}

/** ESPN statuses after which the match will not be decided. */
const VOID_STATUSES = new Set(['STATUS_CANCELED', 'STATUS_POSTPONED', 'STATUS_ABANDONED', 'STATUS_SUSPENDED'])

interface EspnEvent {
	competitions?: Array<{
		status?: { type?: { name?: string; completed?: boolean } }
		competitors?: Array<{ homeAway?: string; score?: string }>
	}>
}

/**
 * Side order on chain is home | draw | away (3 sides) or home | away (2).
 * A draw in a 2-sided market has no winner, so it refunds.
 */
export function sportsOutcome(event: EspnEvent, numSides: number): number {
	const c = event.competitions?.[0]
	const status = c?.status?.type
	if (!status?.name) throw new Error('ESPN response has no status')
	if (VOID_STATUSES.has(status.name)) return CANCEL
	if (!status.completed) return PENDING

	const score = (side: string) => {
		const s = c?.competitors?.find((x) => x.homeAway === side)?.score
		if (s === undefined || !/^[0-9]+$/.test(s)) throw new Error(`ESPN ${side} score missing`)
		return Number(s)
	}
	const home = score('home')
	const away = score('away')
	if (numSides === 3) return home > away ? 0 : home === away ? 1 : 2
	if (numSides === 2) return home > away ? 0 : home === away ? CANCEL : 1
	throw new Error(`unsupported sports market with ${numSides} sides`)
}

/** Mirrors Markets.resolveFromFeed: YES (1) iff price > threshold. */
export function priceOutcome(
	price: bigint,
	updatedAt: bigint,
	closeTime: bigint,
	threshold: bigint,
): number {
	if (price <= 0n || updatedAt < closeTime) return PENDING // no post-close price yet
	return price > threshold ? 1 : 0
}

export function toAction(id: bigint, code: number, numSides: number): Action | null {
	if (code === PENDING) return null
	if (code === CANCEL) return { kind: KIND_CANCEL, id, outcome: 0 }
	if (!Number.isInteger(code) || code < 0 || code >= numSides) throw new Error(`bad outcome ${code} for market ${id}`)
	return { kind: KIND_RESOLVE, id, outcome: code }
}

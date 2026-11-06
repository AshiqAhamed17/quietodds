import { describe, expect, test } from 'bun:test'
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from 'viem'
import {
	CANCEL,
	KIND_CANCEL,
	KIND_DONATE_FEES,
	KIND_EXECUTE_BATCH,
	KIND_RESOLVE,
	PENDING,
	espnUrl,
	priceOutcome,
	sportsOutcome,
	raceOutcome,
	espnOutcome,
	toAction,
	upkeepActions,
} from './logic'
import { initWorkflow } from './main'

const event = (name: string, completed: boolean, home: string, away: string) => ({
	competitions: [
		{
			status: { type: { name, completed } },
			competitors: [
				{ homeAway: 'home', score: home },
				{ homeAway: 'away', score: away },
			],
		},
	],
})

describe('espnUrl', () => {
	test('builds the single-event scoreboard URL', () => {
		expect(espnUrl('espn:soccer/eng.1:401878757', 'https://x/sports')).toBe(
			'https://x/sports/soccer/eng.1/scoreboard/401878757',
		)
	})
	test('rejects anything else', () => {
		expect(() => espnUrl('espn:soccer/eng.1:../../x', 'https://x')).toThrow()
		expect(() => espnUrl('football-data:123', 'https://x')).toThrow()
	})
})

describe('sportsOutcome', () => {
	test('home | draw | away for 3-sided markets', () => {
		expect(sportsOutcome(event('STATUS_FULL_TIME', true, '2', '1'), 3)).toBe(0)
		expect(sportsOutcome(event('STATUS_FULL_TIME', true, '1', '1'), 3)).toBe(1)
		expect(sportsOutcome(event('STATUS_FULL_TIME', true, '0', '1'), 3)).toBe(2)
	})
	test('a draw refunds a 2-sided market', () => {
		expect(sportsOutcome(event('STATUS_FULL_TIME', true, '1', '1'), 2)).toBe(CANCEL)
		expect(sportsOutcome(event('STATUS_FULL_TIME', true, '0', '3'), 2)).toBe(1)
	})
	test('pending until completed; void statuses cancel', () => {
		expect(sportsOutcome(event('STATUS_SCHEDULED', false, '0', '0'), 3)).toBe(PENDING)
		expect(sportsOutcome(event('STATUS_SECOND_HALF', false, '1', '0'), 3)).toBe(PENDING)
		expect(sportsOutcome(event('STATUS_POSTPONED', false, '0', '0'), 3)).toBe(CANCEL)
	})
	test('throws on a malformed response instead of guessing', () => {
		expect(() => sportsOutcome({}, 3)).toThrow()
		expect(() => sportsOutcome(event('STATUS_FULL_TIME', true, '', '1'), 3)).toThrow()
	})
})

describe('priceOutcome', () => {
	test('YES only strictly above the threshold, and only after close', () => {
		expect(priceOutcome(2301n, 100n, 100n, 2300n)).toBe(1)
		expect(priceOutcome(2300n, 100n, 100n, 2300n)).toBe(0)
		expect(priceOutcome(2400n, 99n, 100n, 2300n)).toBe(PENDING)
		expect(priceOutcome(0n, 200n, 100n, 2300n)).toBe(PENDING)
	})
})

describe('toAction and report encoding', () => {
	test('maps codes to receiver actions', () => {
		expect(toAction(3n, PENDING, 3)).toBeNull()
		expect(toAction(3n, CANCEL, 3)).toEqual({ kind: KIND_CANCEL, id: 3n, outcome: 0 })
		expect(toAction(3n, 2, 3)).toEqual({ kind: KIND_RESOLVE, id: 3n, outcome: 2 })
		expect(() => toAction(3n, 3, 3)).toThrow()
	})
	test('encodes as ResolverReceiver.Action[]', () => {
		const t = parseAbiParameters('(uint8 kind, uint256 id, uint8 outcome)[]')
		const actions = [{ kind: 1, id: 2n, outcome: 0 }]
		const [decoded] = decodeAbiParameters(t, encodeAbiParameters(t, [actions]))
		expect(decoded).toEqual(actions)
	})
})

describe('upkeepActions', () => {
	test('executes every ready batch', () => {
		expect(upkeepActions([3n, 4n], 0n, [])).toEqual([
			{ kind: KIND_EXECUTE_BATCH, id: 3n, outcome: 0 },
			{ kind: KIND_EXECUTE_BATCH, id: 4n, outcome: 0 },
		])
	})
	test('donates when fees are accrued or a resolve in this report accrues them', () => {
		const donate = { kind: KIND_DONATE_FEES, id: 0n, outcome: 0 }
		expect(upkeepActions([], 5n, [])).toEqual([donate])
		expect(upkeepActions([], 0n, [{ kind: KIND_RESOLVE, id: 1n, outcome: 0 }])).toEqual([donate])
		expect(upkeepActions([], 0n, [{ kind: KIND_CANCEL, id: 1n, outcome: 0 }])).toEqual([])
	})
})

test('one cron handler on the configured schedule', () => {
	const handlers = initWorkflow({
		schedule: '0 */10 * * * *', chainSelectorName: 'ethereum-testnet-sepolia', markets: '0x0', receiver: '0x0', batches: '0x0',
		readAt: 'latest', maxMarketsPerRun: 4, espnBaseUrl: 'https://x', gasLimit: '1',
	})
	expect(handlers).toHaveLength(1)
	expect((handlers[0].trigger as unknown as { config: { schedule: string } }).config.schedule).toBe('0 */10 * * * *')
})

describe('raceOutcome', () => {
	const race = (name: string, completed: boolean, winner?: string) => ({
		competitions: [
			{ type: { abbreviation: 'Qual' }, status: { type: { name: 'STATUS_FINAL', completed: true } }, competitors: [] },
			{
				type: { abbreviation: 'Race' },
				status: { type: { name, completed } },
				competitors: winner ? [{ winner: true, order: 1, athlete: { displayName: winner } }, { winner: false, order: 2, athlete: { displayName: 'Someone' } }] : [],
			},
		],
	})
	const sides = ['Kimi Antonelli', 'Max Verstappen', 'Lewis Hamilton', 'Anyone else']
	test('the named winner, or the field', () => {
		expect(raceOutcome(race('STATUS_FINAL', true, 'Max Verstappen'), sides)).toBe(1)
		expect(raceOutcome(race('STATUS_FINAL', true, 'Lando Norris'), sides)).toBe(3)
		expect(raceOutcome(race('STATUS_FINAL', true, 'Lando Norris'), sides.slice(0, 3))).toBe(CANCEL)
	})
	test('pending until the race is final; void statuses cancel', () => {
		expect(raceOutcome(race('STATUS_SCHEDULED', false), sides)).toBe(PENDING)
		expect(raceOutcome(race('STATUS_CANCELED', false), sides)).toBe(CANCEL)
	})
	test('espnOutcome routes racing refs', () => {
		expect(espnOutcome('espn:racing/f1:600057447', race('STATUS_FINAL', true, 'Kimi Antonelli'), 4, sides.join('|'))).toBe(0)
	})
})

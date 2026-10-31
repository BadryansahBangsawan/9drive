import test from 'node:test'
import assert from 'node:assert/strict'
import { groupByDay } from '../src/lib/dates.ts'

const now = new Date(2026, 9, 31, 15, 0, 0)
const daysAgo = (n: number, h = 10) => new Date(2026, 9, 31 - n, h, 0, 0).toISOString()
const get = (x: { d: string }) => x.d

test('groups into Today, Yesterday, Earlier this week, Older in order', () => {
  const items = [{ d: daysAgo(10) }, { d: daysAgo(3) }, { d: daysAgo(1) }, { d: daysAgo(0) }]
  const groups = groupByDay(items, get, now)
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', 'Earlier this week', 'Older'])
  assert.equal(groups[2].items[0].d, daysAgo(3))
  assert.equal(groups[3].items[0].d, daysAgo(10))
})

test('omits empty groups and keeps input order', () => {
  const items = [{ d: daysAgo(0, 9) }, { d: daysAgo(0, 14) }]
  const groups = groupByDay(items, get, now)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, 'Today')
  assert.deepEqual(groups[0].items, items)
})

test('empty input gives no groups', () => {
  assert.deepEqual(groupByDay([], get, now), [])
})

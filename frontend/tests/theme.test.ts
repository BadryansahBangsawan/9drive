import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme } from '../src/lib/theme.ts'

test('system follows OS preference', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
})
test('explicit choice wins over OS preference', () => {
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})

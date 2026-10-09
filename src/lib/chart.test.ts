import { describe, expect, it } from 'vitest'
import { niceTicks, shortNum, toNumber } from './chart'

describe('niceTicks', () => {
  it('uses 1-2-5 steps', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(3, 97, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
  it('handles a degenerate range', () => {
    const t = niceTicks(5, 5)
    expect(t[0]).toBeLessThan(5)
    expect(t[t.length - 1]).toBeGreaterThan(5)
  })
  it('returns nothing for non-finite input', () => {
    expect(niceTicks(NaN, 1)).toEqual([])
  })
})

describe('toNumber / shortNum', () => {
  it('coerces', () => {
    expect(toNumber(3n)).toBe(3)
    expect(toNumber('2.5')).toBe(2.5)
    expect(toNumber('abc')).toBeNull()
    expect(toNumber('')).toBeNull()
    expect(toNumber(null)).toBeNull()
    expect(toNumber(new Date(5))).toBe(5)
  })
  it('abbreviates', () => {
    expect(shortNum(1500000)).toBe('1.5M')
    expect(shortNum(12000)).toBe('12k')
    expect(shortNum(0.5)).toBe('0.5')
    expect(shortNum(0)).toBe('0')
  })
})

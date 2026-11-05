/**
 * Formatting helpers used across the UI.
 */
import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatPercent,
  formatRatio,
  formatRate,
  formatRelativeTime,
  shortHash
} from '../src/renderer/src/utils/format'

describe('formatBytes', () => {
  it('formats binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB')
  })

  it('handles negatives and garbage', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('formatRate', () => {
  it('renders an em dash for idle rates', () => {
    expect(formatRate(0)).toBe('—')
    expect(formatRate(-5)).toBe('—')
  })

  it('appends /s', () => {
    expect(formatRate(2048)).toBe('2.00 KB/s')
  })
})

describe('formatPercent', () => {
  it('clamps and formats', () => {
    expect(formatPercent(0)).toBe('0.00%')
    expect(formatPercent(0.4231)).toBe('42.31%')
    expect(formatPercent(1)).toBe('100.0%')
    expect(formatPercent(2)).toBe('100.0%')
  })
})

describe('formatEta', () => {
  it('formats multi-unit durations', () => {
    expect(formatEta(-1)).toBe('∞')
    expect(formatEta(0)).toBe('0s')
    expect(formatEta(45)).toBe('45s')
    expect(formatEta(300)).toBe('5m')
    expect(formatEta(3725)).toBe('1h 2m')
    expect(formatEta(180000)).toBe('2d 2h')
  })
})

describe('formatDuration', () => {
  it('formats clock style', () => {
    expect(formatDuration(-1)).toBe('—')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
  })
})

describe('formatRatio', () => {
  it('avoids division by zero', () => {
    expect(formatRatio(0, 0)).toBe('0.00')
    expect(formatRatio(0, 5)).toBe('∞')
    expect(formatRatio(100, 250)).toBe('2.50')
  })
})

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000
  it('scales units', () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe('5s')
    expect(formatRelativeTime(now - 120_000, now)).toBe('2m')
    expect(formatRelativeTime(now - 7_200_000, now)).toBe('2h')
    expect(formatRelativeTime(now - 172_800_000, now)).toBe('2d')
    expect(formatRelativeTime(0, now)).toBe('—')
  })
})

describe('shortHash', () => {
  it('abbreviates long hashes', () => {
    const hash = 'a'.repeat(40)
    expect(shortHash(hash)).toBe('aaaaaaaa…aaaaaa')
    expect(shortHash('')).toBe('—')
    expect(shortHash('abc')).toBe('abc')
  })
})

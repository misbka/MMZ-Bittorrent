/**
 * Speed schedule resolution: windows, wrap-around and precedence.
 */
import { describe, expect, it } from 'vitest'
import { activeRuleFor, parseClock, ruleToWindow } from '../src/main/schedule'
import type { ScheduleRule } from '../src/shared/settings'

function rule(partial: Partial<ScheduleRule>): ScheduleRule {
  return {
    id: partial.id ?? 'r1',
    enabled: partial.enabled ?? true,
    days: partial.days ?? [1, 2, 3, 4, 5],
    from: partial.from ?? '22:00',
    to: partial.to ?? '07:00',
    downloadLimit: partial.downloadLimit ?? 500,
    uploadLimit: partial.uploadLimit ?? 100
  }
}

function at(day: number, hh: number, mm = 0): Date {
  // 2026-11-01 was a Sunday; build a date in the requested weekday
  const base = new Date(2026, 10, 1, hh, mm, 0, 0)
  const delta = (day - base.getDay() + 7) % 7
  base.setDate(base.getDate() + delta)
  return base
}

describe('parseClock', () => {
  it('parses HH:MM', () => {
    expect(parseClock('00:00')).toBe(0)
    expect(parseClock('23:59')).toBe(23 * 60 + 59)
    expect(parseClock('9:05')).toBe(9 * 60 + 5)
  })

  it('rejects garbage', () => {
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('12:60')).toBeNull()
    expect(parseClock('noon')).toBeNull()
  })
})

describe('ruleToWindow', () => {
  it('converts a rule', () => {
    const window = ruleToWindow(rule({ from: '08:30', to: '18:00' }))
    expect(window).not.toBeNull()
    expect(window?.fromMinutes).toBe(8 * 60 + 30)
    expect(window?.toMinutes).toBe(18 * 60)
  })
})

describe('activeRuleFor', () => {
  it('returns null when nothing matches', () => {
    expect(activeRuleFor([], at(1, 12))).toBeNull()
    expect(activeRuleFor([rule({ days: [0], from: '01:00', to: '02:00' })], at(1, 12))).toBeNull()
  })

  it('matches inside a same-day window', () => {
    const rules = [rule({ days: [1], from: '09:00', to: '17:00' })]
    expect(activeRuleFor(rules, at(1, 12))?.id).toBe('r1')
    expect(activeRuleFor(rules, at(1, 8))).toBeNull()
    expect(activeRuleFor(rules, at(1, 17))).toBeNull() // end is exclusive
  })

  it('wraps over midnight', () => {
    const rules = [rule({ days: [1], from: '22:00', to: '06:00' })]
    expect(activeRuleFor(rules, at(1, 23))?.id).toBe('r1') // Monday night
    expect(activeRuleFor(rules, at(2, 5))?.id).toBe('r1') // Tuesday morning = Monday's window
    expect(activeRuleFor(rules, at(1, 12))).toBeNull()
    expect(activeRuleFor(rules, at(2, 7))).toBeNull()
  })

  it('ignores disabled rules', () => {
    const rules = [rule({ enabled: false, days: [1], from: '00:00', to: '23:59' })]
    expect(activeRuleFor(rules, at(1, 12))).toBeNull()
  })

  it('picks the most recently started matching rule', () => {
    const rules = [
      rule({ id: 'nightly', days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', downloadLimit: 100 }),
      rule({ id: 'boost', days: [1], from: '12:00', to: '13:00', downloadLimit: 9999 })
    ]
    expect(activeRuleFor(rules, at(1, 12, 30))?.id).toBe('boost')
    expect(activeRuleFor(rules, at(1, 14))?.id).toBe('nightly')
    expect(activeRuleFor(rules, at(1, 11))?.id).toBe('nightly')
  })

  it('handles a wrapped rule started on the previous day', () => {
    const rules = [
      rule({ id: 'all', days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', downloadLimit: 10 }),
      rule({ id: 'overnight', days: [1], from: '23:00', to: '04:00', downloadLimit: 500 })
    ]
    // Tuesday 02:00 -> Monday's overnight window is active and more recent
    expect(activeRuleFor(rules, at(2, 2))?.id).toBe('overnight')
  })
})

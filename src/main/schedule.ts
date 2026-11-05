/**
 * Speed schedule resolution: which configured rule (if any) owns `now`.
 *
 * Rules carry a weekday set and an "HH:MM" start/end window.  A window that
 * ends before it starts (e.g. 22:00 -> 06:00) wraps over midnight and is
 * evaluated against the previous day as well, so a Sunday night rule still
 * applies on Monday morning.
 */
import type { ScheduleRule } from '@shared/settings'

export interface TimeWindow {
  days: number[]
  fromMinutes: number
  toMinutes: number
  downloadLimit: number
  uploadLimit: number
  id: string
}

export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function ruleToWindow(rule: ScheduleRule): TimeWindow | null {
  const from = parseClock(rule.from)
  const to = parseClock(rule.to)
  if (from === null || to === null) return null
  return {
    id: rule.id,
    days: rule.days,
    fromMinutes: from,
    toMinutes: to,
    downloadLimit: rule.downloadLimit,
    uploadLimit: rule.uploadLimit
  }
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function isRuleActive(window: TimeWindow, date: Date): boolean {
  const now = minutesOfDay(date)
  const day = date.getDay()

  // window entirely inside one day
  if (window.fromMinutes <= window.toMinutes) {
    return window.days.includes(day) && now >= window.fromMinutes && now < window.toMinutes
  }

  // wrapped window: tail belongs to `day`, head to the previous day
  const tailActive = window.days.includes(day) && now >= window.fromMinutes
  const previousDay = (day + 6) % 7
  const headActive = window.days.includes(previousDay) && now < window.toMinutes
  return tailActive || headActive
}

/**
 * Returns the rule in force at `date`.  When several rules match, the one
 * that started most recently wins (mirrors µTorrent behaviour), so a short
 * "boost" window can override a long-running nightly rule.
 */
export function activeRuleFor(rules: ScheduleRule[], date: Date = new Date()): ScheduleRule | null {
  const now = minutesOfDay(date)
  let best: ScheduleRule | null = null
  let bestStart = -1

  for (const rule of rules) {
    if (!rule.enabled) continue
    const window = ruleToWindow(rule)
    if (!window || !isRuleActive(window, date)) continue
    const startedAt =
      window.fromMinutes <= window.toMinutes || now >= window.fromMinutes
        ? window.fromMinutes
        : window.fromMinutes + 1440 // wrapped head: started yesterday
    if (startedAt > bestStart) {
      bestStart = startedAt
      best = rule
    }
  }
  return best
}

/** Human-readable formatting helpers used across the UI. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** 1536 -> "1.5 KB" (binary units, like every other torrent client). */
export function formatBytes(bytes: number, digits = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  const decimals = value >= 100 || exponent === 0 ? 0 : digits
  return `${value.toFixed(decimals)} ${UNITS[exponent]}`
}

/** 1536 -> "1.5 KB/s". */
export function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** Signed rate for the table (download ↓ / upload ↑). */
export function formatRateSigned(bytesPerSecond: number, direction: 'down' | 'up'): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  const arrow = direction === 'down' ? '↓' : '↑'
  return `${arrow} ${formatBytes(bytesPerSecond)}/s`
}

/** 0.4231 -> "42.31%". */
export function formatPercent(progress: number): string {
  const value = Math.max(0, Math.min(1, progress)) * 100
  return `${value < 100 ? value.toFixed(2) : value.toFixed(1)}%`
}

/** Seconds -> "3d 4h", "2h 5m", "4m 12s", "12s"; -1 -> "∞". */
export function formatEta(seconds: number): string {
  if (seconds < 0 || !Number.isFinite(seconds)) return '∞'
  if (seconds === 0) return '0s'
  const units: [number, string][] = [
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's']
  ]
  let remaining = Math.floor(seconds)
  const parts: string[] = []
  for (const [size, label] of units) {
    if (remaining >= size) {
      const value = Math.floor(remaining / size)
      parts.push(`${value}${label}`)
      remaining -= value * size
    }
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

/** Seconds -> "1:23:45" style elapsed time. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function formatRatio(downloaded: number, uploaded: number): string {
  if (downloaded <= 0) return uploaded > 0 ? '∞' : '0.00'
  return (uploaded / downloaded).toFixed(2)
}

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString()
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '—'
  const diff = Math.max(0, now - timestamp) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`
  return new Date(timestamp).toLocaleDateString()
}

/** Shorten a hash for display: abcdef…123456. */
export function shortHash(hash: string): string {
  if (!hash) return '—'
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash
}

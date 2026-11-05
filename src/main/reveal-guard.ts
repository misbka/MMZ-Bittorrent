/**
 * Sandbox for "reveal in file manager" / "open folder" requests.
 *
 * The renderer may only point the OS at folders the app actually owns: the
 * configured download roots plus the destination of each known torrent (which
 * can be any folder picked in the add dialog).
 *
 * Pure Node code — no Electron imports — so it can be unit tested directly.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve a path for comparison: absolute, with symlinks/junctions collapsed
 * (redirected Downloads, `subst` drives) and Windows casing normalised by the
 * OS.  Falls back to the plain resolved path when it does not exist yet.
 */
export function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

/** True when `target` is `root` itself or lives somewhere below it. */
export function isInsideRoot(target: string, root: string): boolean {
  const rel = path.relative(normalizeForCompare(root), normalizeForCompare(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** True when `target` is inside at least one allowed root. */
export function isInsideAnyRoot(target: string, roots: string[]): boolean {
  return roots.some((root) => isInsideRoot(target, root))
}

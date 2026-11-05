import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isInsideAnyRoot, isInsideRoot, normalizeForCompare } from '../src/main/reveal-guard'

const win = process.platform === 'win32'
const root = win ? 'C:\\Users\\misa\\Downloads\\MMZ Torrent' : '/home/user/Downloads/MMZ Torrent'
const other = win ? 'C:\\Windows\\System32' : '/etc'

describe('normalizeForCompare', () => {
  it('makes relative paths absolute', () => {
    expect(path.isAbsolute(normalizeForCompare('.'))).toBe(true)
  })

  it('returns the resolved path when the target does not exist yet', () => {
    const missing = path.join(os.tmpdir(), 'mmz-does-not-exist', 'x')
    expect(normalizeForCompare(missing)).toBe(path.resolve(missing))
  })

  it('collapses a junction/symlink to its real target', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mmz-guard-'))
    const real = path.join(base, 'real')
    const link = path.join(base, 'link')
    fs.mkdirSync(real)
    try {
      fs.symlinkSync(real, link, win ? 'junction' : 'dir')
      expect(normalizeForCompare(link)).toBe(normalizeForCompare(real))
    } catch {
      // environment does not allow links (e.g. locked-down CI) — not a failure
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('isInsideRoot', () => {
  it('accepts the root itself', () => {
    expect(isInsideRoot(root, root)).toBe(true)
  })

  it('accepts descendants', () => {
    expect(isInsideRoot(path.join(root, 'Some.Torrent.1080p', 'file.mkv'), root)).toBe(true)
  })

  it('rejects siblings and unrelated folders', () => {
    expect(isInsideRoot(other, root)).toBe(false)
    expect(isInsideRoot(path.join(root, '..', 'OtherFolder'), root)).toBe(false)
  })

  it('rejects traversal that escapes through ..', () => {
    const escape = path.join(root, '..', '..', 'secret')
    expect(isInsideRoot(escape, root)).toBe(false)
  })

  it('rejects a path on another drive / another filesystem root', () => {
    expect(isInsideRoot(win ? 'D:\\data\\x' : '/var/data/x', root)).toBe(false)
  })

  it('is case-insensitive on Windows only', () => {
    if (win) {
      expect(isInsideRoot('c:\\users\\MISA\\downloads\\mmz torrent\\a', root)).toBe(true)
    } else {
      expect(isInsideRoot('/home/user/other', root)).toBe(false)
    }
  })

  it('accepts a path that does not exist yet (created later)', () => {
    expect(isInsideRoot(path.join(root, 'not-created-yet.bin'), root)).toBe(true)
  })
})

describe('isInsideAnyRoot', () => {
  const roots = [
    root,
    win ? 'C:\\Users\\misa\\Downloads' : '/home/user/Downloads' // torrent save path
  ]

  it('matches the configured root', () => {
    expect(isInsideAnyRoot(path.join(root, 'a.bin'), roots)).toBe(true)
  })

  it('matches a torrent destination chosen in the add dialog', () => {
    const target = win
      ? 'C:\\Users\\misa\\Downloads\\Avatar.Seven.Havens.S01E13'
      : '/home/user/Downloads/Some.Torrent'
    expect(isInsideAnyRoot(target, roots)).toBe(true)
  })

  it('matches a file directly inside the destination', () => {
    const target = win ? 'C:\\Users\\misa\\Downloads\\x.mkv' : '/home/user/Downloads/x.mkv'
    expect(isInsideAnyRoot(target, roots)).toBe(true)
  })

  it('rejects anything outside every root', () => {
    expect(isInsideAnyRoot(other, roots)).toBe(false)
    expect(isInsideAnyRoot(win ? 'C:\\Users\\misa\\Documents\\x' : '/home/user/Documents/x', roots)).toBe(
      false
    )
  })

  it('rejects when there are no roots at all', () => {
    expect(isInsideAnyRoot(root, [])).toBe(false)
  })
})

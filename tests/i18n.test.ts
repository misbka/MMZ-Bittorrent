/**
 * i18n: the three dictionaries must expose exactly the same key set, and the
 * interpolation/fallback chain must behave as documented.
 */
import { describe, expect, it } from 'vitest'
import ptBR from '../src/renderer/src/locales/pt-BR.json'
import es from '../src/renderer/src/locales/es.json'
import en from '../src/renderer/src/locales/en.json'

type Dict = Record<string, unknown>

function flatten(dict: Dict, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') keys.push(...flatten(value as Dict, path))
    else keys.push(path)
  }
  return keys.sort()
}

const ptKeys = flatten(ptBR as Dict)
const esKeys = flatten(es as Dict)
const enKeys = flatten(en as Dict)

describe('locales', () => {
  it('has translations for pt-BR, es and en', () => {
    expect(ptKeys.length).toBeGreaterThan(150)
  })

  it('keeps identical key sets across languages', () => {
    expect(esKeys).toEqual(ptKeys)
    expect(enKeys).toEqual(ptKeys)
  })

  it('has no empty translations', () => {
    for (const dict of [ptBR, es, en] as Dict[]) {
      const walk = (node: Dict, path: string): void => {
        for (const [key, value] of Object.entries(node)) {
          const full = path ? `${path}.${key}` : key
          if (value && typeof value === 'object') walk(value as Dict, full)
          else expect(String(value).trim(), `${full} is empty`).not.toBe('')
        }
      }
      walk(dict, '')
    }
  })

  it('keeps interpolation placeholders consistent between languages', () => {
    const placeholders = (value: string): string[] =>
      (value.match(/\{(\w+)\}/g) ?? []).sort()
    const walk = (node: Dict, path: string): void => {
      for (const [key, value] of Object.entries(node)) {
        const full = path ? `${path}.${key}` : key
        if (value && typeof value === 'object') {
          walk(value as Dict, full)
          continue
        }
        const reference = placeholders(lookup(ptBR as Dict, full))
        expect(placeholders(String(value)), `${full} placeholders`).toEqual(reference)
      }
    }
    walk(es as Dict, '')
    walk(en as Dict, '')
  })
})

function lookup(dict: Dict, path: string): string {
  let node: unknown = dict
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return ''
    node = (node as Dict)[part]
  }
  return String(node)
}

describe('locale fallback chain', () => {
  it('prefers the requested language, then pt-BR', () => {
    expect(lookup(en as Dict, 'toolbar.add')).toBe('Add')
    expect(lookup(ptBR as Dict, 'toolbar.add')).toBe('Adicionar')
    expect(lookup(es as Dict, 'toolbar.add')).toBe('Añadir')
  })

  it('covers every key used by the settings sections', () => {
    const sections = ['general', 'downloads', 'connection', 'speed', 'bittorrent', 'interface', 'advanced']
    for (const section of sections) {
      expect(lookup(ptBR as Dict, `settings.${section}`)).not.toBe('')
    }
  })
})

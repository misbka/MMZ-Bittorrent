/**
 * Minimal i18n runtime: nested JSON dictionaries, `pt-BR` fallback chain
 * (requested -> pt-BR -> key itself) and a React context so components can
 * re-render when the language changes.
 */
import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { Language } from '@shared/types'
import ptBR from '../locales/pt-BR.json'
import es from '../locales/es.json'
import en from '../locales/en.json'

type Dict = Record<string, unknown>

const DICTIONARIES: Record<Language, Dict> = {
  'pt-BR': ptBR as Dict,
  es: es as Dict,
  en: en as Dict
}

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' }
]

function lookup(dict: Dict | undefined, key: string): string | undefined {
  if (!dict) return undefined
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Dict)[part]
  }
  return typeof node === 'string' ? node : undefined
}

export interface I18n {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18n | null>(null)

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  )
}

export function I18nProvider(props: {
  language: Language
  onLanguageChange: (language: Language) => void
  children: ReactNode
}): ReactNode {
  const { language, onLanguageChange, children } = props

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const value =
        lookup(DICTIONARIES[language], key) ??
        lookup(DICTIONARIES['pt-BR'], key) ??
        lookup(DICTIONARIES['en'], key)
      if (value === undefined) {
        if (typeof import.meta !== 'undefined' && 'env' in import.meta) console.warn(`[i18n] missing key: ${key}`)
        return key
      }
      return interpolate(value, vars)
    },
    [language]
  )

  const value = useMemo<I18n>(
    () => ({ language, setLanguage: onLanguageChange, t }),
    [language, onLanguageChange, t]
  )

  return createElement(I18nContext.Provider, { value }, children)
}

export function useI18n(): I18n {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>')
  return context
}

export function useT(): I18n['t'] {
  return useI18n().t
}

/** Applies the theme setting (light / dark / system) to <html>. */
import { useEffect } from 'react'
import type { ThemeMode } from '@shared/types'

export function useTheme(mode: ThemeMode | undefined): void {
  useEffect(() => {
    if (!mode) return
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = (): void => {
      const dark = mode === 'dark' || (mode === 'system' && media.matches)
      root.classList.toggle('dark', dark)
    }

    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode])
}

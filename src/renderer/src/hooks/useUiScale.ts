/** Applies the interface scale setting (0.8 - 2.0) as a root font size. */
import { useEffect } from 'react'

export function useUiScale(scale: number | undefined): void {
  useEffect(() => {
    if (!scale) return
    document.documentElement.style.fontSize = `${Math.round(16 * scale)}px`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [scale])
}

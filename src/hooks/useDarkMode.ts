import { useSyncExternalStore } from 'react'

const darkQuery = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

function subscribe(callback: () => void) {
  // Watch both .dark class changes AND media query changes
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  darkQuery?.addEventListener('change', callback)
  return () => {
    observer.disconnect()
    darkQuery?.removeEventListener('change', callback)
  }
}

function getSnapshot() {
  return document.documentElement.classList.contains('dark') ||
    (darkQuery?.matches ?? false)
}

export function useDarkMode() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

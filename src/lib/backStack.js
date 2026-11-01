import { useEffect, useRef } from 'react'

// Panels and menus that are open, newest last. The Android back button and Escape close the newest one.
const stack = []

/** While `active`, Back and Escape call `onBack` (when this is the newest open panel). */
export function useBack(onBack, active = true) {
  const handler = useRef(onBack)
  useEffect(() => { handler.current = onBack })
  useEffect(() => {
    if (!active) return
    const entry = () => handler.current?.()
    stack.push(entry)
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}

/** Close the newest open panel. False when none is open. */
export function closeTopPanel() {
  const top = stack[stack.length - 1]
  if (!top) return false
  top()
  return true
}

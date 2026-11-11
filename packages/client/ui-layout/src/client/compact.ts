/**
 * Compact frame mode of the Desktop floating assistant panel: the shell loads
 * the product document with `?dshCompact=1`, and the frame renders only the
 * centre column under a shell drag strip, without the navigation columns,
 * the bottom row, and the window-chrome seat.
 *
 * The flag is snapped from the initial URL onto `document.documentElement` so
 * it survives in-app navigations that replace the search params (React Router
 * only preserves the pathname on programmatic navigation).
 */

const COMPACT_ATTR = 'data-compact-frame'

function resolveCompact(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  if (root.hasAttribute(COMPACT_ATTR)) return root.getAttribute(COMPACT_ATTR) === 'true'
  const compact = new URLSearchParams(globalThis.location.search).has('dshCompact')
  root.setAttribute(COMPACT_ATTR, String(compact))
  return compact
}

/** True when the current document opts into the compact single-column frame. */
export function isCompactFrame(): boolean {
  return resolveCompact()
}

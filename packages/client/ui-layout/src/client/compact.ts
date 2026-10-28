/**
 * Compact frame mode of the Desktop floating assistant panel: the shell loads
 * the product document with `?dshCompact=1`, and the frame renders only the
 * centre column under a shell drag strip, without the navigation columns,
 * the bottom row, and the window-chrome seat.
 */

/** True when the current document opts into the compact single-column frame. */
export function isCompactFrame(): boolean {
  return new URLSearchParams(globalThis.location.search).has('dshCompact')
}

// Pre-flight the two macOS privileges the GUI agent needs, so a missing grant
// surfaces as an actionable error instead of a SIGBUS inside libnut's capture.
import koffi from 'koffi'

const CORE_GRAPHICS = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics'
const APPLICATION_SERVICES = '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'

/**
 * Whether this process may capture the screen without crashing libnut.
 * @returns 'authorized' off macOS or when the TCC grant is present, else 'denied'.
 */
export function screenCaptureStatus() {
  if (process.platform !== 'darwin') return 'authorized'
  const preflight = koffi.load(CORE_GRAPHICS).func('bool CGPreflightScreenCaptureAccess()')
  return preflight() ? 'authorized' : 'denied'
}

/**
 * Ask macOS to show its one-time screen-recording prompt for this process.
 * @returns whether the prompt was presented; the grant itself arrives later, in System Settings.
 */
export function requestScreenCapture() {
  const request = koffi.load(CORE_GRAPHICS).func('bool CGRequestScreenCaptureAccess()')
  return request()
}

/**
 * Whether this process may synthesize mouse and keyboard events.
 * @returns true off macOS or when the Accessibility grant is present.
 */
export function accessibilityTrusted() {
  if (process.platform !== 'darwin') return true
  const trusted = koffi.load(APPLICATION_SERVICES).func('bool AXIsProcessTrusted()')
  return trusted()
}

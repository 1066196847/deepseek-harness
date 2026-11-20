// Drop the current process to the macOS accessory activation policy (no Dock
// icon, no menu bar) through the ObjC runtime, for processes that run the
// Electron binary in Node mode and therefore have no Electron `app` object.
import koffi from 'koffi'

/** NSApplicationActivationPolicyAccessory: present in the switcher-less background, absent from the Dock. */
const POLICY_ACCESSORY = 1

/**
 * Create the shared NSApplication and set its activation policy to accessory.
 * Must run before any library (libnut) initializes AppKit, so the policy is
 * already accessory when the shared instance is first created elsewhere.
 * @throws when the ObjC runtime or AppKit cannot be loaded or reached.
 */
export function setAccessoryActivationPolicy() {
  if (process.platform !== 'darwin') return
  const objc = koffi.load('/usr/lib/libobjc.A.dylib')
  const getClass = objc.func('void *objc_getClass(const char *name)')
  const registerSel = objc.func('void *sel_registerName(const char *name)')
  const msgShared = objc.func('void *objc_msgSend(void *self, void *cmd)')
  const msgPolicy = objc.func('bool objc_msgSend(void *self, void *cmd, int policy)')
  const nsApplication = getClass('NSApplication')
  if (nsApplication === null) throw new Error('objc_getClass("NSApplication") returned null')
  const shared = msgShared(nsApplication, registerSel('sharedApplication'))
  if (shared === null) throw new Error('sharedApplication returned null')
  msgPolicy(shared, registerSel('setActivationPolicy:'), POLICY_ACCESSORY)
}

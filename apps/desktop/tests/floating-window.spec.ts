/** Ball and panel lifecycle of the always-on-top floating assistant. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FLOATING_IPC } from '../src/ipc.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  let nextId = 1
  const windows: FakeWindow[] = []
  class FakeWebContents extends EventEmitter {
    readonly id = nextId++
    readonly setWindowOpenHandler = vi.fn()
  }
  class FakeWindow extends EventEmitter {
    readonly webContents = new FakeWebContents()
    readonly options: Record<string, unknown>
    destroyed = false
    visible = false
    bounds = { x: 0, y: 0, width: 56, height: 56 }
    url: string | undefined
    show = vi.fn(() => { this.visible = true })
    hide = vi.fn(() => { this.visible = false })
    focus = vi.fn()
    isVisible = vi.fn(() => this.visible)
    isDestroyed = vi.fn(() => this.destroyed)
    getBounds = vi.fn(() => this.bounds)
    setBounds = vi.fn((next: { x?: number; y?: number; width?: number; height?: number }) => {
      this.bounds = { ...this.bounds, ...next }
    })
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    loadURL = vi.fn((url: string) => { this.url = url; return Promise.resolve() })
    destroy = vi.fn(() => {
      if (this.destroyed) return
      this.destroyed = true
      this.visible = false
      this.emit('closed')
    })
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      const geometry = options as { x?: number; y?: number; width?: number; height?: number }
      this.bounds = {
        x: geometry.x ?? 0,
        y: geometry.y ?? 0,
        width: geometry.width ?? 56,
        height: geometry.height ?? 56,
      }
      windows.push(this)
    }
  }
  const workArea = { x: 0, y: 0, width: 1440, height: 900 }
  return {
    windows,
    FakeWindow,
    ipcMain: new EventEmitter(),
    screen: {
      getPrimaryDisplay: () => ({ workArea }),
      getDisplayMatching: () => ({ workArea }),
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: native.FakeWindow,
  ipcMain: native.ipcMain,
  screen: native.screen,
}))
const { DesktopFloatingAssistant } = await import('../src/floating-window.ts')

afterEach(() => { native.windows.length = 0 })

function setup(state?: { enabled: boolean; x: number; y: number }) {
  const statePath = join(mkdtempSync(join(tmpdir(), 'dsh-floating-')), 'floating-assistant.json')
  if (state !== undefined) writeFileSync(statePath, JSON.stringify(state))
  const assistant = new DesktopFloatingAssistant({
    statePath,
    ballPreload: '/ball.cjs',
    panelPreload: '/app.cjs',
    ballUrl: 'dsh-app://shell/floating-ball.html',
    panelUrl: 'dsh-app://app/?dshCompact=1',
  })
  return { assistant, statePath }
}

/** The ball reveals itself after its document load settles. */
const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }

it('stays disabled without state and shows an always-on-top ball once enabled', async () => {
  const { assistant, statePath } = setup()
  expect(assistant.enabled).toBe(false)
  expect(assistant.panelWindow()).toBeUndefined()
  expect(native.windows).toHaveLength(0)
  assistant.setEnabled(true)
  expect(assistant.enabled).toBe(true)
  const ball = native.windows[0]!
  expect(ball.options).toMatchObject({ width: 56, height: 56, frame: false, transparent: true, skipTaskbar: true, show: false })
  expect(ball.options).toMatchObject({ x: 1440 - 56 - 24, y: 900 - 56 - 24 })
  expect(ball.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
  await flush()
  expect(ball.url).toBe('dsh-app://shell/floating-ball.html')
  expect(ball.show).toHaveBeenCalledOnce()
  const persisted = JSON.parse(readFileSync(statePath, 'utf8')) as { enabled: unknown }
  expect(persisted.enabled).toBe(true)
  assistant.dispose()
})

it('opens the compact panel beside the ball and closes it on Escape', async () => {
  const { assistant } = setup({ enabled: true, x: 100, y: 100 })
  await flush()
  const ball = native.windows[0]!
  expect(ball.show).toHaveBeenCalledOnce()
  native.ipcMain.emit(FLOATING_IPC.ballToggle, { sender: ball.webContents })
  const panel = native.windows[1]!
  expect(assistant.panelWindow()).toBe(panel)
  expect(panel.url).toBe('dsh-app://app/?dshCompact=1')
  expect(panel.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
  expect(panel.show).toHaveBeenCalledOnce()
  expect(panel.focus).toHaveBeenCalledOnce()
  // The ball sits left of the work area centre, so the panel opens to its right.
  expect(panel.setBounds).toHaveBeenCalledWith({ x: 168, y: 0, width: 400, height: 600 })
  panel.webContents.emit('before-input-event', { preventDefault: vi.fn() }, { type: 'keyDown', key: 'Escape' })
  expect(panel.hide).toHaveBeenCalledOnce()
  native.ipcMain.emit(FLOATING_IPC.ballToggle, { sender: ball.webContents })
  expect(panel.show).toHaveBeenCalledTimes(2)
  // A foreign sender neither toggles nor moves anything.
  native.ipcMain.emit(FLOATING_IPC.ballToggle, { sender: panel.webContents })
  expect(panel.hide).toHaveBeenCalledOnce()
  assistant.dispose()
})

it('moves the ball by reported deltas and persists the clamped position', async () => {
  const { assistant, statePath } = setup({ enabled: true, x: 100, y: 100 })
  await flush()
  const ball = native.windows[0]!
  native.ipcMain.emit(FLOATING_IPC.ballMove, { sender: ball.webContents }, 20, -30)
  expect(ball.bounds).toEqual({ x: 120, y: 70, width: 56, height: 56 })
  native.ipcMain.emit(FLOATING_IPC.ballMove, { sender: ball.webContents }, -10_000, 10_000)
  expect(ball.bounds).toEqual({ x: 0, y: 900 - 56, width: 56, height: 56 })
  expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({ enabled: true, x: 0, y: 900 - 56 })
  native.ipcMain.emit(FLOATING_IPC.ballMove, { sender: ball.webContents }, 'left', 1)
  expect(ball.bounds).toEqual({ x: 0, y: 900 - 56, width: 56, height: 56 })
  assistant.dispose()
})

it('tears the resident windows down when disabled and releases ipc on dispose', async () => {
  const { assistant } = setup({ enabled: true, x: 10, y: 10 })
  await flush()
  const ball = native.windows[0]!
  native.ipcMain.emit(FLOATING_IPC.ballToggle, { sender: ball.webContents })
  const panel = native.windows[1]!
  assistant.setEnabled(false)
  expect(assistant.enabled).toBe(false)
  expect(assistant.panelWindow()).toBeUndefined()
  expect(panel.hide).toHaveBeenCalledOnce()
  expect(ball.destroy).toHaveBeenCalledOnce()
  assistant.setEnabled(false)
  expect(ball.destroy).toHaveBeenCalledOnce()
  assistant.dispose()
  expect(panel.destroy).toHaveBeenCalledOnce()
  native.ipcMain.emit(FLOATING_IPC.ballToggle, { sender: ball.webContents })
  expect(native.windows).toHaveLength(2)
})

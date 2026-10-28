/**
 * Always-on-top floating assistant: a draggable ball document plus a compact
 * product panel. Both windows stay above other applications and outside the
 * main window's lifecycle; the ball position and the enabled flag persist in
 * one shell-owned JSON file, and the panel reuses the authenticated product
 * document through the compact frame query.
 */

import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { FLOATING_IPC } from './ipc.ts'

/** Ball edge length in DIP; the ball document draws inside it. */
const BALL_SIZE = 56
const PANEL_WIDTH = 400
const PANEL_HEIGHT = 600
/** Distance kept between the default ball position and the work area edges. */
const EDGE_MARGIN = 24
/** Gap between the ball and the panel it opens. */
const PANEL_GAP = 12

export interface DesktopFloatingState {
  readonly enabled: boolean
  readonly x: number
  readonly y: number
}

export interface DesktopFloatingOptions {
  /** JSON file under the shell userData directory holding the enabled flag and ball position. */
  readonly statePath: string
  readonly ballPreload: string
  readonly panelPreload: string
  readonly ballUrl: string
  readonly panelUrl: string
}

function defaultState(): DesktopFloatingState {
  return { enabled: false, x: Number.NaN, y: Number.NaN }
}

function readState(path: string): DesktopFloatingState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return defaultState()
    const record = parsed as Record<string, unknown>
    const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
    return { enabled: record.enabled === true, x: finite(record.x), y: finite(record.y) }
  } catch {
    // A missing or unreadable state file starts with the assistant disabled.
    return defaultState()
  }
}

function writeState(path: string, state: DesktopFloatingState): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  } catch (error) {
    console.warn('desktop floating assistant: state not persisted', error)
  }
}

/** Clamp a ball position into the work area of the display that owns it. */
function clampBall(x: number, y: number): { x: number; y: number } {
  const area = screen.getDisplayMatching({ x, y, width: BALL_SIZE, height: BALL_SIZE }).workArea
  return {
    x: Math.min(Math.max(x, area.x), area.x + Math.max(area.width - BALL_SIZE, 0)),
    y: Math.min(Math.max(y, area.y), area.y + Math.max(area.height - BALL_SIZE, 0)),
  }
}

/** Clamp a rectangle of the given size into one work area. */
function clampRect(x: number, y: number, width: number, height: number, area: Electron.Rectangle): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, area.x), area.x + Math.max(area.width - width, 0)),
    y: Math.min(Math.max(y, area.y), area.y + Math.max(area.height - height, 0)),
  }
}

export class DesktopFloatingAssistant {
  private state: DesktopFloatingState
  private ball: BrowserWindow | undefined
  private panel: BrowserWindow | undefined

  constructor(private readonly options: DesktopFloatingOptions) {
    this.state = readState(options.statePath)
    ipcMain.on(FLOATING_IPC.ballToggle, this.onBallToggle)
    ipcMain.on(FLOATING_IPC.ballMove, this.onBallMove)
    if (this.state.enabled) this.showBall()
  }

  /** Whether the ball is resident; the application menu checkbox mirrors it. */
  get enabled(): boolean {
    return this.state.enabled
  }

  /** The compact product panel, while created; the sender guards admit it beside the main window. */
  panelWindow(): BrowserWindow | undefined {
    return this.panel !== undefined && !this.panel.isDestroyed() ? this.panel : undefined
  }

  setEnabled(enabled: boolean): void {
    if (this.state.enabled === enabled) return
    this.state = { ...this.state, enabled }
    writeState(this.options.statePath, this.state)
    if (enabled) {
      this.showBall()
      return
    }
    this.hidePanel()
    for (const window of [this.ball, this.panel]) {
      if (window !== undefined && !window.isDestroyed()) window.destroy()
    }
    this.ball = undefined
    this.panel = undefined
  }

  togglePanel(): void {
    if (this.panelWindow()?.isVisible() === true) this.hidePanel()
    else this.showPanel()
  }

  /** Hide the panel without destroying it; the ball stays for policy-blocked runs. */
  hidePanel(): void {
    const window = this.panelWindow()
    if (window !== undefined) window.hide()
  }

  dispose(): void {
    ipcMain.removeListener(FLOATING_IPC.ballToggle, this.onBallToggle)
    ipcMain.removeListener(FLOATING_IPC.ballMove, this.onBallMove)
    for (const window of [this.ball, this.panel]) {
      if (window !== undefined && !window.isDestroyed()) window.destroy()
    }
    this.ball = undefined
    this.panel = undefined
  }

  private readonly onBallToggle = (event: IpcMainEvent): void => {
    if (this.ball === undefined || event.sender !== this.ball.webContents) return
    this.togglePanel()
  }

  private readonly onBallMove = (event: IpcMainEvent, dx: unknown, dy: unknown): void => {
    const ball = this.ball
    if (ball === undefined || ball.isDestroyed() || event.sender !== ball.webContents) return
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) return
    const bounds = ball.getBounds()
    const next = clampBall(bounds.x + Math.trunc(dx), bounds.y + Math.trunc(dy))
    ball.setBounds({ ...next, width: BALL_SIZE, height: BALL_SIZE })
    this.state = { ...this.state, ...next }
    writeState(this.options.statePath, this.state)
  }

  private showBall(): void {
    if (this.ball !== undefined && !this.ball.isDestroyed()) return
    const position = Number.isFinite(this.state.x) && Number.isFinite(this.state.y)
      ? clampBall(this.state.x, this.state.y)
      : (() => {
        const area = screen.getPrimaryDisplay().workArea
        return { x: area.x + area.width - BALL_SIZE - EDGE_MARGIN, y: area.y + area.height - BALL_SIZE - EDGE_MARGIN }
      })()
    const window = new BrowserWindow({
      width: BALL_SIZE,
      height: BALL_SIZE,
      x: position.x,
      y: position.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: this.options.ballPreload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
      },
    })
    window.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    window.on('closed', () => { if (this.ball === window) this.ball = undefined })
    this.ball = window
    void window.loadURL(this.options.ballUrl).then(() => {
      if (!window.isDestroyed() && this.state.enabled) window.show()
    })
  }

  private showPanel(): void {
    let window = this.panelWindow()
    if (window === undefined) {
      window = new BrowserWindow({
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        frame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          preload: this.options.panelPreload,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          devTools: true,
        },
      })
      window.setAlwaysOnTop(true, 'floating')
      if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      // Escape returns the user to the application underneath; the ball and the menu reopen the panel.
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key !== 'Escape') return
        event.preventDefault()
        this.hidePanel()
      })
      window.on('closed', () => { if (this.panel === window) this.panel = undefined })
      this.panel = window
      void window.loadURL(this.options.panelUrl)
    }
    this.placePanel(window)
    window.show()
    window.focus()
  }

  /** Anchor the panel beside the ball, inside the ball's display work area. */
  private placePanel(window: BrowserWindow): void {
    const ball = this.ball !== undefined && !this.ball.isDestroyed() ? this.ball.getBounds() : undefined
    const anchor = ball ?? screen.getPrimaryDisplay().workArea
    const area = screen.getDisplayMatching(anchor).workArea
    const left = anchor.x - PANEL_WIDTH - PANEL_GAP
    const x = left >= area.x ? left : anchor.x + (ball?.width ?? BALL_SIZE) + PANEL_GAP
    const y = anchor.y + (ball?.height ?? BALL_SIZE) / 2 - PANEL_HEIGHT / 2
    window.setBounds({ ...clampRect(x, y, PANEL_WIDTH, PANEL_HEIGHT, area), width: PANEL_WIDTH, height: PANEL_HEIGHT })
  }
}

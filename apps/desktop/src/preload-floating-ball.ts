/** Click and drag bridge for the floating assistant ball document. */
import { contextBridge, ipcRenderer } from 'electron'
import { FLOATING_IPC, SCHEME } from './ipc.ts'

if (location.protocol === `${SCHEME}:` && location.hostname === 'shell') {
  contextBridge.exposeInMainWorld('dshFloatingBall', {
    toggle: (): void => { ipcRenderer.send(FLOATING_IPC.ballToggle) },
    move: (dx: number, dy: number): void => { ipcRenderer.send(FLOATING_IPC.ballMove, dx, dy) },
  })
}

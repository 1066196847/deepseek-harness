/**
 * Model-facing `desktop_task` tool: one UI-TARS GUI agent run per call in a
 * dedicated Electron child process. The child stays in Node mode so screen
 * capture keeps the launch chain's TCC responsibility, and drops itself to the
 * accessory activation policy before libnut loads; the Host never loads libnut.
 * @module @deepseek-ai/dsh-ui-tars-desktop
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const name = 'ui-tars-desktop'
export const inject = ['tools']

/** Desktop-task configuration. */
export interface Config {
  /** Maximum screenshot-decision-action rounds per task (default 24). */
  maxLoopCount?: number
  /** Product UI-TARS endpoint; UI_TARS_BASE_URL overrides it. */
  baseURL?: string
  /** Product UI-TARS API key; UI_TARS_API_KEY overrides it. */
  apiKey?: string
  /** Product UI-TARS model name; UI_TARS_MODEL overrides it. */
  model?: string
}

/** Schemastery configuration for the desktop-task tool. */
export const Config: z<Config> = z.object({
  maxLoopCount: z.number().step(1).min(1).default(24),
  baseURL: z.string(),
  apiKey: z.string(),
  model: z.string(),
})

/** GUI-mode Electron entry; libnut loads there, never inside the Host. */
const RUNNER = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-ui-tars-desktop/runner'))

/** runner 通过 stdout 汇报的 NDJSON 行。 */
interface RunnerMessage {
  type: 'status' | 'done' | 'failed'
  status?: string
  elapsedMs?: number
  agentReport?: string
  message?: string
}

interface ModelConfig {
  baseURL: string
  apiKey: string
  model: string
}

/**
 * Run one desktop task in a dedicated Electron child process.
 *
 * The child stays in Node mode (ELECTRON_RUN_AS_NODE inherited) so screen
 * capture keeps the launch chain's TCC responsibility, and drops itself to the
 * accessory activation policy before libnut loads, so macOS never shows it in
 * the Dock and the Host never loads libnut itself.
 * @param goal - complete user-visible objective for the GUI agent.
 * @param config - model endpoint credentials resolved from environment overrides and plugin config.
 * @param maxLoopCount - maximum GUI agent rounds before the runner stops.
 * @param signal - DSH cancellation signal; aborting terminates the child.
 * @returns the JSON result string handed back to the model.
 */
function runInChildProcess(
  goal: string, config: ModelConfig, maxLoopCount: number, signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Node mode rejects Chromium switches such as --user-data-dir, and a
    // headless process never creates a Chromium profile anyway.
    const child = spawn(process.execPath, [RUNNER], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const onAbort = (): void => { child.kill('SIGTERM') }
    signal.addEventListener('abort', onAbort)

    const handleLine = (line: string): void => {
      if (line === '' || settled) return
      let message: RunnerMessage
      try {
        message = JSON.parse(line) as RunnerMessage
      } catch {
        return
      }
      if (message.type === 'status') {
        console.info(`[desktop_task] ${message.status} +${message.elapsedMs}ms`)
        return
      }
      settled = true
      if (message.type === 'done') {
        resolve(JSON.stringify({
          status: message.status,
          needsUserInput: message.status === 'call_user',
          elapsedMs: message.elapsedMs,
          agentReport: message.agentReport ?? '没有收到文字结果',
        }))
        return
      }
      reject(new Error(message.message ?? '桌面任务失败'))
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      let cut = stdout.indexOf('\n')
      while (cut !== -1) {
        handleLine(stdout.slice(0, cut))
        stdout = stdout.slice(cut + 1)
        cut = stdout.indexOf('\n')
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (settled) return
      settled = true
      if (signal.aborted) { reject(new Error('桌面任务已取消')); return }
      const tail = stderr.trim().split('\n').pop()
      if (code === null) {
        reject(new Error(tail || 'runner 被信号终止；SIGBUS 通常是屏幕录制权限问题，见 ~/Library/Logs/DiagnosticReports'))
        return
      }
      reject(new Error(code === 0 ? 'runner 未汇报结果' : tail || `runner 退出码 ${code}`))
    })
    child.stdin?.end(JSON.stringify({ goal, ...config, maxLoopCount }))
  })
}

/**
 * Register the `desktop_task` tool. Model credentials come from the bundle
 * config that packaging injects for product builds; the UI_TARS_BASE_URL,
 * UI_TARS_API_KEY, and UI_TARS_MODEL environment variables override it for
 * development.
 * @param ctx - Cordis context owning the tool registration.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config) {
  const maxLoopCount = config.maxLoopCount ?? 24
  // 鼠标键盘是独占的物理资源：同一进程内一次只允许一个桌面任务，避免两个 Agent 抢同一副键鼠。
  let busy = false

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'desktop_task',

    description:
      '用户要求实际操作本机桌面软件时使用，例如点击 WPS 菜单、' +
      '输入文字、拖动物体。把完整目标一次传入 goal。' +
      '用户只询问操作方法时不要调用。',

    parameters: {
      goal: {
        type: 'string',
        required: true,
        description: '用户要在桌面上完成的完整目标，以及完成条件',
      },
    },

    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },

    async execute({ goal }, exec) {
      const task = goal.trim()
      if (!task) throw new Error('goal 不能为空')

      // 第一次只验证 DSH → 插件，不加载桌面驱动，也不动鼠标。
      if (task === '__ping__') {
        console.info('[desktop_task] ping')
        return 'DESKTOP_TASK_PONG'
      }

      if (busy) throw new Error('已有桌面任务正在执行')
      const baseURL = process.env.UI_TARS_BASE_URL ?? config.baseURL
      const apiKey = process.env.UI_TARS_API_KEY ?? config.apiKey
      const model = process.env.UI_TARS_MODEL ?? config.model
      if (!baseURL || !apiKey || !model) {
        throw new Error('缺少 UI-TARS 凭据；产品包应在打包时注入（apps/desktop/.env.macos），开发环境可设置 UI_TARS_BASE_URL、UI_TARS_API_KEY、UI_TARS_MODEL')
      }

      busy = true
      try {
        return await runInChildProcess(task, { baseURL, apiKey, model }, maxLoopCount, exec.signal)
      } finally {
        busy = false
      }
    },
  })), 'desktop_task registration')

  console.info('[ui-tars-desktop] registered: desktop_task')
}

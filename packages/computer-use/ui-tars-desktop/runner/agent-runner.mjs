// Headless (ELECTRON_RUN_AS_NODE) child that runs the UI-TARS agent outside the Host.
//
// libnut initializes AppKit in whatever process loads it, and AppKit defaults a
// bundle-launched process to the regular activation policy, which puts a second
// icon in the Dock. Screen capture only works while the process keeps the TCC
// responsibility of the launch chain, so this child stays headless like the
// Host and instead drops itself to the accessory policy (no Dock icon, no menu
// bar) through one ObjC call before libnut touches AppKit.
import { setAccessoryActivationPolicy } from './macos-accessory.mjs'
import { accessibilityTrusted, requestScreenCapture, screenCaptureStatus } from './macos-permissions.mjs'

const emit = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

const fail = (message) => {
  emit({ type: 'failed', message })
  process.exit(1)
}

try {
  setAccessoryActivationPolicy()
} catch (error) {
  // Degrade to a visible Dock icon rather than failing the task.
  process.stderr.write(`[agent-runner] accessory policy unavailable: ${String(error)}\n`)
}

// libnut dereferences a bad bitmap pointer when the capture grant is missing,
// so refuse before it loads instead of dying with SIGBUS mid-task.
if (screenCaptureStatus() !== 'authorized') {
  requestScreenCapture()
  fail('缺少屏幕录制授权：系统可能已弹出提示，请到「系统设置 → 隐私与安全性 → 屏幕录制」勾选本应用后重试')
}
if (!accessibilityTrusted()) {
  fail('缺少辅助功能授权：请到「系统设置 → 隐私与安全性 → 辅助功能」勾选本应用后重试')
}

const abort = new AbortController()
process.on('SIGTERM', () => abort.abort())

let request = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { request += chunk })
process.stdin.on('end', () => { void run() })

async function run() {
  let cfg
  try {
    cfg = JSON.parse(request)
  } catch {
    fail('runner: 请求不是合法 JSON')
    return
  }
  const start = Date.now()
  let status = 'init'
  let lastReply = ''
  let error = ''
  try {
    const { GUIAgent, StatusEnum } = await import('@ui-tars/sdk')
    const { NutJSOperator } = await import('@ui-tars/operator-nut-js')
    const agent = new GUIAgent({
      model: { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model },
      operator: new NutJSOperator(),
      signal: abort.signal,
      maxLoopCount: cfg.maxLoopCount,
      onData: ({ data }) => {
        status = data.status
        for (const msg of data.conversations ?? []) {
          if (msg.from === 'gpt' && typeof msg.value === 'string') lastReply = msg.value
        }
        emit({ type: 'status', status, elapsedMs: Date.now() - start })
      },
      onError: ({ error: err }) => {
        error = String(err instanceof Error ? err.message : JSON.stringify(err))
      },
    })
    await agent.run(cfg.goal)
    if (abort.signal.aborted) { fail('桌面任务已取消'); return }
    if (error !== '') { fail(error); return }
    // run() 正常返回不代表成功：end 是唯一成功终态，call_user 表示还需要用户补充信息。
    if (status !== StatusEnum.END && status !== StatusEnum.CALL_USER) {
      fail(`桌面任务未正常结束，最后状态：${status}`)
      return
    }
    emit({
      type: 'done',
      status,
      elapsedMs: Date.now() - start,
      agentReport: lastReply || '没有收到文字结果',
    })
    process.exit(0)
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

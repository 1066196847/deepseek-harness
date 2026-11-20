import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { expect, it } from 'vitest'
import { bundleSchema, resolveUiTarsProductConfig, withUiTarsBundleConfig } from '../scripts/ui-tars-product-config.ts'

const credentials = { baseURL: 'https://ui-tars.example/v1', apiKey: "key'with#hash and space", model: 'ui-tars-pro' }
const patch = [
  '- insert:',
  '    - id: ui-tars-desktop',
  "      name: '@deepseek-ai/dsh-ui-tars-desktop'",
  "      disabled: !!js process.platform !== 'darwin'",
  '',
].join('\n')

function entryOf(text: string): Record<string, unknown> {
  const rows = yaml.load(text, { schema: bundleSchema }) as { insert?: Record<string, unknown>[] }[]
  return rows.flatMap(row => row.insert ?? []).find(entry => entry.id === 'ui-tars-desktop')!
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ui-tars-product-'))
  try { run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

it('embeds credentials while preserving the !!js disabled expression', () => {
  const rewritten = withUiTarsBundleConfig(patch, credentials)
  const entry = entryOf(rewritten)
  expect(entry.config).toEqual(credentials)
  expect(String(entry.disabled)).toBe("process.platform !== 'darwin'")
  expect(entry.name).toBe('@deepseek-ai/dsh-ui-tars-desktop')
  expect(rewritten).toContain('!!js')
})

it('rejects a patch without exactly one ui-tars-desktop insert entry', () => {
  expect(() => withUiTarsBundleConfig('- insert: []\n', credentials)).toThrow(/exactly one/)
})

it('resolves credentials from the environment before the dotenv file', () => {
  withRoot((root) => {
    writeFileSync(join(root, '.env.macos'), 'UI_TARS_BASE_URL=file\nUI_TARS_API_KEY=file\nUI_TARS_MODEL=file\n')
    const environment = { UI_TARS_BASE_URL: 'env', UI_TARS_API_KEY: 'env', UI_TARS_MODEL: 'env' }
    expect(resolveUiTarsProductConfig(environment, root)).toEqual({ baseURL: 'env', apiKey: 'env', model: 'env' })
  })
})

it('falls back to the platform dotenv and ignores unrelated release settings', () => {
  withRoot((root) => {
    writeFileSync(join(root, '.env.macos'), [
      'DSH_DESKTOP_APP_ID=com.deepseek.dsh',
      'UI_TARS_BASE_URL=https://file.example/v1',
      'UI_TARS_API_KEY=file-key',
      'UI_TARS_MODEL=file-model',
      '',
    ].join('\n'))
    expect(resolveUiTarsProductConfig({ UI_TARS_BASE_URL: '' }, root))
      .toEqual({ baseURL: 'https://file.example/v1', apiKey: 'file-key', model: 'file-model' })
  })
})

it('treats empty values and a missing file as absent', () => {
  withRoot((root) => {
    expect(resolveUiTarsProductConfig({}, root)).toBeUndefined()
    writeFileSync(join(root, '.env.macos'), 'UI_TARS_BASE_URL=\nUI_TARS_API_KEY=\nUI_TARS_MODEL=\n')
    expect(resolveUiTarsProductConfig({}, root)).toBeUndefined()
  })
})

it('fails loud on a partial credential set', () => {
  withRoot((root) => {
    expect(() => resolveUiTarsProductConfig({ UI_TARS_BASE_URL: 'env' }, root)).toThrow(/together/)
    writeFileSync(join(root, '.env.macos'), 'UI_TARS_BASE_URL=file\nUI_TARS_MODEL=file\n')
    expect(() => resolveUiTarsProductConfig({}, root)).toThrow(/together/)
  })
})

it('rejects NUL-corrupted credentials without echoing values', () => {
  withRoot((root) => {
    writeFileSync(join(root, '.env.macos'), 'UI_TARS_BASE_URL=https://file.example/v1\nUI_TARS_API_KEY="x\0y"\nUI_TARS_MODEL=file-model\n')
    expect(() => resolveUiTarsProductConfig({}, root)).toThrow(/NUL/)
    try { resolveUiTarsProductConfig({}, root) } catch (error) {
      expect(String(error)).not.toContain('x\0y')
    }
  })
})

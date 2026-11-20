/** Embed product UI-TARS credentials into the packaged desktop_task bundle composition. */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import yaml from 'js-yaml'

/** The three product values injected into the bundle config at packaging time. */
export interface UiTarsProductConfig {
  /** UI-TARS OpenAI-compatible endpoint. */
  baseURL: string
  /** UI-TARS API key. */
  apiKey: string
  /** UI-TARS model name. */
  model: string
}

const CREDENTIAL_NAMES = ['UI_TARS_BASE_URL', 'UI_TARS_API_KEY', 'UI_TARS_MODEL'] as const

/**
 * Resolve product credentials from the packaging environment, falling back to the
 * gitignored platform dotenv that unsigned builds do not otherwise load. Empty
 * values count as absent; partial sets and NUL-corrupted values fail loud without
 * echoing credential values.
 * @param environment - packaging process environment, possibly carrying release settings.
 * @param appRoot - apps/desktop directory holding `.env.macos`.
 * @returns the three product values, or undefined when no credential is configured.
 */
export function resolveUiTarsProductConfig(
  environment: Readonly<Record<string, string | undefined>>, appRoot: string,
): UiTarsProductConfig | undefined {
  const fromEnvironment = CREDENTIAL_NAMES.map(name => environment[name])
  const present = fromEnvironment.filter(value => value !== undefined && value !== '')
  if (present.length > 0) {
    if (present.length !== CREDENTIAL_NAMES.length) {
      throw new Error(`desktop runtime: ${CREDENTIAL_NAMES.join(', ')} must be configured together`)
    }
    return { baseURL: present[0]!, apiKey: present[1]!, model: present[2]! }
  }
  const path = join(appRoot, '.env.macos')
  if (!existsSync(path)) return undefined
  let settings: Record<string, string | undefined>
  try {
    settings = parseEnv(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''))
  } catch {
    // parseEnv diagnostics embed dotenv values, which may include credentials.
    throw new Error(`desktop runtime: invalid dotenv syntax in ${path}`)
  }
  for (const name of CREDENTIAL_NAMES) {
    if (settings[name]?.includes('\0')) {
      throw new Error(`desktop runtime: ${name} cannot contain a NUL character in ${path}`)
    }
  }
  const fromFile = CREDENTIAL_NAMES.map(name => settings[name]).filter(value => value !== undefined && value !== '')
  if (fromFile.length === 0) return undefined
  if (fromFile.length !== CREDENTIAL_NAMES.length) {
    throw new Error(`desktop runtime: ${CREDENTIAL_NAMES.join(', ')} must be configured together in ${path}`)
  }
  return { baseURL: fromFile[0]!, apiKey: fromFile[1]!, model: fromFile[2]! }
}

/**
 * `!!js` scalars survive a js-yaml round trip as String objects: implicit types
 * reject boxed strings, so the explicit tag type represents them verbatim.
 */
const jsExpression = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  instanceOf: String,
  construct: (source: string) => new String(source),
  represent: (data: object) => String.prototype.valueOf.call(data),
})
/** js-yaml schema that reads and writes Cordis `!!js` expressions verbatim. */
export const bundleSchema = yaml.DEFAULT_SCHEMA.extend({ explicit: [jsExpression] })

/**
 * Add the product credential config to the ui-tars-desktop insert entry of a bundle
 * patch, preserving every other row and `!!js` expression verbatim.
 * @param patch - bundle cordis.patch.yml text.
 * @param config - resolved product credentials.
 * @returns the rewritten patch text, verified by re-parsing before return.
 */
export function withUiTarsBundleConfig(patch: string, config: UiTarsProductConfig): string {
  const rows = yaml.load(patch, { schema: bundleSchema }) as { insert?: { id?: string; disabled?: unknown; config?: unknown }[] }[]
  const entries = rows.flatMap(row => row.insert ?? []).filter(entry => entry.id === 'ui-tars-desktop')
  if (entries.length !== 1) throw new Error('desktop runtime: bundle patch must insert exactly one ui-tars-desktop entry')
  const entry = entries[0]!
  const disabled = entry.disabled instanceof String ? entry.disabled.valueOf() : undefined
  entry.config = { baseURL: config.baseURL, apiKey: config.apiKey, model: config.model }
  const rewritten = yaml.dump(rows, { schema: bundleSchema, lineWidth: -1 })
  const verified = yaml.load(rewritten, { schema: bundleSchema }) as typeof rows
  const verifiedEntry = verified.flatMap(row => row.insert ?? []).find(item => item.id === 'ui-tars-desktop')
  const verifiedDisabled = verifiedEntry?.disabled instanceof String ? verifiedEntry.disabled.valueOf() : undefined
  if (verifiedDisabled !== disabled || JSON.stringify(verifiedEntry?.config) !== JSON.stringify(entry.config)) {
    throw new Error('desktop runtime: bundle patch rewrite did not round-trip')
  }
  return rewritten
}

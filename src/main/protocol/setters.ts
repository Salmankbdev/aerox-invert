import { SETTING_SPEC_BY_KEY } from '@shared/settings-spec'
import type { SettingKey } from '@shared/types'

export type BuiltSetting =
  | { ok: true; command: string }
  | { ok: false; error: string }

/**
 * Turn a setting key and a numeric value into the exact PI30 setter string.
 *
 * Validation lives here rather than in the renderer so a malformed value can
 * never reach the device, whatever the UI does. Ranges and the allowed-value
 * list both come from the shared spec, so the command the UI previews is the
 * command this function builds.
 */
export function buildSettingCommand(key: SettingKey, value: number): BuiltSetting {
  const spec = SETTING_SPEC_BY_KEY[key]
  if (!spec) return { ok: false, error: `unknown setting: ${String(key)}` }
  if (!Number.isFinite(value)) return { ok: false, error: `${spec.label} needs a number` }

  const unit = spec.unit ? ` ${spec.unit}` : ''
  if (value < spec.min || value > spec.max) {
    return { ok: false, error: `${spec.label} must be ${spec.min}-${spec.max}${unit}` }
  }
  if (spec.options && !spec.options.some((option) => option.value === value)) {
    return { ok: false, error: `${value}${unit} is not a valid ${spec.label}` }
  }

  return { ok: true, command: `${spec.command}${spec.encode(value)}` }
}

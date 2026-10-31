/* BS118: feature flags for the Web Premium v1 programme.

   Every new feature ships dark and is turned on per release, globally or for a
   list of organizers / events. Flags live in the platform settings document
   (`settings.flags`), edited by an admin through PUT /api/settings/flags.

   Resolution: an event rule beats an organizer rule beats the global switch.
   A flag that is absent or malformed is OFF (fail-closed: unfinished features
   never leak to buyers). */

export const FLAG_NAMES = [
  'zp_look_v2',
  'zp_checkout_v2',
  'zp_seatmap',
  'zp_analytics',
  'zp_pass_design',
  'zp_installments',
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

export interface FlagRule {
  /** Global default for everyone. */
  on?: boolean;
  /** Organizer handles the flag is ON for (regardless of `on`). */
  orgs?: string[];
  /** Event ids the flag is ON for (regardless of `on`). */
  events?: string[];
  /** Event ids / organizer handles explicitly OFF (beats `on` and lists above). */
  offOrgs?: string[];
  offEvents?: string[];
}

export type FlagRules = Partial<Record<FlagName, FlagRule>>;

export interface FlagContext {
  org?: string | null;
  event?: string | null;
}

const isFlag = (k: string): k is FlagName => (FLAG_NAMES as readonly string[]).includes(k);
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200).slice(0, 500) : undefined;

/** Is one flag on for this context? */
export function isFlagOn(rules: unknown, flag: FlagName, ctx: FlagContext = {}): boolean {
  const r = rules && typeof rules === 'object' ? (rules as Record<string, unknown>)[flag] : undefined;
  if (!r || typeof r !== 'object') return false;
  const rule = r as FlagRule;
  const ev = ctx.event ?? null;
  const org = ctx.org ?? null;
  if (ev && strList(rule.offEvents)?.includes(ev)) return false;
  if (ev && strList(rule.events)?.includes(ev)) return true;
  if (org && strList(rule.offOrgs)?.includes(org)) return false;
  if (org && strList(rule.orgs)?.includes(org)) return true;
  return rule.on === true;
}

/** Every flag resolved for one context — what the public GET /api/flags returns. */
export function resolveFlags(rules: unknown, ctx: FlagContext = {}): Record<FlagName, boolean> {
  const out = {} as Record<FlagName, boolean>;
  for (const f of FLAG_NAMES) out[f] = isFlagOn(rules, f, ctx);
  return out;
}

/** Validate an admin-submitted rules object. Unknown flags and junk fields are dropped. */
export function sanitizeFlagRules(input: unknown): FlagRules {
  const out: FlagRules = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isFlag(k) || !v || typeof v !== 'object') continue;
    const src = v as Record<string, unknown>;
    const rule: FlagRule = {};
    if (typeof src.on === 'boolean') rule.on = src.on;
    for (const key of ['orgs', 'events', 'offOrgs', 'offEvents'] as const) {
      const list = strList(src[key]);
      if (list) rule[key] = list;
    }
    out[k] = rule;
  }
  return out;
}

/* Feature flags (env-backed overrides).

   SEATMAP_ENABLED — env override for the live buyer seat map (BS126). The normal
   switch is the settings-backed `zp_seatmap` flag; see lib/seatmap-gate.ts, which
   also requires the event to have published seats. Force on with
   NEXT_PUBLIC_ZP_SEATMAP=1. */
export const SEATMAP_ENABLED = process.env.NEXT_PUBLIC_ZP_SEATMAP === '1';

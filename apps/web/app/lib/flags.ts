/* Feature flags (env-backed for now; BS118 adds a settings-backed helper).

   SEATMAP_ENABLED — the buyer seat map still renders placeholder seat/table
   availability until real inventory lands (BS124–126), so it is OFF by default:
   event pages don't link to it and /events/:id/seats redirects to the event page.
   Turn on with NEXT_PUBLIC_ZP_SEATMAP=1. */
export const SEATMAP_ENABLED = process.env.NEXT_PUBLIC_ZP_SEATMAP === '1';

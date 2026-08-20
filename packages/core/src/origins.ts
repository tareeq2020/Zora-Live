/* Where user-facing links point. The buyer-facing WEB app origin — home of
   /t/:code (the ticket pass), /u/:token (unsubscribe), /events and the
   storefronts.

   This is deliberately NOT process.env.PUBLIC_ORIGIN. PUBLIC_ORIGIN is the API's
   OWN public host, set so the payment-gateway webhook can reach the API directly
   (e.g. https://zora-api.<tenant>) — see ecosystem.config.js. Sending a buyer a
   link built from PUBLIC_ORIGIN drops them on the API server (they saw
   `zora-api.<tenant>/tickets`), which is not a page. Override with
   PUBLIC_WEB_ORIGIN; default to the launch web domain. */
export function publicWebOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PUBLIC_WEB_ORIGIN || 'https://zorapass.com').trim().replace(/\/+$/, '');
}

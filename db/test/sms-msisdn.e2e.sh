#!/usr/bin/env bash
# BS112 (XBR-347) — every SMS must go to the gateway as a normalised MSISDN
# (+255…). A gate-cash buyer types "0712…"; AfricasTalking wants +255… and Beem
# wants 255…, so the raw local form never delivered. The fix normalises at the
# single sendSms boundary (reusing the payment gateway's normaliser). No DB — a
# pure wiring check that sendSms applies normalizeMsisdn before dispatch.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/packages/core/dist/index.js" ] || ( cd "$ROOT" && pnpm --filter @zora/core build >/dev/null )

node -e '
const core = require(process.argv[1] + "/packages/core/dist/index.js");
const logs = [];
const orig = console.log;
console.log = (...a) => logs.push(a.join(" "));
(async () => {
  const cases = [
    ["0712000999",   "+255712000999"], // local, leading 0
    ["0712 000 999", "+255712000999"], // spaced
    ["712000999",    "+255712000999"], // bare 9-digit (the +255-prefixed UI submits this)
    ["255712000999", "+255712000999"], // country code, no +
    ["+255712000999","+255712000999"], // already E.164
  ];
  for (const [inp] of cases) await core.sendSms(inp, "hi", { SMS_DRIVER: "mock" });
  console.log = orig;
  const dests = logs.map(l => (l.match(/to=(\S+)/) || [])[1]);
  let fail = 0;
  cases.forEach(([inp, exp], i) => {
    const ok = dests[i] === exp;
    if (!ok) fail = 1;
    console.log((ok ? "  ✓ " : "  ✗ ") + JSON.stringify(inp) + " -> " + dests[i] + (ok ? "" : " (expected " + exp + ")"));
  });
  process.exit(fail);
})();
' "$ROOT"

echo ""
echo "SMS MSISDN E2E: PASS (sendSms normalises every number to +255… before the gateway)"

/* Broadcast drain tests — run against the BUILT dist (pnpm --filter "@zora/core..." build first).
   node packages/core/test/broadcasts.test.mjs

   Regression guard for the silent-SMS bug: when the sender process has no SMS
   creds, sendSms dev-logs and returns { delivered:false } WITHOUT throwing. The
   drain used to mark that recipient 'sent' anyway, so a whole reminder blast
   looked delivered while nothing left the box. drainBroadcasts must now honour
   `delivered` and mark an undelivered (dev-log) recipient 'failed'. */
import assert from 'node:assert/strict';
import { drainBroadcasts } from '../dist/index.js';

let pass = 0;
async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${err?.stack ?? err}`);
    process.exitCode = 1;
  }
}

/* A tagged-template stand-in for the `postgres` sql client: it pattern-matches
   drainBroadcasts's queries and returns canned rows, capturing the terminal
   status written to each recipient. No database required. */
function makeMockSql(capturedStatuses) {
  return (strings) => {
    const q = strings.join(' ? ');
    let rows = [];
    if (/with claim/i.test(q)) {
      // claim step → one queued SMS recipient
      rows = [{ id: 'rec1', broadcast_id: 'b1', channel: 'sms', address: '+255700000009', unsubscribe_token: 'tok1' }];
    } else if (/from broadcast where id = any/i.test(q)) {
      // bodies for the claimed broadcast(s)
      rows = [{
        id: 'b1', sender_handle: 'weekendar', sender_kind: 'org', sender_id: null,
        subject: null, body_sms: 'Reminder: your event is tomorrow', body_email: null,
      }];
    } else if (/from message_suppression/i.test(q)) {
      rows = []; // not suppressed
    } else if (/update broadcast_recipient set status/i.test(q) && !/with claim/i.test(q)) {
      const m = q.match(/update broadcast_recipient set status = '(\w+)'/i);
      if (m) capturedStatuses.push(m[1]);
      rows = [];
    }
    return Promise.resolve(rows);
  };
}

console.log('broadcasts.test.mjs');

// REGRESSION: no SMS creds → dev-log → the recipient must NOT be reported 'sent'.
await test('drainBroadcasts marks a dev-log (uncredentialed) SMS recipient failed, not sent', async () => {
  const statuses = [];
  const sql = makeMockSql(statuses);
  const out = await drainBroadcasts(sql, { batchSize: 10, rateMs: 0, env: { SMS_DRIVER: 'mock' } });

  assert.equal(out.claimed, 1, 'claimed the one queued recipient');
  assert.equal(out.sent, 0, 'a dev-log send must NOT count as sent');
  assert.equal(out.failed, 1, 'a dev-log send is surfaced as failed');
  assert.deepEqual(statuses, ['failed'], "recipient row written 'failed', not 'sent'");
});

// Empty queue → no-op, no throw.
await test('drainBroadcasts on an empty queue returns zeros', async () => {
  const sql = () => Promise.resolve([]); // claim returns nothing
  const out = await drainBroadcasts(sql, { batchSize: 10, rateMs: 0, env: { SMS_DRIVER: 'mock' } });
  assert.deepEqual(out, { claimed: 0, sent: 0, failed: 0, skipped: 0 });
});

if (process.exitCode) {
  console.log(`\n${pass} passed, some FAILED`);
} else {
  console.log(`\nall ${pass} passed`);
}

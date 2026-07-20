/* PR-MT6 — the REAL "create a drop" route at /dashboard/events/new.

   Replaces the former wrap-and-run demo (create-event.html port: markup via
   dangerouslySetInnerHTML + an imperative script that only toasted "Draft
   saved" and never POSTed). It now renders the idiomatic-React DropEditor, which
   validates and POSTs to /api/org/events with a stable idempotencyKey and
   disable-on-submit. Route exposed: /dashboard/events/new (create). */

import DropEditor from '../components/drop-editor';

export default function CreateDropPage() {
  return <DropEditor mode="create" />;
}

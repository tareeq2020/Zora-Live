/* PR-MT6 — the REAL "edit a drop" route at /dashboard/events/[id]/edit.

   Prefills the shared DropEditor from GET /api/org/events (found by id) and
   submits via PUT /api/org/events/:id; a 404 (not owned) renders a graceful
   "not yours" state. The editor also hosts the Delete action (DELETE
   /api/org/events/:id). Route exposed: /dashboard/events/:id/edit (edit + delete). */

import DropEditor from '../../components/drop-editor';

export default function EditDropPage({ params }: { params: { id: string } }) {
  return <DropEditor mode="edit" eventId={params.id} />;
}

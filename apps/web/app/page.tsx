import { redirect } from 'next/navigation';

// '/' is served by the beforeFiles rewrite -> /index.html. This redirect is a
// safety net if the rewrite is ever bypassed; normally it never runs.
export default function Home() {
  redirect('/index.html');
}

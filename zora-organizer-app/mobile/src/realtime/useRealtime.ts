// realtime/useRealtime.ts — one WebSocket, auto-reconnect. Powers live seat
// availability, the dashboard counters, and the audit stream.
import { useEffect, useRef, useState, useCallback } from 'react';

type Status = 'connecting' | 'open' | 'closed';

export function useRealtime(url: string, onMessage?: (m: any) => void) {
  const ws = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const s = (ws.current = new WebSocket(url));
      s.onopen = () => alive && setStatus('open');
      s.onclose = () => { if (!alive) return; setStatus('closed'); retry = setTimeout(connect, 1500); };
      s.onmessage = (e) => { try { onMessage?.(JSON.parse(e.data)); } catch {} };
    };
    connect();
    return () => { alive = false; clearTimeout(retry); ws.current?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const publish = useCallback((event: string, payload: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ event, payload }));
  }, []);

  return { status, publish };
}

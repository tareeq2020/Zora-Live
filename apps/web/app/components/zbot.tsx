'use client';

/* ZBot — "Zora Assist", the scripted support widget from public/zbot.js, ported
   to React state (messages/quick-replies/typing) instead of manual DOM appends.
   The .zbot* CSS lives in each host page's inline <style> (help, commission,
   discover all ship their own copy), so this only renders the same markup +
   class names and drives the same FLOWS. Pages that want an external "chat with
   us" button hold a ref and call open(). */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

type Flow = { label: string; reply: string; next: string[]; act?: () => void };

const FLOWS: Record<string, Flow> = {
  download: {
    label: "Ticket won't download",
    reply:
      "Your pass lives in the Zora app, not as a PDF. Open the app → Wallet and it's there, even offline. If the app shows nothing yet, pull down to refresh, or make sure you're signed in with the number you bought with.",
    next: ['still_stuck', 'human'],
  },
  payment: {
    label: 'Payment / transaction timed out',
    reply:
      'If a payment timed out, you were not charged twice — pending mobile-money holds auto-reverse within a few minutes. Check your SMS for a confirmation; if you see one, your tickets are already in the app. No confirmation after 10 min? Try the purchase again.',
    next: ['no_tickets', 'human'],
  },
  signup: {
    label: 'Trouble signing up',
    reply:
      "Signing up takes two taps with Google, or use your email. If your number says 'already in use', you likely have an account — try 'Sign in' instead. Organizers: your dashboard opens the moment you claim your address.",
    next: ['reset', 'human'],
  },
  refund: {
    label: 'Refund or resale',
    reply:
      "Can't make an event? List your ticket on the in-app resale market (capped at face +10%) — when it sells, the new pass is issued and yours voids automatically. Event cancelled by the organizer? You're refunded to your original method, no action needed.",
    next: ['human', 'help'],
  },
  still_stuck: {
    label: 'Still not showing',
    reply:
      "Sorry about that. Sign out and back in once — that reissues your passes to the device. If it's still missing, our team can push it manually in a few minutes.",
    next: ['human', 'help'],
  },
  no_tickets: {
    label: 'Still no tickets',
    reply:
      "Let's not leave you hanging. Share the phone number you paid with in the Help Centre form and we'll trace the transaction and release your tickets.",
    next: ['human', 'help'],
  },
  reset: {
    label: 'Reset my access',
    reply:
      "On the sign-in screen tap 'Get a code' — we'll text a one-time code to your number. No passwords to forget.",
    next: ['human', 'help'],
  },
  human: {
    label: 'Talk to a human',
    reply:
      "On it. Our support team replies within a couple of hours (Mon–Sun). Drop your question in the Help Centre and we'll email you back — or reach us at hello@zora.app.",
    next: ['help'],
  },
  help: {
    label: 'Open Help Centre',
    reply: "Opening the Help Centre — you'll find step-by-step answers there.",
    act: () => setTimeout(() => (location.href = '/help'), 700),
    next: [],
  },
};

const DEFAULT_QUICK = ['download', 'payment', 'signup', 'refund'];

function matchTyped(raw: string): string | null {
  const s = raw.toLowerCase();
  if (/(download|wallet|pdf|ticket.*(show|find|missing)|where.*ticket)/.test(s)) return 'download';
  if (/(pay|paid|charge|timed? ?out|timeout|pending|mpesa|m-pesa|money|failed)/.test(s)) return 'payment';
  if (/(sign ?up|signup|register|account|log ?in|login|password|code)/.test(s)) return 'signup';
  if (/(refund|resell|resale|cancel|transfer|sell)/.test(s)) return 'refund';
  if (/(human|agent|person|call|email|contact|support)/.test(s)) return 'human';
  return null;
}

type Msg = { who: 'me' | 'bot'; text: string };

export type ZBotHandle = { open: () => void };

export const ZBot = forwardRef<ZBotHandle>(function ZBot(_props, ref) {
  const [open, setOpen] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [quick, setQuick] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, typing, quick]);

  // Emulate zbot.js typing(): show a "…" bubble for 550ms, then reveal.
  const withTyping = useCallback((reveal: () => void) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      reveal();
    }, 550);
  }, []);

  const runFlow = useCallback(
    (key: string) => {
      const f = FLOWS[key];
      if (!f) return;
      setMessages((m) => [...m, { who: 'me', text: f.label }]);
      setQuick([]);
      withTyping(() => {
        setMessages((m) => [...m, { who: 'bot', text: f.reply }]);
        if (f.act) f.act();
        setQuick(f.next && f.next.length ? f.next : DEFAULT_QUICK);
      });
    },
    [withTyping],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = text.trim();
      if (!v) return;
      setMessages((m) => [...m, { who: 'me', text: v }]);
      setText('');
      const key = matchTyped(v);
      setQuick([]);
      withTyping(() => {
        if (key) {
          const f = FLOWS[key];
          setMessages((m) => [...m, { who: 'bot', text: f.reply }]);
          setQuick(f.next);
        } else {
          setMessages((m) => [
            ...m,
            {
              who: 'bot',
              text: "I'm not fully sure on that one — but our Help Centre has it, or I can get a human on it.",
            },
          ]);
          setQuick(['help', 'human']);
        }
      });
    },
    [text, withTyping],
  );

  const doOpen = useCallback(() => {
    setOpen(true);
    if (!greeted) {
      setGreeted(true);
      withTyping(() => {
        setMessages((m) => [...m, { who: 'bot', text: "Hey — I'm Zora Assist. What can I help with?" }]);
        setQuick(DEFAULT_QUICK);
      });
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [greeted, withTyping]);

  const doClose = useCallback(() => setOpen(false), []);

  useImperativeHandle(ref, () => ({ open: doOpen }), [doOpen]);

  return (
    <div className="zbot" id="zbot">
      <button
        className={'zbot-fab' + (open ? ' hide' : '')}
        id="zbot-fab"
        aria-label="Open help chat"
        onClick={doOpen}
      >
        <svg viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Help
      </button>
      <div className={'zbot-panel' + (open ? ' on' : '')} id="zbot-panel" role="dialog" aria-label="Zora help chat">
        <div className="zbot-head">
          <span className="zbot-avatar">Z</span>
          <div>
            <p className="zbot-name">Zora Assist</p>
            <p className="zbot-status">
              <span className="d"></span>Online · replies instantly
            </p>
          </div>
          <button className="zbot-x" id="zbot-x" aria-label="Close" onClick={doClose}>
            &times;
          </button>
        </div>
        <div className="zbot-msgs" id="zbot-msgs" ref={msgsRef}>
          {messages.map((m, i) => (
            <div className={'zmsg ' + m.who} key={i}>
              {m.text}
            </div>
          ))}
          {typing ? <div className="zmsg bot">…</div> : null}
        </div>
        <div className="zbot-quick" id="zbot-quick">
          {quick.map((k) => (
            <button className="zq" key={k} onClick={() => runFlow(k)}>
              {FLOWS[k].label}
            </button>
          ))}
        </div>
        <form className="zbot-input" id="zbot-form" onSubmit={handleSubmit}>
          <input
            id="zbot-text"
            ref={inputRef}
            placeholder="Type your question…"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" aria-label="Send">
            <svg viewBox="0 0 24 24">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
});

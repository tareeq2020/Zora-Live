'use client';

/* The interactive body of /help (public/help.html): the search box, category
   chips and FAQ accordion (all JS-rendered in the original), the contact card
   whose "CHAT WITH US" button opens the ZBot, and the ZBot itself. Data + filter
   logic mirror the legacy inline <script>. */

import { useRef, useState } from 'react';
import { ZBot, type ZBotHandle } from '../../components/zbot';

type Faq = { cat: string; q: string; a: string };

const FAQS: Faq[] = [
  { cat: 'Tickets & entry', q: 'Where is my ticket after I pay?', a: 'Your pass lives in the Zora app under Wallet — it works offline and updates live. No PDF, no email attachment. Sign in with the number you paid with and it will be there.' },
  { cat: 'Tickets & entry', q: "My ticket won't download or show up", a: 'Pull to refresh in the app, or sign out and back in once to reissue passes to your device. Still missing? Open the chat and we can push it manually in minutes.' },
  { cat: 'Tickets & entry', q: 'How do I get into the event?', a: 'Show the live pass in the app at the gate — the animation confirms it is real. Screenshots do not scan. Arrive with the app installed and signed in.' },
  { cat: 'Payments', q: 'My payment timed out — was I charged?', a: 'No double charge. Pending mobile-money holds reverse automatically within a few minutes. If you got a confirmation SMS, your tickets are already in the app. No confirmation after 10 minutes? Just try again.' },
  { cat: 'Payments', q: 'Which payment methods work?', a: 'Mobile money (M-Pesa, Tigo Pesa, Airtel Money and more by region) plus Visa and Mastercard. You always pay the exact price shown — no fees added at checkout.' },
  { cat: 'Payments', q: 'Are there any booking or service fees?', a: 'None for buyers. The price you see is the price you pay. Zora takes a flat commission from the organizer instead — see the pricing page.' },
  { cat: 'Account', q: 'How do I sign up?', a: 'Two taps with Google, or use your email. If your number says it is already in use, you already have an account — choose Sign in and request a one-time code.' },
  { cat: 'Account', q: 'I forgot my password', a: 'There are no passwords to forget. On the sign-in screen tap “Get a code” and we text you a one-time login code.' },
  { cat: 'Organizers', q: 'How much does it cost to sell on Zora?', a: 'A flat 5% per ticket during the Tanzania launch — no listing or monthly fees. It covers payments, your storefront, dashboard, CRM and email. Full breakdown on the pricing page.' },
  { cat: 'Organizers', q: 'When do I get paid out?', a: 'On your schedule, to mobile money or bank. Instant payout to mobile money is available once your identity check clears (usually within 24 hours of signing up).' },
  { cat: 'Organizers', q: 'Why is my account “pending verification”?', a: 'A one-time ID check keeps scammers off the marketplace. You can draft events immediately; payouts and public listing unlock once approved — normally within 24 hours.' },
  { cat: 'Refunds & resale', q: 'Can I get a refund or resell my ticket?', a: 'List it on the in-app resale market, capped at face value +10%. When it sells, the new pass issues and yours voids automatically. If the organizer cancels, you are refunded to your original method with no action needed.' },
  { cat: 'Refunds & resale', q: 'Someone is reselling above face value', a: 'That is impossible on Zora — resale is hard-capped at face +10% inside the app, and off-platform passes will not scan. Only buy through the app or an organizer’s zora.com storefront.' },
];

const CATS = ['All', ...Array.from(new Set(FAQS.map((f) => f.cat)))];

export function HelpApp() {
  const [activeCat, setActiveCat] = useState('All');
  const [query, setQuery] = useState('');
  const zbotRef = useRef<ZBotHandle>(null);

  let list = FAQS.filter((f) => activeCat === 'All' || f.cat === activeCat);
  if (query) list = list.filter((f) => (f.q + ' ' + f.a).toLowerCase().includes(query));
  const cats = Array.from(new Set(list.map((f) => f.cat)));

  const onSearch = (v: string) => {
    const q = v.toLowerCase().trim();
    setQuery(q);
    if (q) setActiveCat('All');
  };

  return (
    <>
      <header className="hero">
        <div className="wrap">
          <p className="kicker">HELP CENTRE</p>
          <h1>How can we help?</h1>
          <p>Search below, browse by topic, or chat with Zora Assist any time.</p>
          <div className="searchbox">
            <svg viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              id="q"
              placeholder="Search: download, refund, payout…"
              autoComplete="off"
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </div>
      </header>

      <div className="chips" id="chips">
        {CATS.map((c) => (
          <button
            className={'chip' + (activeCat === c ? ' on' : '')}
            data-c={c}
            key={c}
            onClick={() => setActiveCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <main>
        <div className="wrap" id="faq-root">
          {cats.map((cat) => (
            <div key={cat}>
              <p className="cat-h">{cat.toUpperCase()}</p>
              {list
                .filter((f) => f.cat === cat)
                .map((f) => (
                  <details className="faq" key={f.q}>
                    <summary>
                      {f.q}
                      <span className="plus">+</span>
                    </summary>
                    <div className="a">{f.a}</div>
                  </details>
                ))}
            </div>
          ))}
        </div>
        <div className="wrap">
          <p className="no-res" id="no-res" style={{ display: list.length ? 'none' : 'block' }}>
            No answers matched that. Try the chat, bottom-right.
          </p>
        </div>

        <div className="wrap">
          <div className="contact">
            <h3>Still stuck?</h3>
            <p>Zora Assist handles most things instantly. For anything else, a human replies within a couple of hours.</p>
            <div className="btns">
              <button className="btn pri" id="open-chat" onClick={() => zbotRef.current?.open()}>
                CHAT WITH US
              </button>
              <a className="btn" href="mailto:hello@zora.app">
                EMAIL HELLO@ZORA.APP
              </a>
            </div>
          </div>
        </div>
      </main>

      <ZBot ref={zbotRef} />
    </>
  );
}

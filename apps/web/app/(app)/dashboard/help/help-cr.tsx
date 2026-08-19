'use client';

/* PR-BS77 · organizer Help & Support, on the Control-Room v2 primitives.
   A short, organizer-focused help centre: a contact-support panel (WhatsApp
   first, then email/phone/Instagram — all from the shared @zora/core/contacts
   source of truth) and a grouped, searchable FAQ (getting started, payouts,
   tickets & check-in, account & verification).

   Content is static, so the only async work is the topbar store label
   (GET /api/org/me), matching every other CR surface. The search box drives a
   clean empty state that routes people to WhatsApp when nothing matches. All
   chrome is CR-token-driven; the tiny <style> block is class-prefixed (.help-*)
   so it can never collide with the shared .cr-* classes. */

import { useEffect, useMemo, useState } from 'react';
import {
  SUPPORT_EMAIL,
  SUPPORT_EMAIL_HREF,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
  WHATSAPP_HREF,
  INSTAGRAM_LABEL,
  INSTAGRAM_URL,
} from '@zora/core/contacts';
import { CrShell } from '@/app/components/cr';
import { ORG_NAV, ORG_BRAND } from '../components/org-nav';

const ORG_BRAND_NODE = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: ORG_BRAND.sublabel };

type Faq = { cat: string; q: string; a: string };

// Organizer-facing help — adapted from the consumer help centre but scoped to
// the things an organizer does inside this console. Trust-forward, plain voice.
const FAQS: Faq[] = [
  {
    cat: 'Getting started',
    q: 'How do I create my first event?',
    a: 'Open Events in the sidebar and fill in the basics — name, date, venue and your ticket tiers. Save it as a draft first; you can keep editing until it looks right, then publish to make it public and shareable.',
  },
  {
    cat: 'Getting started',
    q: 'Why is my account “pending verification”?',
    a: 'A one-time ID check keeps scammers off the marketplace. You can draft events straight away — public listing and payouts unlock once you are approved, normally within 24 hours of signing up.',
  },
  {
    cat: 'Getting started',
    q: 'How do I customise my storefront?',
    a: 'Open Storefront to set your brand name, logo, colours and the events you want featured. It is the public page you share with buyers, and it updates live as you edit.',
  },
  {
    cat: 'Payouts',
    q: 'When do I get paid?',
    a: 'On your schedule. Your available balance builds as tickets sell, and you request a withdrawal to mobile money or bank whenever you like. Instant mobile-money payout is available once your identity check clears.',
  },
  {
    cat: 'Payouts',
    q: 'How do I request a withdrawal?',
    a: 'Open Payouts, check your available balance, enter an amount and confirm. Every figure there is calculated on our side — you only ever choose how much to move and where it goes. Your request then shows in the history with its status.',
  },
  {
    cat: 'Payouts',
    q: 'What does Zora charge?',
    a: 'A flat 5% per ticket during the Tanzania launch — no listing or monthly fees. It covers payments, your storefront, the dashboard, CRM and email. The commission comes off your side; it is never added on top of the buyer’s ticket price.',
  },
  {
    cat: 'Tickets & check-in',
    q: 'How do guests receive their tickets?',
    a: 'Instantly, in the Zora app under Wallet, as a live pass — no PDF and no email attachment. Buyers sign in with the number they paid with and the pass is there, working offline and updating live.',
  },
  {
    cat: 'Tickets & check-in',
    q: 'How do I scan tickets at the door?',
    a: 'Use the in-app scanner on any phone signed in to your organizer account. Each live pass animates when it scans so your gate team can see it is genuine — screenshots do not scan, so there is nothing to forge.',
  },
  {
    cat: 'Tickets & check-in',
    q: 'Can I issue comps or guest-list passes?',
    a: 'Yes. Open Comps to issue complimentary passes to guests, press or partners. They arrive as the same live passes buyers get and scan exactly the same way at the door.',
  },
  {
    cat: 'Account & support',
    q: 'Where do I see how sales are going?',
    a: 'Home gives you the headline numbers — revenue, tickets sold and recent orders — and Sales breaks it down by event and tier. Both update live as orders come in.',
  },
  {
    cat: 'Account & support',
    q: 'A buyer says they were charged but has no ticket',
    a: 'Pending mobile-money holds reverse on their own within a few minutes, so there is rarely a real double charge. Ask them to pull to refresh in the app, or sign out and back in to reissue the pass. If it is still missing, message us and we can push it manually.',
  },
];

const CATS = Array.from(new Set(FAQS.map((f) => f.cat)));

export default function HelpCr() {
  // Topbar store label — same /api/org/me pattern as every CR surface.
  const [orgName, setOrgName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/org/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.name === 'string') setOrgName(d.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const list = useMemo(() => (q ? FAQS.filter((f) => (f.q + ' ' + f.a).toLowerCase().includes(q)) : FAQS), [q]);
  const shownCats = useMemo(() => CATS.filter((c) => list.some((f) => f.cat === c)), [list]);

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND_NODE}
      topbarTitle="Help & Support"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>{orgName || ' '}</span>}
      footer={
        <>
          <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a>
        </>
      }
    >
      <div className="cr-stack help-root">
        {/* Contact support — the primary path, kept first so help is one tap away. */}
        <section className="cr-panel help-contact">
          <div className="help-contact-copy">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Talk to a human
            </h2>
            <p className="help-lead">
              Message us on WhatsApp for the fastest reply — a real person usually answers within a couple of hours. Email
              and phone work too.
            </p>
          </div>
          <div className="help-btns">
            <a className="cr-btn help-btn-pri" href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer">
              Message us on WhatsApp
            </a>
            <a className="cr-btn" href={SUPPORT_EMAIL_HREF}>
              {SUPPORT_EMAIL}
            </a>
            <a className="cr-btn" href={SUPPORT_PHONE_HREF}>
              {SUPPORT_PHONE}
            </a>
            <a className="cr-btn" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
              {INSTAGRAM_LABEL}
            </a>
          </div>
        </section>

        {/* FAQ — grouped, with a search that drives a clean empty state. */}
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Frequently asked
            </h2>
          </div>

          <input
            className="cr-input help-search"
            type="search"
            placeholder="Search help — payouts, scanning, verification…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search help topics"
          />

          {list.length === 0 ? (
            <div className="cr-empty" style={{ marginTop: 16 }}>
              <strong>No answers matched “{query.trim()}”.</strong>
              <span>
                Message us on WhatsApp and a real person will help.{' '}
                <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cr-blue)' }}>
                  Open WhatsApp
                </a>
                .
              </span>
            </div>
          ) : (
            <div className="help-faq-groups">
              {shownCats.map((cat) => (
                <div key={cat} className="help-faq-group">
                  <p className="help-cat">{cat}</p>
                  {list
                    .filter((f) => f.cat === cat)
                    .map((f) => (
                      <details className="help-faq" key={f.q}>
                        <summary>
                          <span>{f.q}</span>
                          <span className="help-plus" aria-hidden="true">
                            +
                          </span>
                        </summary>
                        <p className="help-answer">{f.a}</p>
                      </details>
                    ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <style>{`
        .help-lead {
          margin: 8px 0 0;
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--cr-ink2);
          max-width: 62ch;
        }
        .help-contact {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
        }
        .help-contact-copy { min-width: 0; }
        .help-btns {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }
        .help-btn-pri {
          background: var(--cr-blue);
          border-color: var(--cr-blue);
          color: #fff;
          font-weight: 600;
        }
        .help-btn-pri:hover {
          border-color: var(--cr-blue);
          filter: brightness(1.06);
        }
        .help-search { margin-bottom: 6px; }
        .help-faq-groups {
          display: flex;
          flex-direction: column;
          gap: 18px;
          margin-top: 14px;
        }
        .help-cat {
          font-family: var(--cr-mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--cr-mut);
          margin: 0 0 6px;
        }
        .help-faq {
          border-bottom: 1px solid var(--cr-hair);
        }
        .help-faq summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 13px 2px;
          cursor: pointer;
          list-style: none;
          font-size: 13.5px;
          font-weight: 500;
          color: var(--cr-ink);
        }
        .help-faq summary::-webkit-details-marker { display: none; }
        .help-faq summary:hover { color: var(--cr-blue); }
        .help-plus {
          font-family: var(--cr-mono);
          font-size: 16px;
          line-height: 1;
          color: var(--cr-mut);
          flex-shrink: 0;
          transition: transform 0.18s ease;
        }
        .help-faq[open] .help-plus { transform: rotate(45deg); color: var(--cr-blue); }
        .help-answer {
          margin: 0;
          padding: 0 2px 14px;
          font-size: 13px;
          line-height: 1.6;
          color: var(--cr-ink2);
          max-width: 68ch;
        }
        @media (prefers-reduced-motion: reduce) {
          .help-plus { transition: none; }
        }
      `}</style>
    </CrShell>
  );
}

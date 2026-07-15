/* ══════════════════════════════════════════════════════════
   ZORA ASSIST — minimalist support bot (front-end, scripted)
   Handles common issues: ticket download, payment timeout,
   registration, refunds/resale. Falls back to Help Centre.
   Requires the .zbot markup block to exist on the page.
   ══════════════════════════════════════════════════════════ */
(function(){
  const panel = document.getElementById('zbot-panel');
  const fab   = document.getElementById('zbot-fab');
  const msgs  = document.getElementById('zbot-msgs');
  const quick = document.getElementById('zbot-quick');
  const form  = document.getElementById('zbot-form');
  const text  = document.getElementById('zbot-text');
  if (!panel || !fab) return;

  let greeted = false;

  const FLOWS = {
    download: {
      label: "Ticket won't download",
      reply: "Your pass lives in the Zora app, not as a PDF. Open the app → Wallet and it's there, even offline. If the app shows nothing yet, pull down to refresh, or make sure you're signed in with the number you bought with.",
      next: ['still_stuck', 'human']
    },
    payment: {
      label: "Payment / transaction timed out",
      reply: "If a payment timed out, you were not charged twice — pending mobile-money holds auto-reverse within a few minutes. Check your SMS for a confirmation; if you see one, your tickets are already in the app. No confirmation after 10 min? Try the purchase again.",
      next: ['no_tickets', 'human']
    },
    signup: {
      label: "Trouble signing up",
      reply: "Signing up takes two taps with Google, or use your email. If your number says 'already in use', you likely have an account — try 'Sign in' instead. Organizers: your dashboard opens the moment you claim your address.",
      next: ['reset', 'human']
    },
    refund: {
      label: "Refund or resale",
      reply: "Can't make an event? List your ticket on the in-app resale market (capped at face +10%) — when it sells, the new pass is issued and yours voids automatically. Event cancelled by the organizer? You're refunded to your original method, no action needed.",
      next: ['human', 'help']
    },
    still_stuck: { label: "Still not showing", reply: "Sorry about that. Sign out and back in once — that reissues your passes to the device. If it's still missing, our team can push it manually in a few minutes.", next: ['human', 'help'] },
    no_tickets:  { label: "Still no tickets", reply: "Let's not leave you hanging. Share the phone number you paid with in the Help Centre form and we'll trace the transaction and release your tickets.", next: ['human', 'help'] },
    reset:       { label: "Reset my access", reply: "On the sign-in screen tap 'Get a code' — we'll text a one-time code to your number. No passwords to forget.", next: ['human', 'help'] },
    human:       { label: "Talk to a human", reply: "On it. Our support team replies within a couple of hours (Mon–Sun). Drop your question in the Help Centre and we'll email you back — or reach us at hello@zora.app.", next: ['help'] },
    help:        { label: "Open Help Centre", reply: "Opening the Help Centre — you'll find step-by-step answers there.", act: () => setTimeout(() => location.href = 'help.html', 700), next: [] }
  };

  function scrollDown(){ msgs.scrollTop = msgs.scrollHeight; }
  function addMsg(who, txt){
    const d = document.createElement('div');
    d.className = 'zmsg ' + who;
    d.textContent = txt;
    msgs.appendChild(d); scrollDown();
  }
  function typing(cb){
    const t = document.createElement('div');
    t.className = 'zmsg bot'; t.textContent = '…';
    msgs.appendChild(t); scrollDown();
    setTimeout(() => { t.remove(); cb(); }, 550);
  }
  function renderQuick(keys){
    quick.innerHTML = '';
    keys.forEach(k => {
      const f = FLOWS[k]; if (!f) return;
      const b = document.createElement('button');
      b.className = 'zq'; b.textContent = f.label;
      b.addEventListener('click', () => runFlow(k));
      quick.appendChild(b);
    });
  }
  function runFlow(key){
    const f = FLOWS[key]; if (!f) return;
    addMsg('me', f.label);
    quick.innerHTML = '';
    typing(() => {
      addMsg('bot', f.reply);
      if (f.act) f.act();
      renderQuick(f.next && f.next.length ? f.next : ['download','payment','signup','refund']);
    });
  }

  function matchTyped(raw){
    const s = raw.toLowerCase();
    if (/(download|wallet|pdf|ticket.*(show|find|missing)|where.*ticket)/.test(s)) return 'download';
    if (/(pay|paid|charge|timed? ?out|timeout|pending|mpesa|m-pesa|money|failed)/.test(s)) return 'payment';
    if (/(sign ?up|signup|register|account|log ?in|login|password|code)/.test(s)) return 'signup';
    if (/(refund|resell|resale|cancel|transfer|sell)/.test(s)) return 'refund';
    if (/(human|agent|person|call|email|contact|support)/.test(s)) return 'human';
    return null;
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = text.value.trim(); if (!v) return;
    addMsg('me', v); text.value = '';
    const key = matchTyped(v);
    quick.innerHTML = '';
    typing(() => {
      if (key){ const f = FLOWS[key]; addMsg('bot', f.reply); renderQuick(f.next); }
      else { addMsg('bot', "I'm not fully sure on that one — but our Help Centre has it, or I can get a human on it."); renderQuick(['help','human']); }
    });
  });

  function open(){
    panel.classList.add('on'); fab.classList.add('hide');
    if (!greeted){
      greeted = true;
      typing(() => {
        addMsg('bot', "Hey — I'm Zora Assist. What can I help with?");
        renderQuick(['download','payment','signup','refund']);
      });
    }
    setTimeout(() => text.focus(), 100);
  }
  function close(){ panel.classList.remove('on'); fab.classList.remove('hide'); }
  fab.addEventListener('click', open);
  document.getElementById('zbot-x').addEventListener('click', close);
})();

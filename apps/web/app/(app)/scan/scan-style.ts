/* BS42 — the scanner PWA stylesheet. House convention (apps/web has NO
   Tailwind): one page-scoped `<style>` block under a single root class, so the
   door's look never leaks into the consumer or control-room planes.

   This is DESIGN.md's third plane, "Door", verbatim: brand chrome, utility core.
   The cinematic layer the consumer surfaces use — shimmer, particles, aura text,
   ambient motion — is DELIBERATELY ABSENT below the top strip. At a door,
   legibility, battery and a 0.5-second read beat polish:

     · canvas #0A0B10, Space Grotesk for the giant result word, IBM Plex Mono for
       pass details, Inter for body.
     · the RESULT is a full-screen SOLID-COLOUR takeover, readable across a
       crowd: true go-green for valid, red for used/invalid/wrong-event, and the
       aura gradient reserved for the one case that means "escalate".
     · motion is near-zero: one fast slam-in on the result, nothing ambient, and
       `prefers-reduced-motion` removes even that.
     · one-handed: every target ≥44px, the primary action sits at the BOTTOM of
       the screen where a thumb reaches, and safe-area insets are respected. */

export const SCAN_STYLE = `
.zscan{
  --bg:#0A0B10;--bg2:#0D0F17;--surface:#11131E;--surface2:#171A28;
  --text:#EDEFF7;--text2:#9BA3C4;--text3:#5C6488;
  --hair:rgba(124,160,255,.12);--hair2:rgba(124,160,255,.22);
  --blue:#4C6FFF;--ice:#7CA0FF;--cyan:#3FE0FF;--amber:#F0A83C;
  /* A TRUE go-green, not brand magenta: at a door this colour means "walk". */
  --go:#0FA958;--go2:#0B8646;
  --stop:#D8352A;--stop2:#B32218;
  --aura:linear-gradient(130deg,#D53AD8,#FF4D7D,#FF9145);
  --disp:'Space Grotesk',system-ui,-apple-system,sans-serif;
  --sans:'Inter',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,monospace;
  position:fixed;inset:0;background:var(--bg);color:var(--text);
  font-family:var(--sans);font-size:16px;line-height:1.5;
  -webkit-font-smoothing:antialiased;overflow:hidden;
  display:flex;flex-direction:column;
  padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
.zscan *{margin:0;padding:0;box-sizing:border-box}
.zscan button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
.zscan .mono{font-family:var(--mono);letter-spacing:.14em;text-transform:uppercase}
.zscan :focus-visible{outline:2px solid var(--ice);outline-offset:2px}

/* ── top strip: the ONLY brand chrome (DESIGN.md: "thin top strip only") ───── */
.zscan .strip{
  display:flex;align-items:center;gap:10px;padding:10px 14px;min-height:48px;
  border-bottom:1px solid var(--hair);background:var(--bg);flex:0 0 auto;z-index:5}
.zscan .mark{font-family:var(--disp);font-weight:700;font-size:15px;letter-spacing:-.02em;flex:0 0 auto}
.zscan .mark i{
  display:inline-block;width:.62em;height:.62em;border-radius:50%;background:var(--aura);
  vertical-align:baseline;margin:0 .02em}
.zscan .strip-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.zscan .strip-mid b{
  font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;font-weight:500;color:var(--text2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}
.zscan .strip-mid span{
  font-family:var(--mono);font-size:11.5px;letter-spacing:.16em;color:var(--text3);text-transform:uppercase}
.zscan .net{
  display:flex;align-items:center;gap:6px;flex:0 0 auto;
  font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;color:var(--text3);text-transform:uppercase}
.zscan .net i{width:8px;height:8px;border-radius:50%;background:var(--cyan);flex:0 0 8px}
.zscan .net.off{color:var(--amber)}
.zscan .net.off i{background:var(--amber)}

/* ── generic body ─────────────────────────────────────────────────────────── */
.zscan .body{flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto}
.zscan .pad{padding:22px 20px 0}
.zscan h1{font-family:var(--disp);font-size:30px;line-height:1.1;letter-spacing:-.02em;font-weight:600}
.zscan .lede{color:var(--text2);font-size:14.5px;margin-top:9px;max-width:34ch}
.zscan .label{
  display:block;font-family:var(--mono);font-size:11.5px;letter-spacing:.2em;color:var(--text3);
  text-transform:uppercase;margin-bottom:9px}

/* ── fields (consumer plane: dark field, blue focus ring) ─────────────────── */
.zscan input{
  width:100%;min-height:56px;background:var(--surface2);border:1px solid var(--hair2);border-radius:12px;
  color:var(--text);font-family:var(--mono);font-size:22px;letter-spacing:.34em;text-align:center;
  padding:12px 14px;-webkit-appearance:none}
.zscan input.wide{letter-spacing:.16em;font-size:17px}
.zscan input::placeholder{color:var(--text3);letter-spacing:.2em}
.zscan input:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(76,111,255,.22)}

/* ── buttons — thumb-bottom, ≥44px, aura ONLY on the primary action ───────── */
.zscan .foot{
  flex:0 0 auto;padding:14px 20px calc(16px + env(safe-area-inset-bottom));
  border-top:1px solid var(--hair);background:var(--bg);display:grid;gap:10px}
.zscan .btn{
  width:100%;min-height:54px;border-radius:12px;font-family:var(--mono);font-size:13px;
  letter-spacing:.18em;text-transform:uppercase;font-weight:500;
  display:flex;align-items:center;justify-content:center;gap:8px}
.zscan .btn.aura{background:var(--aura);color:#0A0B10;font-weight:600}
.zscan .btn.ghost{border:1px solid var(--hair2);color:var(--text2)}
.zscan .btn.solid{background:var(--surface2);color:var(--text)}
.zscan .btn[disabled]{opacity:.45;cursor:not-allowed}
.zscan .btn.tiny{min-height:44px;font-size:11.5px;letter-spacing:.16em}

/* ── inline error / notice ────────────────────────────────────────────────── */
.zscan .note{
  margin-top:14px;padding:13px 14px;border-radius:10px;border:1px solid var(--hair2);
  background:var(--surface);font-size:14px;color:var(--text2)}
.zscan .note.bad{border-color:rgba(216,53,42,.5);background:rgba(216,53,42,.1);color:#FFC9C4}
.zscan .note.warn{border-color:rgba(240,168,60,.45);background:rgba(240,168,60,.1);color:#F6D8A8}
.zscan .note b{display:block;font-family:var(--mono);font-size:11.5px;letter-spacing:.18em;
  text-transform:uppercase;color:inherit;margin-bottom:5px}

/* ── viewfinder ───────────────────────────────────────────────────────────── */
.zscan .view{flex:1;min-height:0;position:relative;background:#05060A;overflow:hidden}
.zscan .view video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.zscan .reticle{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:min(68vw,290px);aspect-ratio:1;border-radius:20px;
  box-shadow:0 0 0 100vmax rgba(5,6,10,.55);pointer-events:none}
.zscan .reticle i{position:absolute;width:30px;height:30px;border:2.5px solid var(--ice)}
.zscan .reticle i:nth-child(1){top:0;left:0;border-right:0;border-bottom:0;border-radius:14px 0 0 0}
.zscan .reticle i:nth-child(2){top:0;right:0;border-left:0;border-bottom:0;border-radius:0 14px 0 0}
.zscan .reticle i:nth-child(3){bottom:0;left:0;border-right:0;border-top:0;border-radius:0 0 0 14px}
.zscan .reticle i:nth-child(4){bottom:0;right:0;border-left:0;border-top:0;border-radius:0 0 14px 0}
.zscan .hint{
  position:absolute;left:0;right:0;bottom:16px;text-align:center;
  font-family:var(--mono);font-size:11.5px;letter-spacing:.18em;color:var(--text2);text-transform:uppercase;
  text-shadow:0 1px 6px rgba(0,0,0,.9);pointer-events:none}

/* ── THE RESULT TAKEOVER — full-screen solid colour ───────────────────────── */
.zscan .take{
  position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:32px 24px;
  padding-bottom:calc(32px + env(safe-area-inset-bottom));
  color:#fff;cursor:pointer;
  /* One fast, confident slam-in. Nothing else moves. */
  animation:zscan-slam .13s cubic-bezier(.2,.9,.3,1.4)}
@keyframes zscan-slam{from{opacity:0;transform:scale(.955)}to{opacity:1;transform:none}}
.zscan .take.go{background:var(--go)}
.zscan .take.stop{background:var(--stop)}
/* The ONE place brand colour earns its keep at the door: "escalate". */
.zscan .take.esc{background:var(--aura)}
.zscan .take .glyph{
  font-family:var(--disp);font-size:clamp(76px,26vw,132px);line-height:1;font-weight:700;
  margin-bottom:4px}
.zscan .take .word{
  font-family:var(--disp);font-weight:700;letter-spacing:-.02em;
  font-size:clamp(38px,12.5vw,64px);line-height:1.02;text-transform:uppercase}
.zscan .take .why{
  margin-top:14px;font-size:17px;line-height:1.35;max-width:22ch;color:rgba(255,255,255,.94)}
.zscan .take .meta{
  margin-top:20px;display:grid;gap:5px;font-family:var(--mono);font-size:13px;letter-spacing:.14em;
  text-transform:uppercase;color:rgba(255,255,255,.9)}
.zscan .take .meta b{font-weight:600;font-size:15px;letter-spacing:.1em}
.zscan .take .prior{
  margin-top:18px;padding:11px 15px;border-radius:10px;background:rgba(0,0,0,.24);
  font-family:var(--mono);font-size:13px;letter-spacing:.12em;text-transform:uppercase}
.zscan .take .tap{
  position:absolute;left:0;right:0;bottom:calc(20px + env(safe-area-inset-bottom));
  font-family:var(--mono);font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;
  color:rgba(255,255,255,.7)}
.zscan .take .act{
  margin-top:26px;min-height:56px;padding:0 30px;border-radius:12px;background:#0A0B10;color:#fff;
  font-family:var(--mono);font-size:13px;letter-spacing:.18em;text-transform:uppercase;font-weight:600}

/* ── supervisor queue — a calm dark list, not a klaxon ────────────────────── */
.zscan .queue{display:grid;gap:10px;padding:16px 20px 24px}
.zscan .qrow{
  border:1px solid var(--hair);background:var(--surface);border-radius:14px;padding:14px 15px;
  display:flex;align-items:center;gap:13px}
.zscan .qrow .who{flex:1;min-width:0}
.zscan .qrow .who b{display:block;font-size:16px;font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zscan .qrow .who span{
  display:block;margin-top:4px;font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;
  color:var(--text3);text-transform:uppercase}
.zscan .qrow .go{
  flex:0 0 auto;min-height:48px;min-width:112px;border-radius:10px;background:var(--go);color:#04140B;
  font-family:var(--mono);font-size:12px;letter-spacing:.16em;font-weight:700;text-transform:uppercase}
.zscan .qrow .go[disabled]{opacity:.5}
.zscan .empty{padding:52px 24px;text-align:center;color:var(--text2)}
.zscan .empty b{display:block;font-family:var(--disp);font-size:21px;color:var(--text);margin-bottom:8px}
.zscan .skel{display:grid;gap:10px;padding:16px 20px}
.zscan .skel i{display:block;height:72px;border-radius:14px;background:var(--surface);opacity:.6}

/* ── tally strip ──────────────────────────────────────────────────────────── */
.zscan .tally{
  display:flex;gap:0;border-bottom:1px solid var(--hair);background:var(--bg2)}
.zscan .tally div{flex:1;padding:11px 8px;text-align:center;border-right:1px solid var(--hair)}
.zscan .tally div:last-child{border-right:0}
.zscan .tally b{display:block;font-family:var(--mono);font-size:19px;letter-spacing:.02em;color:var(--text)}
.zscan .tally span{
  display:block;margin-top:3px;font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;
  color:var(--text3);text-transform:uppercase}

/* ── BS107 (#184): the seller (cash / mobile at the gate) ─────────────────── */
.zscan .sell-modebar{display:flex;gap:8px;padding:12px 16px 0}
.zscan .sell-modebtn{flex:1;min-height:40px;border:1px solid var(--hair2);border-radius:10px;background:var(--surface);color:var(--text3);font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
.zscan .sell-modebtn.on{background:var(--surface2);color:var(--text);border-color:var(--blue)}
.zscan .view.sell{display:flex;flex-direction:column;gap:14px;padding:16px}
.zscan .sell-tiers{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.zscan .sell-tier{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 14px;border:1px solid var(--hair2);border-radius:12px;background:var(--surface);color:var(--text);cursor:pointer;text-align:left}
.zscan .sell-tier.on{border-color:var(--blue);background:var(--surface2)}
.zscan .sell-tier:disabled{opacity:.45;cursor:not-allowed}
.zscan .sell-tier-n{font-family:var(--sans);font-size:15px;font-weight:600}
.zscan .sell-tier-p{font-family:var(--mono);font-size:13px;color:var(--text)}
.zscan .sell-tier-a{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;color:var(--text3);text-transform:uppercase}
.zscan .sell-empty{grid-column:1/-1;color:var(--text3);font-size:13px}
.zscan .sell-qty{display:flex;align-items:center;gap:14px}
.zscan .sell-qty button{width:44px;height:44px;border-radius:10px;border:1px solid var(--hair2);background:var(--surface);color:var(--text);font-size:22px;cursor:pointer}
.zscan .sell-qty>span{font-family:var(--mono);font-size:18px;min-width:24px;text-align:center}
.zscan .sell-total{margin-left:auto;font-family:var(--mono);font-size:16px;font-weight:600;color:var(--text)}
.zscan .sell-phone{width:100%;min-height:46px;padding:0 14px;border:1px solid var(--hair2);border-radius:10px;background:var(--surface);color:var(--text);font-family:var(--sans);font-size:15px}
.zscan .sell-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.zscan .sell-note{font-family:var(--sans);font-size:13.5px;line-height:1.5;padding:11px 14px;border-radius:10px;border:1px solid var(--hair2)}
.zscan .sell-note.ok{color:var(--go);border-color:var(--go)}
.zscan .sell-note.err{color:var(--stop);border-color:var(--stop)}
.zscan .sell-note.wait{color:var(--amber);border-color:var(--amber)}
.zscan .sell-void{align-self:flex-start;background:none;border:1px solid var(--hair2);border-radius:9px;color:var(--stop);font-family:var(--mono);font-size:11px;letter-spacing:.06em;padding:9px 14px;cursor:pointer}
.zscan .sell-signout{margin-top:6px;background:none;border:none;color:var(--text3);font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;align-self:center}

/* ── reduced motion: the slam-in is the only animation, and it goes too ───── */
@media (prefers-reduced-motion: reduce){
  .zscan .take{animation:none}
  .zscan *{transition:none !important}
}
`;

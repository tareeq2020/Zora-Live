/* BS119 — shared ZoraPass primitives for the buyer flow screens that style
   themselves with an injected <style> string (split host/tracker, join invitee,
   share-pay, OTP sign-in). Handoff 03_COMPONENTS §1 (button), §7 (inputs), §11
   (a11y). Bone ground, board-black ink, one yellow accent; flat — no gradients,
   shadows or blur. PRIMITIVE --zp-color-* tokens only: <html data-theme>
   defaults to dark, and the semantic --zp-surface/--zp-text-* would flip these
   light screens to black. Injecting the string more than once (a nested
   component) is harmless — the rules are identical. */
export const ZP_FLOW_CSS = `
.zpf{--ink:var(--zp-color-board-black);--mut:var(--zp-color-ink-500);--line:var(--zp-color-line-light);
  --raised:var(--zp-color-white);--sunken:#EFEDE4;--yellow:var(--zp-color-signal-yellow);--danger:var(--zp-color-alert-red);
  color:var(--ink);font-family:var(--zp-font-family-sans);font-size:16px;line-height:1.35}
.zpf *{box-sizing:border-box}
.zpf-page{background:var(--zp-color-bone);min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px 64px}
.zpf-card{width:100%;max-width:440px;background:var(--raised);border:1px solid var(--line);border-radius:16px;padding:24px}
.zpf a:focus-visible,.zpf button:focus-visible{outline:3px solid var(--zp-color-board-black);outline-offset:2px}
.zpf-nav{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.zpf-wm{display:inline-flex;align-items:center;min-height:44px}
.zpf-wm img{height:24px;width:auto;display:block}
.zpf-back{min-height:44px;padding:0 14px;border-radius:999px;border:2px solid var(--ink);background:transparent;color:var(--ink);
  font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.zpf-back:hover{background:var(--sunken)}
.zpf-eyebrow{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;color:var(--mut);text-transform:uppercase}
.zpf-t{font-family:var(--zp-font-family-sans);font-weight:800;font-size:28px;line-height:1.08;letter-spacing:-.02em;margin:8px 0 8px}
.zpf-sub{color:var(--mut);font-size:16px;line-height:1.45;margin:0}
.zpf-sub b{color:var(--ink)}
.zpf-sub a,.zpf-link{color:var(--ink);font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer;background:none;border:none;padding:0;font:inherit;font-weight:700}
.zpf-lab{display:block;font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;color:var(--mut);text-transform:uppercase;margin:16px 0 8px}
.zpf-field{height:48px;background:var(--raised);border:2px solid var(--line);border-radius:12px;padding:0 14px;display:flex;align-items:center;gap:10px}
.zpf-field:focus-within{border-color:var(--ink);outline:3px solid var(--yellow);outline-offset:2px}
.zpf-field .pfx{font-family:var(--zp-font-family-mono);color:var(--mut);font-size:16px}
.zpf-field input{background:none;border:none;outline:none;color:var(--ink);font-family:var(--zp-font-family-mono);font-size:16px;width:100%;height:100%}
.zpf-err{border:2px solid var(--danger);color:var(--danger);background:var(--raised);border-radius:12px;padding:12px 14px;font-size:14px;margin-top:12px}
.zpf-amt{display:flex;justify-content:space-between;align-items:baseline;gap:12px;background:var(--sunken);border-radius:16px;padding:16px}
.zpf-amt .k{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;color:var(--mut)}
.zpf-amt .v{font-family:var(--zp-font-family-mono);font-weight:600;font-size:24px}
/* primary — black block, yellow Bungee label (≥20px), arrow on the right */
.zpf-btn{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;height:56px;padding:0 24px;margin-top:16px;
  border-radius:16px;border:none;cursor:pointer;background:var(--zp-color-board-black);color:var(--yellow);
  font-family:var(--zp-font-family-display);font-weight:400;font-size:20px;text-decoration:none;text-align:left;transition:background 120ms}
.zpf-btn:hover{background:var(--zp-color-ink-600);color:var(--yellow)}
.zpf-btn:active{transform:translateY(2px)}
.zpf-btn:disabled{background:var(--zp-color-ink-300);color:var(--zp-color-ink-500);cursor:not-allowed;transform:none}
.zpf-btn .spin{width:20px;height:20px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:zpf-rot .8s linear infinite}
/* secondary — outline, Bricolage Bold */
.zpf-btn2{display:flex;width:100%;align-items:center;justify-content:center;min-height:48px;padding:0 20px;margin-top:12px;
  border-radius:16px;border:2px solid var(--ink);background:transparent;color:var(--ink);
  font-family:var(--zp-font-family-sans);font-weight:700;font-size:16px;cursor:pointer;text-decoration:none;text-align:center}
.zpf-btn2:hover{background:var(--sunken)}
.zpf-btn2:active{transform:translateY(2px)}
.zpf-spinner{width:32px;height:32px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--ink);margin:0 auto;animation:zpf-rot .8s linear infinite}
.zpf-foot{text-align:center;color:var(--mut);font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.08em;margin:16px 0 0;line-height:1.6}
.zpf-rows{margin-top:16px;display:flex;flex-direction:column;border-top:1px solid var(--line)}
.zpf-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-bottom:1px solid var(--line)}
.zpf-av{width:36px;height:36px;border-radius:999px;background:var(--sunken);color:var(--ink);display:flex;align-items:center;justify-content:center;
  font-family:var(--zp-font-family-mono);font-weight:600;font-size:13px;flex:0 0 auto}
.zpf-av.host{background:var(--yellow)}
.zpf-who{flex:1;min-width:0}
.zpf-who .n{font-size:16px;font-weight:700}
.zpf-who .p{font-family:var(--zp-font-family-mono);font-size:13px;color:var(--mut)}
/* row state — mono word + square marker, never colour alone (no chips) */
.zpf-state{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;display:inline-flex;align-items:center;gap:8px;color:var(--mut)}
.zpf-state::before{content:'';width:10px;height:10px;border:2px solid currentColor}
.zpf-state.paid{color:var(--ink)}
.zpf-state.paid::before{background:var(--ink)}
@keyframes zpf-rot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.zpf-spinner,.zpf-btn .spin{animation-duration:2.4s}}
`;

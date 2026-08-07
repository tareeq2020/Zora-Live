'use client';

/* BS27 — the apex "coming soon" home. A React/framer-motion port of the design
   in docs-assets/zorapass-coming-soon (a Vite + Tailwind app), reworked to this
   repo's conventions: NO Tailwind (a scoped <style> block instead, like every
   other page here), icons inlined as SVG (no lucide-react), and the background
   audio track removed (it was a copyrighted recording — the sound toggle is gone
   until a licensed track is wired). framer-motion drives the 3-act timeline.

   Three-act, self-driving timeline:
     ACT I   (0.0s–2.5s)  logo pulse-in + "Hi, I'm Zora"
     ACT II  (2.5s–6.0s)  kinetic stagger to the brand statement
     ACT III (6.0s–...)   logo dissolves to dust + launch sign-off */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]; // expo-out

// Brand palette sampled from the Zora orb + an electric-violet accent.
const BRAND = { magenta: '#c41ee0', pink: '#ec3f7e', orange: '#f7922f', violet: '#a855f7' };
const SPARKS = [BRAND.orange, BRAND.pink, BRAND.magenta, BRAND.violet];

/* ── inline social icons (no lucide-react) ── */
function IgIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3L18.9 2Zm-1.2 18h1.9L7.4 3.9H5.4L17.7 20Z" />
    </svg>
  );
}
function TikTokIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M16.5 3c.29 2.06 1.46 3.36 3.5 3.53v2.4c-1.18.11-2.22-.28-3.43-1.01v5.55c0 3.56-2.62 6.03-6.02 6.03A5.53 5.53 0 0 1 5 13.97c0-3.35 3.02-5.86 6.6-5.24v2.62c-.41-.13-.85-.2-1.29-.2-1.55 0-2.68 1-2.68 2.5s1.13 2.55 2.68 2.55c1.6 0 2.7-1.11 2.7-3.02V3h3.49z" />
    </svg>
  );
}

/* Small orb chip — brand gradient dot for the nav. */
function OrbChip({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-label="Zora"
      role="img"
      style={{
        display: 'inline-block',
        borderRadius: '9999px',
        width: size,
        height: size,
        background: `linear-gradient(45deg, ${BRAND.magenta}, ${BRAND.pink} 55%, ${BRAND.orange})`,
        boxShadow: '0 0 12px rgba(236,63,126,0.5)',
      }}
    />
  );
}

/* Hero orb wrapped in orbiting neon rings + ethereal aura. */
function ZoraMark({ size = 210 }: { size?: number }) {
  const box = size * 1.5;
  return (
    <div className="zcs-mark" style={{ width: box, height: box }} aria-hidden>
      <svg viewBox="0 0 300 300" fill="none">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={BRAND.orange} />
            <stop offset="100%" stopColor={BRAND.magenta} />
          </linearGradient>
        </defs>
        <circle cx="150" cy="150" r="142" stroke="url(#ringGrad)" strokeWidth="1" opacity="0.35" />
        <motion.circle
          cx="150" cy="150" r="132"
          stroke="#ffd9ea" strokeWidth="1.6" strokeDasharray="2 12" strokeLinecap="round"
          opacity="0.7" style={{ transformOrigin: '150px 150px' }}
          animate={{ rotate: 360 }} transition={{ duration: 26, ease: 'linear', repeat: Infinity }}
        />
        <motion.circle
          cx="150" cy="150" r="120"
          stroke={BRAND.violet} strokeWidth="1" strokeDasharray="1 8"
          opacity="0.5" style={{ transformOrigin: '150px 150px' }}
          animate={{ rotate: -360 }} transition={{ duration: 34, ease: 'linear', repeat: Infinity }}
        />
        <motion.g style={{ transformOrigin: '150px 150px' }} animate={{ rotate: 360 }} transition={{ duration: 18, ease: 'linear', repeat: Infinity }}>
          <circle cx="150" cy="6" r="2.6" fill={BRAND.orange} />
          <circle cx="294" cy="150" r="2" fill={BRAND.pink} />
          <circle cx="150" cy="294" r="1.7" fill={BRAND.violet} />
        </motion.g>
      </svg>
      <div className="zcs-aura zora-aura">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/zora-orb.png" alt="Zora" width={size} height={size} className="zcs-logo" style={{ width: size, height: size }} draggable={false} />
      </div>
    </div>
  );
}

/* One-shot expanding ring for the logo's "pulse into view". */
function EntranceRing() {
  return (
    <motion.span
      aria-hidden
      className="zcs-ring"
      initial={{ opacity: 0.7, scale: 0.62 }}
      animate={{ opacity: 0, scale: 1.6 }}
      transition={{ duration: 1.8, ease: EASE, delay: 0.25 }}
    />
  );
}

/* Ambient cursor-following glow orb. */
function CursorGlow() {
  const mx = useMotionValue(-600);
  const my = useMotionValue(-600);
  const x = useSpring(mx, { stiffness: 55, damping: 22, mass: 0.7 });
  const y = useSpring(my, { stiffness: 55, damping: 22, mass: 0.7 });

  useEffect(() => {
    const move = (e: PointerEvent) => {
      mx.set(e.clientX);
      my.set(e.clientY);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [mx, my]);

  return (
    <motion.div aria-hidden className="zcs-cursor" style={{ x, y }}>
      <div
        style={{
          height: 620,
          width: 620,
          transform: 'translate(-50%,-50%)',
          borderRadius: '9999px',
          opacity: 0.6,
          filter: 'blur(110px)',
          background: 'radial-gradient(circle, rgba(236,63,126,0.22), rgba(168,85,247,0.12) 42%, transparent 70%)',
        }}
      />
    </motion.div>
  );
}

/* Canvas ember / dust field — rising festival-light particles. */
type Particle = { x: number; y: number; r: number; vy: number; vx: number; life: number; maxLife: number; color: string; glow: number };
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const particles: Particle[] = [];
    const MAX = 90;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = (n: number) => {
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * w,
          y: h + Math.random() * 40,
          r: Math.random() * 1.9 + 0.4,
          vy: -(Math.random() * 0.42 + 0.14),
          vx: (Math.random() - 0.5) * 0.22,
          life: 0,
          maxLife: Math.random() * 620 + 380,
          color: SPARKS[(Math.random() * SPARKS.length) | 0],
          glow: Math.random() * 0.55 + 0.3,
        });
      }
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vx += (Math.random() - 0.5) * 0.012;
        if (p.life >= p.maxLife || p.y < -30) {
          particles.splice(i, 1);
          continue;
        }
        const alpha = Math.sin((p.life / p.maxLife) * Math.PI) * p.glow;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.r * 4;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (particles.length < MAX) spawn(MAX - particles.length);
      raf = requestAnimationFrame(tick);
    };

    resize();
    spawn(MAX);
    if (!reduce) raf = requestAnimationFrame(tick);
    else tick();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={canvasRef} aria-hidden className="zcs-canvas" />;
}

/* Fine film-grain overlay. */
function Grain() {
  const noise =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
  return <div aria-hidden className="zcs-grain" style={{ backgroundImage: noise }} />;
}

/* Act III — burst of dust the logo dissolves into. */
function DissolveBurst({ show }: { show: boolean }) {
  const bits = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 36 + Math.random() * 0.6;
        const dist = 130 + Math.random() * 280;
        return {
          id: i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          size: Math.random() * 4 + 1.5,
          color: SPARKS[(Math.random() * SPARKS.length) | 0],
          delay: Math.random() * 0.18,
        };
      }),
    [],
  );
  return (
    <div className="zcs-burst">
      <AnimatePresence>
        {show &&
          bits.map((b) => (
            <motion.span
              key={b.id}
              style={{ position: 'absolute', borderRadius: '9999px', width: b.size, height: b.size, background: b.color, boxShadow: `0 0 8px ${b.color}` }}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
              animate={{ x: b.x, y: b.y, opacity: [0, 1, 0], scale: [0, 1, 0.3] }}
              transition={{ duration: 1.7, ease: EASE, delay: b.delay }}
            />
          ))}
      </AnimatePresence>
    </div>
  );
}

function SocialBar() {
  const links = [
    { Icon: IgIcon, label: 'Instagram', href: '#' },
    { Icon: TikTokIcon, label: 'TikTok', href: '#' },
    { Icon: XIcon, label: 'X', href: '#' },
  ];
  return (
    <div className="zcs-social">
      {links.map(({ Icon, label, href }) => (
        <a key={label} href={href} aria-label={label}>
          <Icon width={18} height={18} />
        </a>
      ))}
    </div>
  );
}

/* ── act text blocks ── */
function ActOneText() {
  return (
    <motion.p
      initial={{ opacity: 0, y: 14, filter: 'blur(14px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -14, filter: 'blur(14px)', transition: { duration: 0.5, ease: EASE } }}
      transition={{ duration: 1, ease: EASE, delay: 0.45 }}
      className="zcs-act1"
    >
      Hi, I&rsquo;m <span className="shimmer-text">Zora</span>
    </motion.p>
  );
}

const VALUE_WORDS = [
  { t: 'The' }, { t: 'Operating' }, { t: 'System' }, { t: 'for' },
  { t: 'Live', g: true }, { t: 'Experiences', g: true }, { t: 'in' }, { t: 'Africa', g: true },
];
const wordUp = {
  hidden: { opacity: 0, y: 26, filter: 'blur(12px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.9, ease: EASE } },
};
function ActTwoText() {
  return (
    <motion.h1
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.12 } } }}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, filter: 'blur(12px)', transition: { duration: 0.5 } }}
      className="zcs-act2"
    >
      {VALUE_WORDS.map((w, i) => (
        <motion.span key={i} variants={wordUp} className={w.g ? 'shimmer-text' : 'w'}>
          {w.t}
        </motion.span>
      ))}
    </motion.h1>
  );
}
function ActThree() {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, ease: EASE, delay: 0.35 }} className="zcs-act3">
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.5 }} className="zcs-eyebrow">
        Launching Soon
      </motion.p>
      <motion.h1 initial={{ opacity: 0, y: 16, filter: 'blur(12px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 1, ease: EASE, delay: 0.6 }} className="zcs-h1">
        We are going <span className="shimmer-text">Live Soon</span>.
        <br className="zcs-br" /> See ya!
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.9 }} className="zcs-lede">
        The operating system powering Africa&rsquo;s live experiences is almost here. Follow along — or explore what&rsquo;s live today.
      </motion.p>
    </motion.div>
  );
}

/* ================================================================== */
export default function ComingSoon() {
  const [act, setAct] = useState(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const runSequence = useCallback(() => {
    timers.current.forEach(clearTimeout);
    setAct(1);
    timers.current = [
      setTimeout(() => setAct(2), 2500),
      setTimeout(() => setAct(3), 6000),
    ];
  }, []);

  useEffect(() => {
    runSequence();
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, [runSequence]);

  return (
    <div className="zcs">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />

      {/* breathing radial glows */}
      <div aria-hidden className="zcs-layer" style={{ background: 'radial-gradient(circle at 50% 42%, rgba(236,63,126,0.10), transparent 55%)', animation: 'zoraBreathe 8s ease-in-out infinite' }} />
      <div aria-hidden className="zcs-layer" style={{ background: 'radial-gradient(circle at 72% 78%, rgba(168,85,247,0.09), transparent 50%)' }} />
      <div aria-hidden className="zcs-layer" style={{ background: 'radial-gradient(circle at 22% 20%, rgba(247,146,47,0.06), transparent 45%)' }} />

      <ParticleField />
      <CursorGlow />
      <Grain />

      {/* cinematic vignette */}
      <div aria-hidden className="zcs-vignette" style={{ background: 'radial-gradient(circle at 50% 50%, transparent 52%, rgba(0,0,0,0.72))' }} />

      {/* top bar */}
      <header className="zcs-header">
        <span className="zcs-brand">
          <OrbChip size={22} />
          Zora<span style={{ color: BRAND.pink }}>Pass</span>
        </span>
        <nav className="zcs-nav">
          <Link href="/thebrunchcity">Explore events</Link>
          <Link href="/dashboard">Organizer sign in</Link>
        </nav>
      </header>

      {/* center stage */}
      <main className="zcs-main">
        <DissolveBurst show={act === 3} />
        <AnimatePresence mode="wait">
          {act < 3 ? (
            <motion.div key="intro" className="zcs-intro" exit={{ opacity: 0, scale: 0.7, filter: 'blur(16px)', transition: { duration: 0.9, ease: EASE } }}>
              <motion.div className="zcs-markwrap" initial={{ opacity: 0, scale: 0.5, filter: 'blur(10px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: 1.4, ease: EASE }}>
                <EntranceRing />
                <ZoraMark />
              </motion.div>
              <div className="zcs-actbox">
                <AnimatePresence mode="wait">
                  {act === 1 ? <ActOneText key="a1" /> : <ActTwoText key="a2" />}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : (
            <ActThree key="signoff" />
          )}
        </AnimatePresence>
      </main>

      {/* footer */}
      <footer className="zcs-footer">
        <button onClick={runSequence} className="zcs-replay">
          Replay
        </button>
        <SocialBar />
      </footer>
    </div>
  );
}

const STYLE = `
.zcs{position:relative;min-height:100vh;width:100%;overflow:hidden;background:#08080A;color:#fff;-webkit-font-smoothing:antialiased;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.zcs *{box-sizing:border-box}
.zcs ::selection{background:rgba(236,63,126,.3)}
.zcs a{color:inherit;text-decoration:none}
.zcs-layer{position:absolute;inset:0;z-index:0;pointer-events:none}
.zcs-canvas{position:absolute;inset:0;z-index:0;height:100%;width:100%}
.zcs-cursor{pointer-events:none;position:fixed;left:0;top:0;z-index:10}
.zcs-grain{pointer-events:none;position:absolute;inset:0;z-index:5;opacity:.04;mix-blend-mode:soft-light}
.zcs-vignette{pointer-events:none;position:absolute;inset:0;z-index:6}

.zcs-header{position:absolute;left:0;right:0;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;padding:24px}
@media(min-width:640px){.zcs-header{padding:24px 40px}}
.zcs-brand{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.3em;color:rgba(255,255,255,.7)}
.zcs-nav{display:flex;align-items:center;gap:20px}
.zcs-nav a{font-size:10px;text-transform:uppercase;letter-spacing:.2em;color:rgba(255,255,255,.55);transition:color .3s}
.zcs-nav a:hover{color:#fff}

.zcs-main{position:relative;z-index:20;display:flex;min-height:100vh;flex-direction:column;align-items:center;justify-content:center;padding:0 24px;text-align:center}
.zcs-intro{display:flex;flex-direction:column;align-items:center}
.zcs-markwrap{position:relative}
.zcs-mark{position:relative;display:flex;align-items:center;justify-content:center}
.zcs-mark svg{position:absolute;inset:0;height:100%;width:100%}
.zcs-aura{position:relative}
.zcs-logo{display:block;user-select:none}
.zcs-ring{pointer-events:none;position:absolute;inset:0;border-radius:9999px;border:1px solid rgba(236,63,126,.4)}
.zcs-actbox{margin-top:16px;display:flex;min-height:5rem;align-items:center;justify-content:center}

.zcs-act1{font-size:clamp(2rem,7vw,4.5rem);font-weight:700;letter-spacing:-.02em;color:rgba(255,255,255,.9)}
.zcs-act2{display:flex;max-width:56rem;flex-wrap:wrap;align-items:center;justify-content:center;column-gap:12px;row-gap:4px;font-size:clamp(1.6rem,5vw,3.6rem);font-weight:700;line-height:1.1;letter-spacing:-.02em}
.zcs-act2 .w{color:rgba(255,255,255,.85)}
.zcs-act3{display:flex;flex-direction:column;align-items:center}
.zcs-eyebrow{margin-bottom:16px;font-size:11px;text-transform:uppercase;letter-spacing:.42em;color:rgba(236,63,126,.75)}
.zcs-h1{font-size:clamp(2.1rem,7vw,5rem);font-weight:700;line-height:1.05;letter-spacing:-.02em;color:#fff}
.zcs-br{display:none}
@media(min-width:640px){.zcs-br{display:block}}
.zcs-lede{margin-top:24px;max-width:28rem;font-size:14px;line-height:1.6;color:rgba(255,255,255,.45)}

.zcs-burst{pointer-events:none;position:absolute;left:50%;top:50%;z-index:30;height:0;width:0}

.zcs-footer{position:absolute;bottom:0;left:0;right:0;z-index:40;display:flex;align-items:center;justify-content:space-between;padding:24px}
@media(min-width:640px){.zcs-footer{padding:24px 40px}}
.zcs-replay{font-size:10px;text-transform:uppercase;letter-spacing:.25em;color:rgba(255,255,255,.35);background:none;border:none;cursor:pointer;transition:color .3s;padding:0}
.zcs-replay:hover{color:rgba(255,255,255,.8)}
.zcs-social{display:flex;align-items:center;gap:20px}
.zcs-social a{position:relative;color:rgba(255,255,255,.45);transition:color .3s;transition:transform .3s}
.zcs-social a:hover{color:#fff}
.zcs-social a:hover svg{transform:translateY(-2px)}
.zcs-social svg{transition:transform .3s}

@keyframes zoraBreathe{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.9;transform:scale(1.14)}}
@keyframes zoraShimmer{to{background-position:200% center}}
@keyframes zoraAura{0%,100%{filter:drop-shadow(0 0 8px rgba(236,63,126,.55)) drop-shadow(0 0 26px rgba(247,146,47,.35))}50%{filter:drop-shadow(0 0 20px rgba(236,63,126,.9)) drop-shadow(0 0 52px rgba(196,30,224,.55))}}
.zora-aura{animation:zoraAura 3.6s ease-in-out infinite}
.shimmer-text{background:linear-gradient(90deg,#f7922f,#ec3f7e,#c41ee0,#ec3f7e,#f7922f);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:zoraShimmer 4.5s linear infinite}
@media(prefers-reduced-motion:reduce){.zora-aura,.shimmer-text{animation:none}}
`;

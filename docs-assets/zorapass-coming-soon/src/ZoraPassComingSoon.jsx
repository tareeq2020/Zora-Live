import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
} from "framer-motion";
import { Volume2, VolumeX, Instagram, Twitter } from "lucide-react";

// Real Zora brand asset — the orb + ZORA wordmark
import zoraLogo from "./assets/zora-logo.png";

/* Background track. Drop a LICENSED copy at public/audio/sete.mp3 (served at
   /audio/sete.mp3). Browsers block sound until a user gesture, so playback
   starts when the visitor hits the sound toggle. */
const SONG = { title: "Sete", artist: "K.O feat. Young Stunna & Blxckie", src: "/audio/sete.mp3" };
const VOLUME = 0.6; // target playback volume the fade-in ramps up to

/**
 * ZoraPass — "Coming Soon" cinematic landing experience.
 * Cyberpunk elegance x African nightlife energy, anchored on the real
 * Zora brand mark (magenta -> orange gradient orb + ZORA wordmark).
 *
 * Three-act, self-driving animation timeline:
 *   ACT I   (0.0s – 2.5s)  The Awakening      — logo pulse-in + "Hi, I'm Zora"
 *   ACT II  (2.5s – 6.0s)  The Value Prop     — kinetic stagger to the brand statement
 *   ACT III (6.0s – ...)   The Dissolve       — logo dissolves to dust + waitlist sign-off
 *
 * Drop-in: requires `framer-motion`, `lucide-react`, and Tailwind CSS.
 */

const EASE = [0.16, 1, 0.3, 1]; // expo-out — the luxury motion curve

/* Brand palette — sampled from the Zora orb, plus an electric-violet accent */
const BRAND = {
  magenta: "#c41ee0",
  pink: "#ec3f7e",
  orange: "#f7922f",
  violet: "#a855f7",
};
const SPARKS = [BRAND.orange, BRAND.pink, BRAND.magenta, BRAND.violet];

/* ------------------------------------------------------------------ */
/*  Injected keyframes + helper classes (keeps the component drop-in)  */
/* ------------------------------------------------------------------ */
function StyleTag() {
  return (
    <style>{`
      @keyframes zoraBreathe {
        0%, 100% { opacity: .5;  transform: scale(1); }
        50%      { opacity: .9;  transform: scale(1.14); }
      }
      @keyframes zoraShimmer { to { background-position: 200% center; } }
      @keyframes zoraAura {
        0%, 100% { filter: drop-shadow(0 0 8px rgba(236,63,126,.55)) drop-shadow(0 0 26px rgba(247,146,47,.35)); }
        50%      { filter: drop-shadow(0 0 20px rgba(236,63,126,.9)) drop-shadow(0 0 52px rgba(196,30,224,.55)); }
      }
      .zora-aura { animation: zoraAura 3.6s ease-in-out infinite; }
      .shimmer-text {
        background: linear-gradient(90deg,#f7922f,#ec3f7e,#c41ee0,#ec3f7e,#f7922f);
        background-size: 200% auto;
        -webkit-background-clip: text; background-clip: text;
        color: transparent;
        animation: zoraShimmer 4.5s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .zora-aura, .shimmer-text { animation: none; }
      }
    `}</style>
  );
}

/* ------------------------------------------------------------------ */
/*  The Zora brand mark (real raster assets)                           */
/* ------------------------------------------------------------------ */

/* Small orb chip — brand gradient dot for the nav (matches the orb colours) */
function OrbChip({ size = 22 }) {
  return (
    <span
      aria-label="Zora"
      role="img"
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(45deg, ${BRAND.magenta}, ${BRAND.pink} 55%, ${BRAND.orange})`,
        boxShadow: "0 0 12px rgba(236,63,126,0.5)",
      }}
    />
  );
}

/* Hero treatment: brand orb wrapped in orbiting neon rings + ethereal aura */
function ZoraMark({ size = 210 }) {
  const box = size * 1.5;
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: box, height: box }}
      aria-hidden
    >
      {/* orbiting rings */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 300" fill="none">
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
          opacity="0.7" style={{ transformOrigin: "150px 150px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 26, ease: "linear", repeat: Infinity }}
        />
        <motion.circle
          cx="150" cy="150" r="120"
          stroke={BRAND.violet} strokeWidth="1" strokeDasharray="1 8"
          opacity="0.5" style={{ transformOrigin: "150px 150px" }}
          animate={{ rotate: -360 }}
          transition={{ duration: 34, ease: "linear", repeat: Infinity }}
        />
        <motion.g
          style={{ transformOrigin: "150px 150px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 18, ease: "linear", repeat: Infinity }}
        >
          <circle cx="150" cy="6" r="2.6" fill={BRAND.orange} />
          <circle cx="294" cy="150" r="2" fill={BRAND.pink} />
          <circle cx="150" cy="294" r="1.7" fill={BRAND.violet} />
        </motion.g>
      </svg>

      {/* brand orb — the real Zora logo asset */}
      <div className="zora-aura relative">
        <img
          src={zoraLogo}
          alt="Zora"
          width={size}
          height={size}
          className="block select-none"
          style={{ width: size, height: size }}
          draggable={false}
        />
      </div>
    </div>
  );
}

/* One-shot expanding ring for the logo's "pulse into view" */
function EntranceRing() {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-full border"
      style={{ borderColor: "rgba(236,63,126,0.4)" }}
      initial={{ opacity: 0.7, scale: 0.62 }}
      animate={{ opacity: 0, scale: 1.6 }}
      transition={{ duration: 1.8, ease: EASE, delay: 0.25 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Ambient cursor-following glow orb                                  */
/* ------------------------------------------------------------------ */
function CursorGlow() {
  const mx = useMotionValue(-600);
  const my = useMotionValue(-600);
  const x = useSpring(mx, { stiffness: 55, damping: 22, mass: 0.7 });
  const y = useSpring(my, { stiffness: 55, damping: 22, mass: 0.7 });

  useEffect(() => {
    const move = (e) => {
      mx.set(e.clientX);
      my.set(e.clientY);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [mx, my]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-10"
      style={{ x, y }}
    >
      <div
        className="h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-[110px]"
        style={{
          background:
            "radial-gradient(circle, rgba(236,63,126,0.22), rgba(168,85,247,0.12) 42%, transparent 70%)",
        }}
      />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Canvas ember / dust field — rising festival-light particles       */
/* ------------------------------------------------------------------ */
function ParticleField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let raf;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const particles = [];
    const MAX = 90;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (n) => {
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
        p.vx += (Math.random() - 0.5) * 0.012; // gentle wander
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
    else tick(); // draw a single static frame

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 z-0 h-full w-full"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Fine film grain overlay (cinematic texture)                        */
/* ------------------------------------------------------------------ */
function Grain() {
  const noise =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[5] opacity-[0.04] mix-blend-soft-light"
      style={{ backgroundImage: noise }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Act III — burst of dust the logo dissolves into                    */
/* ------------------------------------------------------------------ */
function DissolveBurst({ show }) {
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
    []
  );

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-0 w-0">
      <AnimatePresence>
        {show &&
          bits.map((b) => (
            <motion.span
              key={b.id}
              className="absolute rounded-full"
              style={{
                width: b.size,
                height: b.size,
                background: b.color,
                boxShadow: `0 0 8px ${b.color}`,
              }}
              initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
              animate={{ x: b.x, y: b.y, opacity: [0, 1, 0], scale: [0, 1, 0.3] }}
              transition={{ duration: 1.7, ease: EASE, delay: b.delay }}
            />
          ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sound toggle (UI mock) with animated visualiser bars               */
/* ------------------------------------------------------------------ */
function SoundToggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="group flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-[10px] font-medium uppercase tracking-[0.2em] text-white/60 backdrop-blur-md transition hover:border-[#ec3f7e]/50 hover:text-white"
      aria-pressed={on}
      aria-label={on ? `Mute ${SONG.title}` : `Play ${SONG.title} by ${SONG.artist}`}
    >
      {on ? (
        <Volume2 className="h-3.5 w-3.5" style={{ color: BRAND.pink }} />
      ) : (
        <VolumeX className="h-3.5 w-3.5" />
      )}
      <span className="flex h-3.5 items-end gap-[2px]">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            className="w-[2px] rounded-full"
            style={{ height: "30%", background: BRAND.pink }}
            animate={
              on
                ? { height: ["30%", "100%", "45%", "85%", "30%"] }
                : { height: "30%" }
            }
            transition={
              on
                ? { duration: 0.9 + i * 0.12, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.3 }
            }
          />
        ))}
      </span>
      {on ? "Sound On" : "Muted"}
    </button>
  );
}

/* Compact "now playing" readout shown while the track is live */
function NowPlaying() {
  return (
    <motion.span
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-white/50 sm:flex"
    >
      <span style={{ color: BRAND.pink }}>♪</span>
      Now playing · {SONG.title} — {SONG.artist}
    </motion.span>
  );
}

/* One-time nudge that points at the sound toggle until it's first used */
function SoundHint() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.35 } }}
      transition={{ duration: 0.6, ease: EASE, delay: 1.4 }}
      className="pointer-events-none absolute right-1 top-full mt-2.5"
    >
      <motion.div
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex items-center gap-1.5 rounded-full border border-[#ec3f7e]/40 bg-[#ec3f7e]/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/85 shadow-[0_0_18px_rgba(236,63,126,0.25)] backdrop-blur-md"
      >
        {/* caret pointing up at the toggle */}
        <span className="absolute -top-1 right-7 h-2 w-2 rotate-45 border-l border-t border-[#ec3f7e]/40 bg-[#170b12]" />
        <span style={{ color: BRAND.pink }}>♪</span>
        Tap for sound
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Social bar                                                         */
/* ------------------------------------------------------------------ */
function TikTok(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M16.5 3c.29 2.06 1.46 3.36 3.5 3.53v2.4c-1.18.11-2.22-.28-3.43-1.01v5.55c0 3.56-2.62 6.03-6.02 6.03A5.53 5.53 0 0 1 5 13.97c0-3.35 3.02-5.86 6.6-5.24v2.62c-.41-.13-.85-.2-1.29-.2-1.55 0-2.68 1-2.68 2.5s1.13 2.55 2.68 2.55c1.6 0 2.7-1.11 2.7-3.02V3h3.49z" />
    </svg>
  );
}

function SocialBar() {
  const links = [
    { Icon: Instagram, label: "Instagram", href: "#" },
    { Icon: TikTok, label: "TikTok", href: "#" },
    { Icon: Twitter, label: "X", href: "#" },
  ];
  return (
    <div className="flex items-center gap-5">
      {links.map(({ Icon, label, href }) => (
        <a
          key={label}
          href={href}
          aria-label={label}
          className="group relative text-white/45 transition-colors duration-300 hover:text-white"
        >
          <span className="absolute -inset-2.5 rounded-full bg-[#ec3f7e]/0 blur-md transition-all duration-300 group-hover:bg-[#ec3f7e]/30" />
          <Icon className="relative h-[18px] w-[18px] transition-transform duration-300 group-hover:-translate-y-0.5" />
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Act text blocks                                                    */
/* ------------------------------------------------------------------ */
function ActOneText() {
  return (
    <motion.p
      initial={{ opacity: 0, y: 14, filter: "blur(14px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -14, filter: "blur(14px)", transition: { duration: 0.5, ease: EASE } }}
      transition={{ duration: 1, ease: EASE, delay: 0.45 }}
      className="text-[clamp(2rem,7vw,4.5rem)] font-bold tracking-tight text-white/90"
    >
      Hi, I&rsquo;m <span className="shimmer-text">Zora</span>
    </motion.p>
  );
}

const VALUE_WORDS = [
  { t: "The" },
  { t: "Operating" },
  { t: "System" },
  { t: "for" },
  { t: "Live", g: true },
  { t: "Experiences", g: true },
  { t: "in" },
  { t: "Africa", g: true },
];

const wordUp = {
  hidden: { opacity: 0, y: 26, filter: "blur(12px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE } },
};

function ActTwoText() {
  return (
    <motion.h1
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.12 } } }}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, filter: "blur(12px)", transition: { duration: 0.5 } }}
      className="flex max-w-4xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[clamp(1.6rem,5vw,3.6rem)] font-bold leading-[1.1] tracking-tight"
    >
      {VALUE_WORDS.map((w, i) => (
        <motion.span key={i} variants={wordUp} className={w.g ? "shimmer-text" : "text-white/85"}>
          {w.t}
        </motion.span>
      ))}
    </motion.h1>
  );
}

function ActThree() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, ease: EASE, delay: 0.35 }}
      className="flex flex-col items-center"
    >
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.5 }}
        className="mb-4 text-[11px] uppercase tracking-[0.42em]"
        style={{ color: "rgba(236,63,126,0.75)" }}
      >
        Launching Soon
      </motion.p>

      <motion.h1
        initial={{ opacity: 0, y: 16, filter: "blur(12px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 1, ease: EASE, delay: 0.6 }}
        className="text-[clamp(2.1rem,7vw,5rem)] font-bold leading-[1.05] tracking-tight text-white"
      >
        We are going <span className="shimmer-text">Live Soon</span>.
        <br className="hidden sm:block" /> See ya!
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
        className="mt-6 max-w-md text-sm leading-relaxed text-white/45"
      >
        The operating system powering Africa&rsquo;s live experiences is almost
        here. Turn the sound up and follow along.
      </motion.p>
    </motion.div>
  );
}

/* ================================================================== */
/*  MAIN                                                               */
/* ================================================================== */
export default function ZoraPassComingSoon() {
  const [act, setAct] = useState(1);
  const [soundOn, setSoundOn] = useState(false);
  const [hintSeen, setHintSeen] = useState(false);
  const timers = useRef([]);
  const audioRef = useRef(null);
  const fadeRef = useRef(null);

  // Smoothly ramp audio volume; pauses the element once a fade-out reaches 0.
  const fadeTo = useCallback((target, ms) => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(fadeRef.current);
    const from = a.volume;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      a.volume = Math.max(0, Math.min(1, from + (target - from) * p));
      if (p < 1) fadeRef.current = requestAnimationFrame(tick);
      else if (target === 0) a.pause();
    };
    fadeRef.current = requestAnimationFrame(tick);
  }, []);

  const toggleSound = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setHintSeen(true); // first sound interaction dismisses the hint
    if (a.paused) {
      a.volume = 0;
      a.play()
        .then(() => {
          setSoundOn(true);
          fadeTo(VOLUME, 1800); // gentle fade-in
        })
        .catch(() => setSoundOn(false));
    } else {
      setSoundOn(false);
      fadeTo(0, 500); // quick fade-out, then pause
    }
  }, [fadeTo]);

  const runSequence = useCallback(() => {
    timers.current.forEach(clearTimeout);
    setAct(1);
    timers.current = [
      setTimeout(() => setAct(2), 2500), // ACT II
      setTimeout(() => setAct(3), 6000), // ACT III
    ];
  }, []);

  useEffect(() => {
    runSequence();
    return () => timers.current.forEach(clearTimeout);
  }, [runSequence]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#08080A] text-white antialiased selection:bg-[#ec3f7e]/30">
      <StyleTag />

      {/* looping background track — controlled by the sound toggle */}
      <audio ref={audioRef} src={SONG.src} loop preload="auto" />


      {/* breathing radial glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(236,63,126,0.10), transparent 55%)",
          animation: "zoraBreathe 8s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 72% 78%, rgba(168,85,247,0.09), transparent 50%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 22% 20%, rgba(247,146,47,0.06), transparent 45%)",
        }}
      />

      <ParticleField />
      <CursorGlow />
      <Grain />

      {/* cinematic vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[6]"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, transparent 52%, rgba(0,0,0,0.72))",
        }}
      />

      {/* top bar */}
      <header className="absolute left-0 right-0 top-0 z-40 flex items-center justify-between px-6 py-6 sm:px-10">
        <span className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70">
          <OrbChip size={22} />
          Zora<span style={{ color: BRAND.pink }}>Pass</span>
        </span>
        <div className="relative flex items-center gap-3">
          <AnimatePresence>{soundOn && <NowPlaying key="np" />}</AnimatePresence>
          <SoundToggle on={soundOn} onToggle={toggleSound} />
          <AnimatePresence>
            {!hintSeen && !soundOn && <SoundHint key="hint" />}
          </AnimatePresence>
        </div>
      </header>

      {/* center stage */}
      <main className="relative z-20 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <DissolveBurst show={act === 3} />

        <AnimatePresence mode="wait">
          {act < 3 ? (
            <motion.div
              key="intro"
              className="flex flex-col items-center"
              exit={{
                opacity: 0,
                scale: 0.7,
                filter: "blur(16px)",
                transition: { duration: 0.9, ease: EASE },
              }}
            >
              <motion.div
                className="relative"
                initial={{ opacity: 0, scale: 0.5, filter: "blur(10px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                transition={{ duration: 1.4, ease: EASE }}
              >
                <EntranceRing />
                <ZoraMark />
              </motion.div>

              <div className="mt-4 flex min-h-[5rem] items-center justify-center">
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
      <footer className="absolute bottom-0 left-0 right-0 z-40 flex items-center justify-between px-6 py-6 sm:px-10">
        <button
          onClick={runSequence}
          className="text-[10px] uppercase tracking-[0.25em] text-white/35 transition-colors duration-300 hover:text-white/80"
        >
          Replay
        </button>
        <SocialBar />
      </footer>
    </div>
  );
}

// seatmap/useMapTransform.ts
// The gesture + transform engine. All maths run on the UI thread (worklets) so
// pinch/pan stay at 60fps even on low-end Android. React never re-renders on a
// gesture frame — only the shared values (scale, tx, ty) change.
import { Gesture } from 'react-native-gesture-handler';
import {
  useSharedValue, withTiming, runOnJS, Easing,
  type SharedValue,
} from 'react-native-reanimated';

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(Math.max(v, lo), hi);
};

export interface TransformConfig {
  viewportW: number;
  viewportH: number;
  contentW: number;          // fitted map size at scale = 1
  contentH: number;
  minScale?: number;         // default 1 (fit-to-width)
  maxScale?: number;         // default 6
  /** Fires on a clean single tap, already inverse-transformed into fitted-content space. */
  onTapMap: (mx: number, my: number) => void;
}

export interface MapTransform {
  gesture: ReturnType<typeof Gesture.Race>;
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
}

export function useMapTransform(cfg: TransformConfig): MapTransform {
  const MIN = cfg.minScale ?? 1;
  const MAX = cfg.maxScale ?? 6;

  const scale = useSharedValue(MIN);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(MIN);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);

  // Keep the map pinned inside the viewport (or centered when it is smaller than the viewport).
  const clampTranslation = () => {
    'worklet';
    const scaledW = cfg.contentW * scale.value;
    const scaledH = cfg.contentH * scale.value;
    const loX = Math.min(0, cfg.viewportW - scaledW);
    const hiX = Math.max(0, cfg.viewportW - scaledW);
    const loY = Math.min(0, cfg.viewportH - scaledH);
    const hiY = Math.max(0, cfg.viewportH - scaledH);
    tx.value = clamp(tx.value, loX, hiX);
    ty.value = clamp(ty.value, loY, hiY);
  };

  // ── PAN (one finger only). Two-finger drag is handled by the pinch focal below,
  //    so pan and pinch never fight over tx/ty on the same frame. ──────────────
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => { startTx.value = tx.value; startTy.value = ty.value; })
    .onUpdate(e => {
      tx.value = startTx.value + e.translationX;
      ty.value = startTy.value + e.translationY;
    })
    .onEnd(() => { clampTranslation(); });

  // ── PINCH (focal-aware). Screen = t + s·map  ⇒  to keep the point under the
  //    fingers fixed while scaling by `ratio`:   t' = focal − (focal − t)·ratio ──
  const pinch = Gesture.Pinch()
    .onStart(() => { startScale.value = scale.value; startTx.value = tx.value; startTy.value = ty.value; })
    .onUpdate(e => {
      const next = clamp(startScale.value * e.scale, MIN, MAX);
      const ratio = next / startScale.value;
      scale.value = next;
      tx.value = e.focalX - (e.focalX - startTx.value) * ratio;   // focal drift also pans (2-finger drag)
      ty.value = e.focalY - (e.focalY - startTy.value) * ratio;
    })
    .onEnd(() => { clampTranslation(); });

  // ── DOUBLE-TAP: toggle fit ⇄ 2.5×, zooming toward the tapped point ──────────
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(e => {
      const opts = { duration: 220, easing: Easing.out(Easing.cubic) };
      if (scale.value > MIN + 0.01) {
        scale.value = withTiming(MIN, opts);
        tx.value = withTiming(0, opts);
        ty.value = withTiming(0, opts);
      } else {
        const target = Math.min(MAX, 2.5);
        const ratio = target / scale.value;
        scale.value = withTiming(target, opts);
        tx.value = withTiming(e.x - (e.x - tx.value) * ratio, opts);
        ty.value = withTiming(e.y - (e.y - ty.value) * ratio, opts);
      }
    });

  // ── SINGLE-TAP: invert the transform to hit-test a seat.  map = (screen − t) / s ──
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd(e => {
      const mx = (e.x - tx.value) / scale.value;
      const my = (e.y - ty.value) / scale.value;
      runOnJS(cfg.onTapMap)(mx, my);
    });

  const gesture = Gesture.Race(
    Gesture.Simultaneous(pan, pinch),
    Gesture.Exclusive(doubleTap, singleTap),   // single waits for the double-tap window
  );

  return { gesture, scale, tx, ty };
}

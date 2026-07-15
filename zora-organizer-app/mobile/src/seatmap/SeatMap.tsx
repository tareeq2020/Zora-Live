// Interactive stadium floor plan: pinch-to-zoom, pan, double-tap, tap-to-select.
// Renderer: react-native-svg (good to ~1,500 nodes). For bigger bowls swap in a
// Skia canvas — the gesture engine (useMapTransform) is identical.
import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import Svg, { Rect, Circle, Text as SvgText, G } from 'react-native-svg';
import { useMapTransform } from './useMapTransform';
import type { FloorPlan, Seat, SeatStatus } from './types';
import { useZ } from '../theme';

interface Props {
  plan: FloorPlan;
  viewport: { width: number; height: number };
  onSelect: (seat: Seat) => void;
  maxScale?: number;
}

export default function SeatMap({ plan, viewport, onSelect, maxScale = 6 }: Props) {
  const z = useZ();
  const COLOR: Record<SeatStatus, { fill: string; stroke: string; text: string }> = {
    available: { fill: 'rgba(61,90,254,0.18)', stroke: z.ultra, text: z.bone },
    held: { fill: 'rgba(233,168,59,0.20)', stroke: z.amber, text: z.mut },
    sold: { fill: '#2a2a30', stroke: '#2a2a30', text: '#6a6a72' },
    selected: { fill: z.orange, stroke: z.orange, text: '#0A0A0B' },
  };

  // Fit the intrinsic map to the viewport width; that fitted size is "scale = 1".
  const fit = viewport.width / plan.width;
  const contentW = plan.width * fit;
  const contentH = plan.height * fit;

  // Hit-test runs on the JS thread. Inputs are in fitted-content space; divide by
  // `fit` to compare against intrinsic seat coordinates.
  const hitTest = useCallback(
    (mx: number, my: number) => {
      const ix = mx / fit;
      const iy = my / fit;
      let best: Seat | null = null;
      let bestD = Infinity;
      for (const s of plan.seats) {
        if (s.status === 'sold') continue;
        const d = (s.x - ix) ** 2 + (s.y - iy) ** 2;
        const touchable = (s.r + 6) ** 2; // fat-finger forgiveness
        if (d <= touchable && d < bestD) { best = s; bestD = d; }
      }
      if (best) onSelect(best);
    },
    [plan.seats, fit, onSelect],
  );

  const { gesture, scale, tx, ty } = useMapTransform({
    viewportW: viewport.width, viewportH: viewport.height,
    contentW, contentH, minScale: 1, maxScale, onTapMap: hitTest,
  });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // Seats memoised on status only → render ONCE, never on gesture frames.
  const seatNodes = useMemo(
    () => plan.seats.map((s) => {
      const c = COLOR[s.status];
      return (
        <G key={s.id}>
          <Circle cx={s.x} cy={s.y} r={s.r} fill={c.fill} stroke={c.stroke} strokeWidth={1.4} />
          {s.kind === 'table' && s.label ? (
            <SvgText x={s.x} y={s.y + 3} fontSize={s.r * 0.62} fontWeight="700" fill={c.text} textAnchor="middle">
              {s.label}
            </SvgText>
          ) : null}
        </G>
      );
    }),
    [plan.seats, z],
  );

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width: viewport.width, height: viewport.height, overflow: 'hidden', backgroundColor: z.panel, borderRadius: z.r }}>
        {/* transformOrigin '0 0' scales from top-left, matching screen = t + s·point. Needs RN >= 0.74. */}
        <Animated.View style={[{ width: contentW, height: contentH, transformOrigin: '0% 0%' }, animStyle]}>
          <Svg width={contentW} height={contentH} viewBox={`0 0 ${plan.width} ${plan.height}`}>
            {plan.stage && (
              <G>
                <Rect x={plan.stage.x} y={plan.stage.y} width={plan.stage.w} height={plan.stage.h} rx={4} fill="#1B1B20" stroke={z.orange} strokeWidth={1.5} />
                <SvgText x={plan.stage.x + plan.stage.w / 2} y={plan.stage.y + plan.stage.h / 2 + 4} fontSize={11} fontWeight="700" fill={z.orangeSoft} textAnchor="middle" letterSpacing={3}>
                  {plan.stageLabel ?? 'STAGE'}
                </SvgText>
              </G>
            )}
            {seatNodes}
          </Svg>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

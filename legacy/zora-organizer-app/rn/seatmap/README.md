# SeatMap — interactive stadium floor plan (React Native)

Pinch-to-zoom, pan, double-tap-to-zoom, and tap-to-select on a vector floor plan.
All gesture maths run on the UI thread (Reanimated worklets), so it stays at 60fps
on low-end Android — which matters for the East-Africa market.

## Files
- `types.ts` — `Seat` / `FloorPlan` data model.
- `useMapTransform.ts` — the gesture + transform engine (focal pinch, clamp, tap inversion).
- `SeatMap.tsx` — the `react-native-svg` renderer (good to ~1,500 nodes).

## Install
```bash
npx expo install react-native-gesture-handler react-native-reanimated react-native-svg
# Large venues (5k+ seats) — GPU renderer, see below:
npx expo install @shopify/react-native-skia
```
Wiring (once):
1. Add the Reanimated Babel plugin **last** in `babel.config.js`: `plugins: ['react-native-reanimated/plugin']`.
2. Wrap the app root in `<GestureHandlerRootView style={{flex:1}}>`.
3. `transformOrigin` needs **RN ≥ 0.74** (Expo SDK 51+). On older RN, bake the origin with a translate instead.

## The three things people get wrong (and how this handles them)

**1. Focal pinch — zoom toward the fingers, not the center.**
The transform is `screen = translate + scale · mapPoint`. To keep the point under the
fingers pinned while scaling by `ratio`:
```
t' = focal − (focal − t) · ratio
```
That one line (in `useMapTransform` `pinch.onUpdate`) is the difference between a map that
zooms naturally and one that lurches away from your fingers.

**2. Pan vs pinch conflict.** Pan is restricted to `maxPointers(1)`; two-finger drag is
handled by the pinch focal drifting. So the two gestures never write `tx/ty` on the same
frame — no jitter.

**3. Tap hit-testing across coordinate spaces.** A tap arrives in *screen* space. Invert the
transform to get map space, then divide by the fit ratio to reach intrinsic seat coords:
```
mapX = (screenX − tx) / scale        // → fitted-content space
seatX = mapX / fit                   // → intrinsic units, compare to seat.x
```
Nearest seat within `r + 6` wins (fat-finger forgiveness). Sold seats are skipped.

## Usage + live availability
```tsx
import SeatMap from './seatmap/SeatMap';
import { useRealtime } from '../useRealtime';        // the WS hook from the architecture step
import type { FloorPlan, Seat, SeatStatus } from './seatmap/types';

function TableBookingScreen({ eventId, plan0 }: { eventId: string; plan0: FloorPlan }) {
  const [plan, setPlan] = useState(plan0);
  const [selected, setSelected] = useState<Seat | null>(null);
  const { width } = useWindowDimensions();

  // Someone else's hold/purchase repaints instantly — no refetch.
  useRealtime(`wss://gate.zora.app/events/${eventId}/seats`, (m: { id: string; status: SeatStatus }) =>
    setPlan(p => ({ ...p, seats: p.seats.map(s => s.id === m.id ? { ...s, status: m.status } : s) })));

  const onSelect = (seat: Seat) => {
    if (seat.status !== 'available') return;
    setSelected(seat);
    setPlan(p => ({ ...p, seats: p.seats.map(s =>
      s.id === seat.id           ? { ...s, status: 'selected' } :
      s.status === 'selected'    ? { ...s, status: 'available' } : s) }));
    gate.hold(eventId, seat.id);      // optimistic; server confirms + broadcasts 'held' to everyone
  };

  return (
    <>
      <SeatMap plan={plan} viewport={{ width: width - 40, height: 360 }} onSelect={onSelect} />
      {selected && (
        <SelectedBar
          title={`Table ${selected.label}`}
          detail={`${selected.capacity} seats · TZS ${(selected.price / 100).toLocaleString()}`}
          onContinue={() => openSplitWithCrew(selected)}   // → the split-payment sheet
        />
      )}
    </>
  );
}
```

## Big-venue renderer (Skia) — swap when seat count > ~1,500
Same `useMapTransform`; only the drawing surface changes. Skia paints every seat in one
GPU canvas, so 10,000 seats still scroll at 60fps.
```tsx
import { Canvas, Group, Circle } from '@shopify/react-native-skia';

<Canvas style={{ width: vp.width, height: vp.height }}>
  {/* Group accepts the shared values directly — no React re-render per frame */}
  <Group transform={[{ translateX: tx }, { translateY: ty }, { scale }]}>
    {plan.seats.map(s => (
      <Circle key={s.id} cx={s.x * fit} cy={s.y * fit} r={s.r * fit} color={colorFor(s.status)} />
    ))}
  </Group>
</Canvas>
```
Hit-testing is identical (inverse transform). Use SVG for VIP tables / small sections (crisp
text, few nodes); use Skia for full GA bowls.

## Not run here
These files were written against the specs but not executed — there is no Expo project yet.
The transform maths (the risky part) are documented above so they can be reviewed; the next
step is scaffolding the Expo app and mounting `SeatMap` in the consumer booking flow.

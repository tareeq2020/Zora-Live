# ZORA — unified mobile app (Expo / React Native)

One app, role-based routing: **Consumer marketplace ⇄ Organizer dashboard**, plus a
**locked Staff scanner**. The interactive pinch-zoom **seat map** is wired into the
consumer booking flow.

## Run it
```bash
cd mobile
npm install
npx expo install --fix     # aligns native dep versions to the installed Expo SDK
npx expo start -c          # -c clears the Metro cache (needed after adding reanimated)
```
Then:
- **Phone:** install **Expo Go**, scan the QR (phone + PC on the same Wi-Fi).
- **Android emulator:** press `a`  ·  **iOS simulator (macOS):** press `i`.

## Try the flows
1. **RolePicker** → **Fan** → Home feed → tap **OFFSHORE** → **seat map**: pinch to zoom, double-tap to fit, drag to pan, tap a table → *Split with crew*.
2. **Profile → Switch to Organizer** → fades to Dashboard / Wallet / People / Audit / **Settings**. Settings → *Switch to Consumer* to go back.
3. **RolePicker → Gate agent** → locked scanner. No tabs, no toggle — only *Sign out*.

## Architecture (where to look)
```
App.tsx                         GestureHandlerRootView + SafeAreaProvider
src/session/store.ts            role + activeMode (Zustand). toggleMode() has the staff hard-lock.
src/navigation/RootNavigator    the gate: one NavigationContainer, screen set swaps by (role, activeMode), animation:'fade'
src/navigation/ConsumerTabs     Home(stack: Home→Booking) · Tickets · Profile
src/navigation/OrganizerTabs    Dashboard · Wallet · People · Audit · Settings
src/screens/staff/ScannerScreen the only screen a staff session can reach
src/seatmap/                    useMapTransform (gestures) + SeatMap (renderer) + types
src/data/floorPlan.ts           sample VIP-table plan
```

**Why staff is genuinely locked:** `RootNavigator` never *registers* the consumer/organizer
screens for a staff session, so those routes don't exist — a deep link to them is inert.
Enforce it server-side too (JWT scopes the API): client lock = UX, server = truth.

## Not run in this environment
These files were authored to spec but **not built or executed here** (no emulator/SDK in the
authoring environment). Version pins in `package.json` are best-effort — `npx expo install --fix`
reconciles them. If TypeScript flags `transformOrigin`, it needs **RN ≥ 0.74** (Expo SDK 51+).

## Intentionally stubbed (next installs)
| Feature | Now | Production |
|---|---|---|
| Split-with-crew | button stub | `expo-contacts` picker → Gate payment intents |
| Scanner camera | mock viewfinder | `expo-camera` BarCodeScanner vs offline manifest |
| Big-venue seat map | react-native-svg | `@shopify/react-native-skia` for 1,500+ seats |
| Feed covers | solid tints | `expo-image` / video thumbs |
| Display font | system | `@expo-google-fonts/anton` + `expo-font` |
| Live data | seeded + WS hook | real `wss://gate.zora.app` streams |

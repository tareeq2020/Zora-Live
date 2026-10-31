# ZoraPass brand direction — the product version

Everything here is the short, build-relevant version of **ZORAPASS — Brand Direction (Final)** (https://claude.ai/code/artifact/62bc2691-3c98-4c88-b9a1-c7db7ee7726b).

## 1. Positioning

| | |
|---|---|
| The brand | ZORAPASS |
| The category | Ticketing + live entertainment |
| The line | **Your pass to what's on.** |
| The journey | DISCOVER → CHOOSE → BUY → EXPERIENCE |
| Who it's for | One person, two, a few friends, a group, a large squad. The product works the same for all of them. |

The consumer idea, in four beats: **There's something happening. Find it. Get your pass. Go.**

What ZoraPass is not: a squad-ticketing app, a social network, a nightlife blog, or The Brunch City's ticketing arm.

## 2. Language hierarchy

The product UI only ever uses levels 1–3. Level 4 is marketing.

**Level 1 — masterbrand:** ZORAPASS. The logo, and nothing else.

**Level 2 — category:** ticketing + live entertainment. "Your pass to what's on." Homepage hero, app first-run, about, meta descriptions, app store copy.

**Level 3 — everyday product language.** This is the vocabulary of the whole interface:

| Moment | Words |
|---|---|
| Discovery | WHAT'S ON? · THIS WEEKEND · THIS WEEK IN DAR · NEW ON ZORAPASS · ZORA PICK |
| Selling | GET PASSES · ON SALE · EARLY BIRD · FEW LEFT · ALMOST GONE · SOLD OUT · JOIN THE WAITLIST |
| Purchase | YOU'RE IN. (ZoraPass to the buyer) |
| Sharing | WE'RE IN. (what the buyer says to their people) |
| Event day | SEE YOU INSIDE. · DOORS OPEN · CHECKED IN |
| Groups | ONE PASS OR MANY · ME · ME +1 · ME +3 · THE CREW · SPLIT WITH TUCHANGE |
| Organizers | SELL OUT YOUR NEXT EVENT · GET PAID · CHECK PEOPLE IN · KNOW YOUR CROWD |

**Level 4 — campaign language:** ADMIT US. · TUKO WANGAPI? · WE'RE IN. as a campaign headline.

> **Rule for engineers:** no campaign line ever ships in the product. No ADMIT US. on a button, an empty state, a push notification, an email template, a loading screen or an app icon. If a campaign is running, marketing handles it in their own channels.

## 3. The stamp

The stamp is the ZoraPass mark of **access, status and authentication**. It is a circle with the ZoraPass Z in the middle and ring text around it.

- **Default state: ZORAPASS.** Use it on brand moments, confirmations, passes and the app's authentication beat.
- **Status states are only used when true**: NOW ON ZORAPASS, JUST ANNOUNCED, ON SALE, LIMITED, FEW LEFT, ALMOST GONE, SOLD OUT, WAITLIST, WE'RE IN, CHECKED IN, LIVE NOW, NEXT UP, ZORA PICK, VERIFIED EVENT, TICKETS ON ZORAPASS, POWERED BY ZORAPASS.
- **ADMIT US** is a campaign state. It is in the folder `06_ASSETS/stamps-campaign-only` and does not ship in the product.
- The city sits in the ring text: DAR, ZNZ, ARK, NBO, KLA, KGL, LOS, ACC, JNB.
- In dense UI (lists, cards, tables) use a **status chip**, not a stamp. The stamp is for moments: hero, confirmation, pass, check-in, empty states.

## 4. Groups, handled correctly

The group feature is a product advantage: one buyer, one checkout, many passes, and Tuchange to split the cost.

- Offer it where it is useful: quantity selection, checkout, invites, the pass.
- Never gate the flow behind it. A single buyer must be able to buy one pass without seeing group language.
- The words are plain: "How many passes?", "Split with Tuchange", "Me +3", "The crew".
- Don't label users a "squad" in the interface.

## 5. Tone of voice

- Short sentences. Say the thing.
- Display type is loud and caps (Bungee). Body copy is calm sentence case.
- Speak like someone who goes out, not like a payments company. No "seamless", "revolutionary", "solution", "leverage".
- Swahili is used naturally where it belongs (Tuchange is the feature name), never as decoration or fake slang.
- Never oversell scarcity. FEW LEFT means under 20% left. ALMOST GONE means under 10%. SOLD OUT means zero.

## 6. What the brand must survive (the design test)

The interface has to feel like ZoraPass when the only words on screen are ZORAPASS, THIS WEEKEND, 25 OCTOBER or SOLD OUT. That means the recognition has to come from the logo, the type, the yellow, the stamp, the grid and the photography — not from a slogan.

It also has to work for: one cinema ticket, one concert ticket, two tickets for a date night, four for a birthday, ten for a festival, a VIP pass, a corporate booking and a major African festival. If a screen only makes sense for groups, that screen is wrong.

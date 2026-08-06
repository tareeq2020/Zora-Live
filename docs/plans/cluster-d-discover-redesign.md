# Plan — Cluster D: Discover redesign (#8)

Design-led. Restyle `/discover` to the **home page's** ethos while keeping its function as the event-discovery / marketplace listing.

**Today.** `/discover` (`discover-app.tsx`) is a marketing/marketplace page with its own (older) look. The apex home (`/placeholder` → `coming-soon.tsx`, BS27) is the new brand aesthetic: fixed dark canvas `#08080A`, Space Grotesk display, the magenta→orange **Zora orb**, orbiting rings, ember/particle canvas, cursor glow, film grain, shimmer gradient text, IBM Plex Mono labels.

**Goal.** Discover should feel like it belongs to the same brand as the home page — same dark cinematic language — while doing its job: browse/search live events, land into an event/storefront.

**Scope (design).**
- Adopt the home's tokens: dark canvas, Space Grotesk/Inter/IBM Plex Mono, orb mark, shimmer accents, restrained motion (respect `prefers-reduced-motion`). Keep the aura/particle treatment tasteful behind content (not a full teaser takeover — it stays a functional listing).
- Restyle: hero/search, city/category filters, the event grid/cards, the "launch your storefront" organizer CTA, footer.
- **Responsive** (mobile-first grid).
- Reuse existing data/routes — no data-model change; this is a re-skin + layout pass.

**Function preserved.** Search, filters, event cards → event/storefront links, organizer CTA all keep working; only the visual system changes.

**Process.** Likely a `/design-consultation` or `/plan-design-review` pass first (mockups) before implementation, since it's a visual redesign of a real page — same approach as the storefront rebrand. The scanner UI (#1) and the ported admin look (#9) can ride the same design language review.

**Open decisions for design review:** (a) how much motion on a content page (particles/orb subtle vs prominent); (b) card treatment (cover-forward vs text-forward); (c) does discover keep the marketing sections or become a lean listing; (d) light/dark — consumer surfaces are fixed-dark, so discover goes dark to match home.

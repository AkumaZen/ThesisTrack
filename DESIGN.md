---
name: Investment Thesis Platform
description: A kill-switch console for disciplined, falsifiable equity theses
colors:
  void-black: "#050505"
  true-black: "#000000"
  panel-graphite: "#121212"
  deep-graphite: "#0a0a0a"
  hover-graphite: "#1a1a1a"
  hairline-grey: "#333333"
  console-white: "#f0f0f0"
  instrument-grey: "#888888"
  pure-white: "#ffffff"
  signal-lime: "#ccff00"
  console-cyan: "#00f0ff"
  kill-red: "#ff003c"
  warning-amber: "#ffaa00"
typography:
  display:
    fontFamily: "JetBrains Mono, Consolas, monospace"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "Space Grotesk, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "Space Grotesk, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Space Grotesk, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Space Grotesk, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.void-black}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.void-black}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.console-white}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.hover-graphite}"
    textColor: "{colors.console-white}"
  button-danger:
    backgroundColor: "{colors.kill-red}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.panel-graphite}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.deep-graphite}"
    textColor: "{colors.console-white}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
---

# Design System: Investment Thesis Platform

## Overview

**Creative North Star: "The Kill-Switch Console"**

This is instrumentation for a decision that costs real money if it's wrong. The console metaphor comes from the product's own defining mechanism, kill triggers: pre-committed, quantified conditions that invalidate a thesis before the analyst gets emotionally invested in being right. The interface should feel like it belongs to that discipline - built for someone who has already decided that clarity beats comfort.

But the execution stays quiet, not loud. This is not a garish trading-floor wall of blinking tickers. It's near-black and mostly silent, with exactly one accent color (Signal Lime) reserved for the things that actually matter: primary commit actions, on-track status, the thing you must not miss. Everything else recedes into graphite and grey so that when color appears, it means something. Numbers and keys render in a distinct monospaced voice, because in this product a number is evidence, not decoration - it should look like it came from an instrument, not from prose.

The palette and every accent are shared, unchanged, between a near-black default theme and a white-ground light theme (`prefers-color-scheme`, with a manual override toggle) - only the ground and text tokens swap. A screen that only works in one theme is a bug, not a variant.

**Key Characteristics:**
- Near-black ground by default, white-ground light theme with the exact same accents - never redesign per theme, only re-ground it.
- One accent (Signal Lime) carries primary action and "good" status; three siblings (Cyan, Red, Amber) are reserved for secondary/info, danger, and warning respectively - never freelanced for decoration.
- Flat at rest; shadow is reserved for things that float above the page.
- Numbers, keys, and code are always monospaced (JetBrains Mono), regardless of size - prose is always Space Grotesk. This split is a hierarchy in itself, not just a font choice.
- Refined and quiet in execution: rectangular controls, no gradients, generous quiet space, restraint over spectacle - the console is disciplined, not aggressive.

## Colors

Near-black and near-white grounds, four accent hues used sparingly and consistently by meaning, never by decoration.

### Primary
- **Signal Lime** (`#ccff00`): The one color that means "commit" or "on track." Primary CTA fills (with Void Black text, never white - lime is too bright for white text to sit comfortably on it), the on-track status dot and pill, "good" data in stat tiles. Used on a small minority of any given screen; its rarity is what makes it legible as "the important one."

### Secondary
- **Console Cyan** (`#00f0ff`): The instrument-panel accent - links, "info/manual" source badges, the "ok" semantic tier. Reads as a secondary readout next to Signal Lime's primary signal.

### Tertiary
- **Kill Red** (`#ff003c`): Danger and the "broken"/fired-kill-trigger state. The only accent paired with white text rather than dark ink (it's dark-saturated enough for white to sit on comfortably); everywhere else, text on an accent fill is Void Black.
- **Warning Amber** (`#ffaa00`): Watch-closely status, warnings, review-due flags. Sits between Lime's "fine" and Red's "stop."

### Neutral
- **Void Black** (`#050505`) / light: **Paper White** (`#ffffff`): Page background.
- **True Black** (`#000000`) / light: **Paper White** (`#ffffff`): Modal, drawer, and header/nav fill - deliberately distinct from card fill so floating and structural surfaces read differently from content cards even though both are "dark."
- **Panel Graphite** (`#121212`) / light: **Paper White** (`#ffffff`, bordered): Card and panel fill - company cards, stat tiles, the facet bar, review-queue and guidance-tracker rows.
- **Deep Graphite** (`#0a0a0a`) / light: **Soft Paper** (`#f7f7f7`): Nested panel fill - form inputs, the export-stats box inside its modal.
- **Hover Graphite** (`#1a1a1a`) / light: **Hover Paper** (`#eeeeee`): Row/button hover state, and doubles as the neutral badge background for non-semantic tags.
- **Hairline Grey** (`#333333`) / light: **Paper Hairline** (`#d8d8d8`): All borders and dividers - the only border color in the system.
- **Console White** (`#f0f0f0`) / light: **Ink Black** (`#0a0a0a`): Primary text.
- **Instrument Grey** (`#888888`) / light: **Instrument Grey** (`#5c5c5c`): Secondary/muted text - labels, timestamps, placeholder-weight copy.
- **Pure White** (`#ffffff`): Max-contrast text on a Kill Red fill. Identical value in both themes; it is not the same token as the page's neutral background even where they coincide.

### Named Rules
**The One Signal Rule.** Signal Lime is the only color that ever means "primary action" or "this is good." If a screen has more than one lime element competing for attention, something is wrong - dilute to Cyan, Amber, or plain Graphite instead of adding a second hero color.

**The Dark-Ink Pairing Rule.** Text on any bright accent fill (Lime, Cyan, Amber) is Void Black, never white - these accents are too bright for white to sit on comfortably. Kill Red is the sole exception: it's dark-saturated enough that white text works, and is used for the one truly urgent, alarm-toned action (Reject, error toasts).

## Typography

**Body Font:** Space Grotesk (with Segoe UI, sans-serif fallback)
**Label/Mono Font:** JetBrains Mono (with Consolas, monospace fallback)

**Character:** Space Grotesk carries every word a human wrote - headings, labels, descriptions, buttons. JetBrains Mono carries every value a human should trust as data - metrics, counts, JSON, code. The split is deliberate and total: it is never used for decoration, only for "this is measured, not written."

### Hierarchy
- **Display** (600, 1.5rem/24px, JetBrains Mono): The large stat-tile numbers on the dashboard header (Total Tracked, On Track, etc.) - deliberately mono even at display size, because they are counts, not headlines.
- **Headline** (600, 1.25rem/20px, Space Grotesk): Drawer and modal titles - a company name, "New Data Table."
- **Title** (600, 1.125rem/18px, Space Grotesk): Page-level heading (the app header), modal section headers.
- **Body** (400, 0.875rem/14px, Space Grotesk): The default UI voice - buttons, form labels, descriptions, list content. The overwhelming majority of text in the product.
- **Label** (700, 0.75rem/12px, Space Grotesk, 0.05em tracking, uppercase): Section eyebrows ("THE BUSINESS," "DATA TABLES"), muted metadata captions.

### Named Rules
**The Data Voice Rule.** Any number, key, code snippet, or machine-shaped value renders in JetBrains Mono, at whatever size the context calls for - a 24px stat count and a 12px table cell are both mono. Any word a human composed renders in Space Grotesk. Never mix the two within a single value.

## Layout

Dense, utility-first dashboard layout, not an editorial page: a `max-w-7xl` centered container, cards arranged in a responsive grid (1/2/3 columns by breakpoint), and a fixed-width right-hand drawer (520px) for record detail rather than route navigation. Vertical rhythm is tight and consistent - card padding is 16-20px, gaps between sibling cards are 12-16px - because the product rewards scanning many companies at once over lingering on one. Modals are capped at `max-w-2xl` and internally scroll rather than growing the viewport; wide content (the custom-table grid) scrolls horizontally inside its own bordered container rather than breaking the modal width.

## Elevation & Depth

Flat by default, with a hairline border doing the separation work that a shadow would do elsewhere. Depth exists only for things that genuinely float above the page content: the modal panel, the detail drawer, and the login card. Everything else - cards, tiles, panels, badges - sits at the same visual plane as its neighbors, distinguished by fill color and a 1px border, never a shadow.

### Shadow Vocabulary
- **Overlay** (`shadow-xl`): The modal panel, the detail drawer, and the login card. Signals "this is temporarily on top of the page," never "this is a nicer card."

### Named Rules
**The Flat-At-Rest Rule.** No card, tile, badge, or button carries a shadow at rest or on hover. Shadow exists solely to mark a surface as floating above the page (modal, drawer, login card) - if it isn't an overlay, it doesn't get one.

## Shapes

Rectangular and restrained. Buttons, inputs, and small controls use a 6px radius (`rounded-md`) - present but not soft. Cards, tiles, and panels step up to 8px (`rounded-lg`). Modals, the drawer's card, and the login card use 12px (`rounded-xl`), the softest corner in the system, reserved for the largest surfaces. Status dots, pills, and badges are fully rounded (`rounded-full`) - the one place circular form appears, and it's reserved for state indicators, never for buttons or cards. Borders are always the single Hairline Grey/Paper Hairline token; there is no second border color anywhere in the system.

## Components

### Buttons
- **Shape:** 6px radius (`rounded-md`), `px-3 py-1.5` to `px-3 py-2` depending on density, `text-sm`.
- **Primary:** Signal Lime fill, Void Black text, `hover:brightness-90`. Reserved for the one committing action per view (Sign in, + New Company, Amend Thesis, Add).
- **Secondary / Outline:** Transparent fill, Hairline Grey border, `hover:bg-hover-graphite`. The default for every non-primary action (Cancel, Post Observations, nav items).
- **Danger:** Kill Red fill, white text, `hover:brightness-90`. Reserved for destructive or alarm-toned actions (Reject).
- All three share one rule: no border-radius pill shape, no gradient, no icon-only buttons without a text label.

### Badges / Pills
- **Status pill** (on_track/watch_closely/broken, and severity/source tags): 10% tint of the semantic color as background, full-strength semantic color as text, `rounded-full`, `ring-1` in the same color at 20% opacity. Text is uppercase-weight small caps in Space Grotesk, not mono, even though the tint colors are the same accents used for data.
- **Neutral badge** (e.g. "rule_engine" source tag): Hover Graphite background, primary text color, same pill shape - the neutral member of the same family.

### Cards / Containers
- **Corner Style:** 8px (`rounded-lg`).
- **Background:** Panel Graphite (Paper White + border in light theme).
- **Shadow Strategy:** None - see Elevation & Depth.
- **Border:** 1px Hairline Grey.
- **Internal Padding:** 16px (`p-4`).

### Inputs / Fields
- **Style:** Deep Graphite background (a level darker than card fill, marking it as "nested"), Hairline Grey border, 6px radius, Console White text, Instrument Grey placeholder.
- **Focus:** Border shifts to Signal Lime plus a soft lime glow (`box-shadow: 0 0 0 2px rgba(204,255,0,0.25)`), no outline ring.
- **Native controls:** `color-scheme` is set per theme so browser-native chrome (date pickers, scrollbars, checkboxes) matches without per-element overrides; a global `input, select, textarea` rule carries the styling above so every form element gets it automatically.

### Navigation
- Header is True Black (not Panel Graphite), bottom hairline border, sticky. Nav items are plain text buttons with `hover:bg-hover-graphite` and no active-state underline; the one exception is the primary "+ New Company" action, which gets the Signal Lime treatment like any other primary button.

### Data Table (signature component)
The generic custom-table grid (user-defined columns, Excel-like row data): header row in Deep Graphite with uppercase Label-style column names, body rows separated by hairlines with no zebra striping, numeric cells right-set in JetBrains Mono, enum-typed cells rendered as small Hover-Graphite pill badges rather than plain text. Wrapped in its own horizontally-scrolling, bordered container so a wide table never breaks the modal's fixed width.

## Do's and Don'ts

### Do:
- **Do** keep Signal Lime to primary actions and "good" status only - it is a signal, not a brand wash.
- **Do** render every number, key, and code value in JetBrains Mono regardless of its size or context.
- **Do** use Void Black text on bright accent fills (Lime, Cyan, Amber); reserve white text for Kill Red only.
- **Do** keep cards and panels flat with a hairline border; reserve `shadow-xl` for modals, the drawer, and the login card only.
- **Do** carry the same four accent hues, unchanged, across both the dark and light theme - only ground and text tokens may swap.

### Don't:
- **Don't** add a second "hero" accent color competing with Signal Lime on the same screen.
- **Don't** use rounded-full or soft pill shapes on buttons or cards - full rounding is reserved for status dots, pills, and badges.
- **Don't** add a shadow to an at-rest card, tile, or button; shadow means "floating above the page," nothing else.
- **Don't** mix Space Grotesk into a data value or JetBrains Mono into prose - the two fonts are a semantic split, not a stylistic one.
- **Don't** introduce a second border color; Hairline Grey (or its light-theme counterpart) is the only one.

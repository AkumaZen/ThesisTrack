---
name: Investment Thesis Platform
description: A kill-switch console for disciplined, falsifiable equity theses
colors:
  paper: "#faf9f5"
  ink: "#141412"
  cream: "#f1eee7"
typography:
  display:
    fontFamily: "Poppins, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.04em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.cream}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
---

# Design System: Investment Thesis Platform

## Overview

**Creative North Star: "The Kill-Switch Console"**

This is instrumentation for a decision that costs real money if it's wrong. The console metaphor comes from the product's own defining mechanism, kill triggers: pre-committed, quantified conditions that invalidate a thesis before the analyst gets emotionally invested in being right. The interface should feel like it belongs to that discipline - built for someone who has already decided that clarity beats comfort.

But the execution stays quiet, not loud. This is not a garish trading-floor wall of blinking tickers. There are exactly three colors, full stop - warm paper, ink, and cream - and no accent hue at all. Every status distinction (on track vs. watch closely vs. broken, warn vs. danger) is carried by text label and dot fill/weight, never by color. Numbers and keys render in a distinct, weighted voice, because in this product a number is evidence, not decoration - it should look like it came from an instrument, not from prose.

Light and dark are true inversions of the same two neutrals, not two separate palettes: paper and ink swap roles (page background becomes ink, text becomes paper/cream). A screen that only works in one theme is a bug, not a variant.

**Key Characteristics:**
- Exactly three neutrals (paper `#faf9f5`, ink `#141412`, cream `#f1eee7`) - no accent color, no hue of any kind, in either theme.
- Every former "accent" role (primary buttons, on-track status, focus rings) now resolves to the same theme-inverting ink/paper pair - whichever of the two currently reads as "ink" against the current background.
- Dark and light are literal inversions (ink⇄paper) of the same tokens, never a second designed palette.
- Flat at rest; shadow is reserved for things that float above the page.
- Numbers, keys, and code always render in Poppins, regardless of size - prose is always Inter. This split is a hierarchy in itself, not just a font choice.
- Refined and quiet in execution: rectangular controls, no gradients, generous quiet space, restraint over spectacle - the console is disciplined, not aggressive.

## Colors

Exactly three colors, full stop: paper, ink, and cream - no accent, no hue of any kind. Status and semantic meaning are carried entirely by text, dot fill, and fill-vs-outline weight, never by color.

### Neutrals
- **Paper** (`#faf9f5`): Light-theme page background and header/nav/modal fill (structural surfaces always match the page background, never a separate dark plate - true in both themes). In dark theme, paper becomes the primary text color instead.
- **Ink** (`#141412`): Light-theme primary text, and the fill for every "status stamp" (on-track/ok/warn/danger all resolve to this one ink tone - distinguished by their text label, not their color) and every primary button (`bg-fg`, paired with the opposite-theme neutral as text). In dark theme, ink becomes the page background instead.
- **Cream** (`#f1eee7`): Card and panel fill in light theme (`surface`); replaces every former "pure white" use in the product. In dark theme, a small percentage of cream is mixed into ink to produce the raised card/hover/border tones.

### Named Rules
**The No-Accent Rule.** There is no signal color. On-track status, primary buttons, and focus rings all use the same theme-inverting ink/paper pair as everything else - never a distinct hue. A control needs to communicate "this is primary" or "this is good" through weight, fill vs. outline, and text, not color.

**The Ink-Fill Rule.** Primary action buttons (Amend Thesis, + New Company, Create, Submit) are filled with the ink/paper-inverting `--fg` token, text in the opposite `--bg` token.

**The No-Second-Hue Rule.** on-track/ok/warn/danger and any former "info" tier all resolve to the same ink-toned fill (`var(--fg)`, so it still inverts correctly in dark mode). A badge or button that needs to communicate "this is different from that" does it with its text label and dot fill/outline, never with a distinct hue.

## Typography

**Body Font:** Inter (with system-UI fallback)
**Label/Mono Font:** Poppins (with Segoe UI, sans-serif fallback)

**Character:** Inter carries every word a human wrote - headings, labels, descriptions, buttons. Poppins carries every value a human should trust as data - metrics, counts, JSON, code. The split is deliberate and total: it is never used for decoration, only for "this is measured, not written."

### Hierarchy
- **Display** (600, 1.5rem/24px, Poppins): The large stat-tile numbers on the dashboard header (Total Tracked, On Track, etc.) - deliberately Poppins even at display size, because they are counts, not headlines.
- **Headline** (600, 1.25rem/20px, Inter): Drawer and modal titles - a company name, "New Data Table."
- **Title** (600, 1.125rem/18px, Inter): Page-level heading (the app header), modal section headers.
- **Body** (400, 0.875rem/14px, Inter): The default UI voice - buttons, form labels, descriptions, list content. The overwhelming majority of text in the product.
- **Label** (600, 0.75rem/12px, Inter, 0.04em tracking, uppercase): Section eyebrows ("THE BUSINESS," "DATA TABLES"), muted metadata captions.

### Named Rules
**The Data Voice Rule.** Any number, key, code snippet, or machine-shaped value renders in Poppins, at whatever size the context calls for - a 24px stat count and a 12px table cell are both Poppins. Any word a human composed renders in Inter. Never mix the two within a single value.

## Layout

Dense, utility-first dashboard layout, not an editorial page: a `max-w-7xl` centered container, cards arranged in a responsive grid (1/2/3 columns by breakpoint), and a fixed-width right-hand drawer (520px) for record detail rather than route navigation. Vertical rhythm is tight and consistent - card padding is 16-20px, gaps between sibling cards are 12-16px - because the product rewards scanning many companies at once over lingering on one. Modals are capped at `max-w-2xl` and internally scroll rather than growing the viewport; wide content (the custom-table grid) scrolls horizontally inside its own bordered container rather than breaking the modal width.

## Elevation & Depth

Flat by default, with a hairline border doing the separation work that a shadow would do elsewhere. Depth exists only for things that genuinely float above the page content: the modal panel, the detail drawer, and the login card. Everything else - cards, tiles, panels, badges - sits at the same visual plane as its neighbors, distinguished by fill color and a 1px border, never a shadow.

### Shadow Vocabulary
- **Overlay** (`shadow-xl`): The modal panel, the detail drawer, and the login card. Signals "this is temporarily on top of the page," never "this is a nicer card."

### Named Rules
**The Flat-At-Rest Rule.** No card, tile, badge, or button carries a shadow at rest or on hover. Shadow exists solely to mark a surface as floating above the page (modal, drawer, login card) - if it isn't an overlay, it doesn't get one.

## Shapes

Rectangular and restrained. Buttons, inputs, and small controls use a 6px radius (`rounded-md`) - present but not soft. Cards, tiles, and panels step up to 8px (`rounded-lg`). Modals, the drawer's card, and the login card use 12px (`rounded-xl`), the softest corner in the system, reserved for the largest surfaces. Status dots, pills, and badges are fully rounded (`rounded-full`) - the one place circular form appears, and it's reserved for state indicators, never for buttons or cards. Borders are always the single border token; there is no second border color anywhere in the system.

## Components

### Buttons
- **Shape:** 6px radius (`rounded-md`), `px-3 py-1.5` to `px-3 py-2` depending on density, `text-sm`.
- **Primary:** Ink fill, paper/cream text (whichever contrasts in the current theme), `hover:brightness-90`. Reserved for the one committing action per view (Sign in, + New Company, Amend Thesis, Add).
- **Secondary / Outline:** Transparent fill, border token, `hover:bg-surface-3`. The default for every non-primary action (Cancel, Post Observations, nav items).
- **Danger:** Ink fill (via the danger token, which tracks --fg), opposite-theme text, `hover:brightness-90`. Reserved for destructive or alarm-toned actions (Reject).
- All three share one rule: no border-radius pill shape, no gradient, no icon-only buttons without a text label.

### Badges / Pills
- **Status pill** (on_track/watch_closely/broken, and severity/source tags): 10% tint of the semantic color as background, full-strength semantic color as text, `rounded-full`, `ring-1` in the same color at 20% opacity. Text is uppercase-weight small caps in Inter, not Poppins, even though the tint colors are the same accents used for data.
- **Neutral badge** (e.g. "rule_engine" source tag): Surface-3 background, primary text color, same pill shape - the neutral member of the same family.

### Cards / Containers
- **Corner Style:** 8px (`rounded-lg`).
- **Background:** Cream (dark theme: cream mixed into ink).
- **Shadow Strategy:** None - see Elevation & Depth.
- **Border:** 1px the border token.
- **Internal Padding:** 16px (`p-4`).

### Inputs / Fields
- **Style:** Surface-2 background (a level darker/lighter than card fill, marking it as "nested"), border token, 6px radius, ink/paper text, muted-fg placeholder.
- **Focus:** Border shifts to the theme's ink/paper contrast color plus a soft glow (`box-shadow: 0 0 0 2px color-mix(in srgb, var(--fg) 25%, transparent)`), no outline ring.
- **Native controls:** `color-scheme` is set per theme so browser-native chrome (date pickers, scrollbars, checkboxes) matches without per-element overrides; a global `input, select, textarea` rule carries the styling above so every form element gets it automatically.

### Navigation
- Header fill always matches the page background (never a separate dark plate), bottom hairline border, sticky. Nav items are plain text buttons with `hover:bg-hover-graphite` and no active-state underline; the one exception is the primary "+ New Company" action, which gets the ink-fill treatment like any other primary button.

### Data Table (signature component)
The generic custom-table grid (user-defined columns, Excel-like row data): header row in Surface-2 with uppercase Label-style column names, body rows separated by hairlines with no zebra striping, numeric cells right-set in Poppins, enum-typed cells rendered as small surface-3 pill badges rather than plain text. Wrapped in its own horizontally-scrolling, bordered container so a wide table never breaks the modal's fixed width.

## Do's and Don'ts

### Do:
- **Do** keep primary-button ink fill to committing actions only - it is a signal, not a brand wash.
- **Do** render every number, key, and code value in Poppins regardless of its size or context.
- **Do** pair the ink fill with paper/cream text, and vice versa - never same-tone text on a same-tone fill.
- **Do** keep cards and panels flat with a hairline border; reserve `shadow-xl` for modals, the drawer, and the login card only.
- **Do** carry the same four accent hues, unchanged, across both the dark and light theme - only ground and text tokens may swap.

### Don't:
- **Don't** add a second "hero" accent color competing with the ink-fill primary button on the same screen.
- **Don't** use rounded-full or soft pill shapes on buttons or cards - full rounding is reserved for status dots, pills, and badges.
- **Don't** add a shadow to an at-rest card, tile, or button; shadow means "floating above the page," nothing else.
- **Don't** mix Inter into a data value or Poppins into prose - the two fonts are a semantic split, not a stylistic one.
- **Don't** introduce a second border color; the single border token is the only one.

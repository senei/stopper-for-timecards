# Token values: workspace-ui-tokens

**Source line (also written next to the CSS block in `src/styles/global.css`):**
Values: light-gray page, white cards, dark-gray primary buttons, bordered secondary buttons, orange headings and a blue focus ring, chosen by the user on 2026-09-24 from mocks (`screenshots/palette-light-gray.png`), no external preset. Radii are the user's: 2px controls, 3px cards.

History: the first draft (written before the CSS edit) kept the dark navy cosmic palette with solid surfaces; the user found it too dark. The second draft (option A of an earlier mock, since removed from the folder) was a light-gray card on a blue page; the user found it too blue ("bg was supposed to be light gray") and asked for dark-gray Start/Switch buttons and bordered Delete buttons like Copy. Every value below is the third draft and replaces the earlier ones. The "before" screenshots show the original glass look.

Colors are Tailwind v4 gray-scale values quoted from `node_modules/tailwindcss/theme.css`, plus orange, blue, red, emerald and amber where noted. The app has one look, so the values live in `:root`; the `.dark` layer is the stock shadcn neutral set plus the new roles and is applied nowhere.

## Page

| Role | Replaces (file:line) | Source | `oklch` |
| --- | --- | --- | --- |
| `--background` | body / page behind the card | Tailwind `gray-100` | `oklch(0.967 0.003 264.542)` |
| `--background-end` (new) | bottom of the page gradient | Tailwind `gray-200` | `oklch(0.928 0.006 264.531)` |
| `--foreground` | `text-white` directly on the page | Tailwind `gray-900` | `oklch(0.21 0.034 264.665)` |

`bg-cosmic`, the old page gradient, was removed in Phase 5 once every page used the light-gray page (`PageCard` draws its own gradient from `--background` to `--background-end`).

## Surfaces (solid, no alpha)

| Role | Replaces (file:line) | Source | `oklch` |
| --- | --- | --- | --- |
| `--card`, `--popover` | `border-white/10 bg-white/10 backdrop-blur-xl` (`[token].astro:73`) | white | `oklch(1 0 0)` |
| `--field` (new) | `bg-black/20` fields (`[token].astro:108,125,151`) | white | `oklch(1 0 0)` |
| `--secondary`, `--muted` | `bg-white/10` buttons (`[token].astro:112,156`), bordered with `--border` (Copy, Delete) | Tailwind `gray-100` | `oklch(0.967 0.003 264.542)` |
| `--accent` | `hover:bg-white/20` (`[token].astro:112,125,132,156`) | Tailwind `gray-200` | `oklch(0.928 0.006 264.531)` |
| `--border` | `border-white/10` on the card, `border-white/20` on buttons | Tailwind `gray-300` | `oklch(0.872 0.01 258.338)` |
| `--input` | `border-white/20` on fields (border, as in shadcn) | Tailwind `gray-500` | `oklch(0.551 0.027 264.364)` |

## Text and headings

| Role | Replaces (file:line) | Source | `oklch` |
| --- | --- | --- | --- |
| `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground` | `text-white` (`[token].astro:73,96,125,151`) | Tailwind `gray-900` | `oklch(0.21 0.034 264.665)` |
| `--muted-foreground` | `text-blue-100/80` (`:76,95`), `/60` (`:144,161`), `/50` (`:132`), `/40` (`:108`) collapsed into one role | Tailwind `gray-600` | `oklch(0.446 0.03 256.802)` |
| `--heading` (new) | `from-blue-200 to-purple-200` gradient headings (`[token].astro:81`, `index.astro:28`, `delete.astro:58`) | Tailwind `orange-700` | `oklch(0.553 0.195 38.402)` |

The blue-to-purple heading gradient is dropped: headings are one solid orange (`text-heading`). `orange-700` rather than a lighter orange so the small uppercase section headings pass 4.5:1.

## Interactive and status roles

| Role | Replaces (file:line) | Source | `oklch` |
| --- | --- | --- | --- |
| `--primary` | Start and Switch buttons (`[token].astro:112`); the `bg-purple-600` CTA on `index.astro:47` is replaced in Phase 5 | Tailwind `gray-800` (dark gray) | `oklch(0.278 0.033 256.848)` |
| `--primary-foreground` | `text-white` on that button | white | `oklch(1 0 0)` |
| `--ring` | browser default focus outline (no `focus-visible` on hand-rolled controls); the only blue left | Tailwind `blue-600` | `oklch(0.546 0.245 262.881)` |
| `--destructive` | red message / Delete hover (`[token].astro:85,132`) | existing shadcn light value, unchanged (`red-600`) | `oklch(0.577 0.245 27.325)` |
| `--primary-hover` (new, added in Phase 2) | solid hover step of the dark-gray primary `Button` (replaces the stock `hover:bg-primary/90` alpha) | Tailwind `gray-900` | `oklch(0.21 0.034 264.665)` |
| `--destructive-hover` (new, added in Phase 2) | solid hover step of the destructive `Button` (replaces `hover:bg-destructive/90`) | Tailwind `red-700` | `oklch(0.505 0.213 27.518)` |
| `--destructive-foreground` (new) | `text-white` (`button.tsx:14`) | white | `oklch(1 0 0)` |
| `--destructive-text` (new, added in Phase 2) | text on the soft red error `Alert` tint (user chose a tint like success and warning over a solid red block) | Tailwind `red-900` | `oklch(0.396 0.141 25.723)` |
| `--success` (new) | emerald message (`[token].astro:90`) | Tailwind `emerald-600` | `oklch(0.596 0.145 163.225)` |
| `--success-foreground` (new) | `text-emerald-100` (`[token].astro:90`) | Tailwind `emerald-900` | `oklch(0.378 0.077 168.94)` |
| `--warning` (new) | (was the `Banner.astro` amber hex; the banner is removed) | Tailwind `amber-500` | `oklch(0.769 0.188 70.08)` |
| `--warning-foreground` (new) | same | Tailwind `amber-900` | `oklch(0.414 0.112 45.904)` |

## Shape

| Role | Was | Now |
| --- | --- | --- |
| `--radius` | `0.625rem` (`global.css:7`) | `0.125rem` (2px): controls |
| `--radius-card` (new) | none (cards used `rounded-2xl`, 16px) | `0.1875rem` (3px): cards |

`@theme inline` maps `--radius-sm`, `-md` and `-lg` to `--radius` and `-xl` and `-2xl` to `--radius-card`. This flattens shadcn's usual stepped scale on purpose: every `rounded-lg` / `rounded-md` control is 2px and every `rounded-xl` / `rounded-2xl` card is 3px, so the pages that are not restyled (index, 404, delete) also get the small corners.

## Semantics to remember in Phase 2

- `--background` / `--foreground` are the light-gray **page** and the text on it. Content sits on `--card`; fields use `bg-field` with `border-input` and `text-card-foreground`, placeholder `text-muted-foreground`.
- Buttons: default variant is `--primary` (dark gray, Start and Switch); `secondary` is `bg-secondary` with `border-border` (Copy and Delete); its hover uses `--accent` (a solid step, not an alpha).
- The page and the card differ by only 1.10:1, so the card edge relies on `--border` and a soft shadow, not on color contrast alone.

## Measured contrast (browser, 2026-09-24)

Measured in headless Chrome against the running app: the kitchen sink for text and control boundaries (real computed colors, alpha composited over the real background) and the real workspace page for the focus indicator (real Tab key presses). Replaces the design-time estimates that were computed from the token values; every text pair matched them.

| Pair | Foreground on background | Ratio | Needs | Result |
| --- | --- | --- | --- | --- |
| Heading (h1, orange) | `#ca3500` on `#ffffff` | 5.22 | 4.5 | Pass |
| Section heading (h2, uppercase orange) | `#ca3500` on `#ffffff` | 5.22 | 4.5 | Pass |
| Muted note text | `#4a5565` on `#ffffff` | 7.56 | 4.5 | Pass |
| Empty-state text (No projects yet) | `#4a5565` on `#ffffff` | 7.56 | 4.5 | Pass |
| Start button (primary) | `#ffffff` on `#1e2939` | 14.67 | 4.5 | Pass |
| Copy button (secondary) | `#101828` on `#f3f4f6` | 16.13 | 4.5 | Pass |
| Delete link (secondary) | `#101828` on `#f3f4f6` | 16.13 | 4.5 | Pass |
| Project pick button (outline) | `#101828` on `#ffffff` | 17.75 | 4.5 | Pass |
| Input text (private link) | `#101828` on `#ffffff` | 17.75 | 4.5 | Pass |
| Input placeholder | `#4a5565` on `#ffffff` | 7.56 | 4.5 | Pass |
| Error alert text | `#82181a` on `#fce5e6` | 8.35 | 4.5 | Pass |
| Success alert text | `#004f3b` on `#e5f4ef` | 8.49 | 4.5 | Pass |
| Copy-failed message | `#82181a` on `#ffffff` | 10.03 | 4.5 | Pass |
| Delete link on hover (destructive-text on accent) (hover state, from tokens) | `#82181a` on `#e5e7eb` | 8.10 | 4.5 | Pass |
| Primary button on hover (primary-foreground on primary-hover) (hover state, from tokens) | `#ffffff` on `#101828` | 17.75 | 4.5 | Pass |
| Text field border | `#6a7282` on `#ffffff` | 4.84 | 3 | Pass |
| Project pick button border (outline) | `#6a7282` on `#ffffff` | 4.84 | 3 | Pass |
| Copy button border (secondary) (label identifies the control) | `#d1d5dc` on `#ffffff` | 1.47 | 3 | n/a (the label identifies the control) |
| Focus border (`border-ring`) | `#155dfc` on `#ffffff` | 5.25 | 3 | Pass |
| Focus halo (3px, `ring-ring/50`) | `#8aaefe` on `#ffffff` | 2.20 | 3 | Below on its own; the focus border above carries the indicator |

Tab order on the real workspace page (idle): New project name → Start → Acme Widgets → Delete → Beta Corp → Delete → Your private link → Copy. All 8 stops show a focus ring (8/8) and match `:focus-visible`, in DOM order, including both Delete links and Copy.

Horizontal overflow at 390px: the workspace page and the kitchen sink both have `scrollWidth` 390 (no overflow) and no element outside the viewport.

Two findings, for the review: (1) the secondary buttons' border (`--border`) is 1.47:1, which is fine because their text label identifies them (text is 16.13:1), but it is below 3:1 if a border alone were meant to identify them; (2) the 50% focus halo alone is about 2.20:1, while the focus border that appears with it is 5.25:1. Making the halo solid (`ring-ring`) would lift it to about 5.25:1; that is a change to `button.tsx` and `input.tsx`, not the view.

Decision (user, 2026-09-24): leave the halo and the secondary button borders as they are. The focus border is the indicator that meets 3:1, all 8 tab stops show it, and the buttons are identified by their text.

## Dark layer (`.dark`), inactive

Restored to the stock shadcn neutral values. The new roles have values so both layers stay complete (`--background-end` = `--background`, `--field` `oklch(0.145 0 0)`, `--heading` `orange-600`, status roles from Tailwind), but nothing renders them and they are not visually verified.

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

`bg-cosmic` (used by index, 404, delete and, until Phase 3, the workspace) is kept as a **legacy** utility with the old dark navy look, rewritten from `#0a0e1a` / `#0f1529` into `oklch(0.166 0.026 269.4)` / `oklch(0.201 0.041 269.8)`. The three unrestyled pages use white text on translucent glass and would be unreadable on the light page. The workspace switches to `bg-background` in Phase 3; the utility is deleted in Phase 5, when the other pages are restyled (the user asked that every page adopt the light-gray look).

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

## Computed contrast (from these token values, not browser-measured)

Computed with the WCAG relative-luminance formula from the `oklch` values above. Phase 4 replaces this with a browser-measured table.

| Pair | Ratio | Needs |
| --- | --- | --- |
| `--foreground` on `--background` (page top) | 16.13 | 4.5 |
| `--foreground` on `--background-end` (page bottom) | 14.35 | 4.5 |
| `--card-foreground` on `--card` | 17.75 | 4.5 |
| `--muted-foreground` on `--card` | 7.56 | 4.5 |
| `--muted-foreground` on `--secondary` (Copy, Delete) | 6.87 | 4.5 |
| `--secondary-foreground` on `--secondary` | 16.13 | 4.5 |
| `--heading` on `--card` | 5.23 | 4.5 (small uppercase headings) |
| `--heading` on `--background` (page) | 4.75 | 4.5 |
| `--primary-foreground` on `--primary` (Start, Switch) | 14.68 | 4.5 |
| `--destructive-foreground` on `--destructive` | 4.76 | 4.5 |
| `--primary-foreground` on `--primary-hover` | 17.75 | 4.5 |
| `--destructive-foreground` on `--destructive-hover` | 6.42 | 4.5 |
| `--destructive-text` on `--card` | 10.06 | 4.5 |
| `--destructive-text` on the 10% destructive tint (error `Alert`) | 9.26 | 4.5 |
| `--success-foreground` on `--card` | 9.69 | 4.5 |
| `--warning-foreground` on `--card` | 9.09 | 4.5 |
| `--ring` on `--card` | 5.26 | 3 |
| `--input` (field border) on `--card` | 4.84 | 3 |
| `--border` on `--card` | 1.47 | none: decorative edge only |
| `--card` on `--background` | 1.10 | none: card edge uses border and shadow |

## Dark layer (`.dark`), inactive

Restored to the stock shadcn neutral values. The new roles have values so both layers stay complete (`--background-end` = `--background`, `--field` `oklch(0.145 0 0)`, `--heading` `orange-600`, status roles from Tailwind), but nothing renders them and they are not visually verified.

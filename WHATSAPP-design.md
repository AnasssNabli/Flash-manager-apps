# WhatsApp Phone Preview — Design Prompt

Reusable design spec for the iPhone-framed WhatsApp preview that sits in the right column
of the AI agent manage page. Paste this whole file as a prompt to rebuild the component
from scratch, or use it as the reference when restyling it.

Live implementation: `front/components/agents/whatsapp-phone.tsx`
(`<PhoneFrame>` + `<WhatsAppPhonePreview>`), consumed by
`front/components/agents/agent-chat-test.tsx` and mounted in
`front/components/agents/agents.tsx`.

Stack assumptions: React + TypeScript, Tailwind CSS, no icon library (inline SVG only),
no external images except the agent avatar.

---

## 1. What to build

A **WhatsApp chat mockup inside an iPhone frame**, used as a live preview panel next to a
settings form. Two exported pieces:

1. `PhoneFrame` — the chrome: status bar, chat header, scrollable chat body (slot), footer
   (slot, with a default), home indicator.
2. `WhatsAppPhonePreview` — a thin wrapper over `PhoneFrame` that renders **one outgoing
   message** plus an optional CTA card. Used for read-only template previews.

The interactive variant (live AI chat) reuses `PhoneFrame` and passes its own `footer`
(a real text input + send button) and its own children (the message list).

---

## 2. Frame geometry

| Token | Value |
| --- | --- |
| Outer width | `300px`, horizontally centered (`mx-auto`) |
| Corner radius | `38px` |
| Bezel | `3px` solid `#1a1a1a` (light) / `#555` (dark) |
| Bezel fill | `#1a1a1a` |
| Shadow | Tailwind `shadow-2xl` |
| Clipping | `overflow-hidden` on the bezel so children cannot escape the radius |
| Chat body height | fixed `432px`, `overflow-y-auto` |

The frame is **fixed-width and fixed-height** on purpose — it must not reflow with content.
Long conversations scroll inside the body; they never grow the frame.

---

## 3. Color tokens (WhatsApp palette, hard-coded on purpose)

| Purpose | Hex |
| --- | --- |
| Status bar + header background | `#075E54` (WhatsApp dark teal) |
| Chat wallpaper | `#ECE5DD` |
| Outgoing bubble | `#DCF8C6` |
| Incoming bubble | `#FFFFFF` |
| Footer / home-indicator tray | `#F0F0F0` |
| Accent (mic, send, CTA text) | `#00A884` |
| Timestamp text | `#667781` |
| Read receipts (double check) | `#53bdeb` |
| Footer emoji icon | `#54656F` |
| Avatar fallback background / glyph | `#DFE5E7` / `#aab8c2` |
| Dynamic Island + home indicator | `#1a1a1a` |
| CTA card border | `#dfdfdf` |

These are **not** wired to the app's design tokens. The point is that the preview looks like
WhatsApp regardless of the surrounding light/dark app theme. The single exception is the
outer bezel, which lightens to `#555` in dark mode so the frame does not disappear into a
dark page background.

---

## 4. Anatomy, top to bottom

### 4.1 Status bar

Background `#075E54`, padding `px-5 pt-2.5 pb-1`. Three-part flex row:

- **Left** (`flex-1`): time string, `11px`, `font-semibold`, `text-white/90`. Default `9:41`.
- **Center**: the Dynamic Island — a plain `22px × 72px` black pill, `rounded-full`.
- **Right** (`flex-1`, right-aligned, `gap-[5px]`, white): three inline SVGs in order
  - cellular signal — 4 rising rounded bars, `11px × 16px`
  - Wi-Fi — 3 stroked arcs plus a dot, `12px × 16px`, `strokeWidth 2.1`, round caps
  - battery — rounded outline at `opacity .5`, solid fill inside, small nub at `opacity .6`, `12px × 26px`

All icons use `currentColor` and inherit white from the row.

### 4.2 Chat header

Background `#075E54`, `px-3 py-2.5`, flex row, `gap-2.5`:

1. Back chevron, `14px`, white — decorative, not a button.
2. **Avatar**: `36px` circle, `overflow-hidden`, background `#DFE5E7`. Renders the agent
   avatar `object-cover`; on image error, swaps to an inline user glyph in `#aab8c2`. Track
   the error in local state — never let a broken image show.
3. **Name + presence** (`min-w-0 flex-1`):
   - name — `12px`, `font-semibold`, white, `truncate`
   - presence — `10px`, `text-white/70`, default `online`
4. **Right slot** (`headerRight`), default: video-call icon (`18px`) + phone icon (`17px`),
   white, `gap-3.5`, `pr-1`.

### 4.3 Chat body

- Background `#ECE5DD` plus a **doodle overlay**: an inline `data:` SVG of ~10 scattered
  circles (r 2–3) at `opacity .04`, tiled at `background-size: 200px 200px`. Keep it this
  subtle — it should read as paper texture, not as dots.
- Fixed `432px` height, `overflow-y-auto`, and it accepts a forwarded `bodyRef` so the
  consumer can autoscroll to the bottom on new messages.
- Inner wrapper: `flex min-h-full flex-col justify-end p-3` — messages sit **bottom-aligned**
  when the conversation is short and grow upward, like a real chat.

### 4.4 Day divider / mode chip

Centered pill above the messages: `bg-white/90`, `rounded-md`, `px-3 py-0.5`, `10px`,
`font-medium`, gray-500, small shadow.

- Read-only preview: static text, default `Today`.
- Live chat: the same pill becomes a **button** reading `Test mode · tap to reset`
  (`hover:bg-white`) that clears the conversation.

### 4.5 Bubbles

Shared: `max-w-[85%]` (90% in the single-message preview), `rounded-lg`, `px-3 py-2`,
`shadow-sm`, text `11px` with `leading-[1.5]` (`1.6` in the single-message preview),
`text-gray-800`, `whitespace-pre-wrap`.

- **Outgoing** (the agent template, or the human in the live tester): `bg-[#DCF8C6]`,
  right-aligned, `rounded-tr-sm` for the squared-off tail corner.
- **Incoming** (AI reply): `bg-white`, left-aligned, `rounded-tl-sm`. On error add
  `ring-1 ring-red-300` — no red text, no icon, just a hairline.
- **Meta row**, bottom-right inside the bubble, `mt-0.5`, `gap-0.5`: timestamp `8px` in
  `#667781`, then the double-check icon `12px` in `#53bdeb` — **outgoing bubbles only**.
- **Media** (incoming only): stacked above the text, `mb-2 space-y-2`, each item
  `rounded-md border border-black/5 overflow-hidden`. Images render `max-h-40 w-full
  object-contain`; non-images fall back to a `bg-black/5` strip with the filename at `10px`.

### 4.6 Typing indicator

Replaces the bubble while a reply is pending: an incoming-style white bubble
(`rounded-tl-sm`, `px-3 py-2.5`) holding three `6px` dots in `bg-black/30`, `animate-bounce`,
staggered `animationDelay` of `0 / 150 / 300ms`.

### 4.7 Footer (composer)

Background `#F0F0F0`, `px-2.5 py-2`, flex row `gap-2`.

**Default (read-only)**: emoji icon `16px` in `#54656F` → a `rounded-full bg-white px-3 py-1.5`
placeholder strip reading `Type a message` at `10px` gray-400 → a `28px` circle
`bg-[#00A884]` holding a `12px` white mic icon.

**Live-chat override**: same shell, but the strip is a real `<input>` (`10px`, gray-700,
`outline-none`, `placeholder:text-gray-400`, `disabled:opacity-60`, submits on Enter without
Shift) and the circle becomes a send button — `12px` white paper-plane icon, swapped for a
`12px` spinner (`animate-spin`, `border-2 border-white/30 border-t-white`) while sending,
`disabled:opacity-40` when empty or in-flight, `aria-label="Send"`.

### 4.8 Home indicator

`#F0F0F0` tray, `py-2.5`, centered `5px × 108px` pill in `#1a1a1a`.

---

## 5. Optional CTA card (single-message preview)

When a `ctaLabel` is supplied, render a separate card **below** the bubble — not inside it —
matching WhatsApp's link-button style:

- `w-[90%]`, `rounded-xl`, `bg-white`, `border border-[#dfdfdf]`,
  `shadow-[0_1px_1px_rgba(0,0,0,0.05)]`, `overflow-hidden`
- full-width centered button, `px-3 py-2.5`, `11px`, `font-semibold`, `#00A884`, `gap-1.5`,
  preceded by a `12px` link icon.

---

## 6. Text rendering rules

Agent and template copy is authored with WhatsApp markup, so run it through a tiny renderer
before injecting as HTML — in this order:

1. escape `&`, `<`, `>`
2. `**bold**` → `<strong>`
3. newline → `<br/>`

Escaping **must** come first. User-typed messages in the live tester are rendered as plain
text, with no HTML injection path at all.

The `rtl` prop flips `dir="rtl"` on the bubble text and the CTA button only — the frame
chrome stays LTR.

---

## 7. Placement on the manage page

- Page layout: `grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]` — form left, preview right.
- The preview column is `min-w-0` and its inner wrapper is `lg:sticky lg:top-8`, so the phone
  follows the user down the long settings form.
- Above the phone: a centered label, `12px`, `font-semibold`, `uppercase`, `tracking-wide`,
  `text-muted-foreground` — `Live preview` or `Confirmation preview` depending on mode.
- The two modes swap the whole body: the interactive tester (which hits the preview API) vs.
  a static `WhatsAppPhonePreview` fed a filled-in confirmation template.

---

## 8. Non-negotiables

- **No icon library.** Every glyph is an inline SVG driven by `currentColor`.
- **No app theme tokens inside the frame.** Hard-code the WhatsApp hexes; only the outer
  bezel is dark-mode aware.
- **Fixed frame**: `300px` wide, `432px` body. Content scrolls; the frame never resizes.
- **Bottom-anchored messages** via `justify-end` on a `min-h-full` column.
- **Tiny type scale** (`8–12px`) throughout — it is a scaled-down phone, not a compact UI.
- **Escape before formatting** in the message renderer.
- Avatar failures degrade to a glyph, never to a broken-image icon.

---

## 9. API surface

```tsx
<PhoneFrame
  contactName="Test agent"
  online="online"            // presence line, default "online"
  statusBarTime="9:41"
  avatar={AGENT_AVATAR}      // optional; falls back to a user glyph
  headerRight={<CallIcons />}// optional; defaults to video + call icons
  bodyRef={bodyRef}          // optional; for autoscroll
  footer={<Composer />}      // optional; defaults to the read-only composer
>
  {messageList}
</PhoneFrame>

<WhatsAppPhonePreview
  contactName="Ahmed Benali"
  online="online"
  statusBarTime="9:41"
  messageTime="9:41 AM"
  todayLabel="Today"
  message="**Bold** and newlines supported"
  avatar={AGENT_AVATAR}
  rtl={false}
  ctaLabel="View order"      // optional link-button card
/>
```

Also exported:

- `AGENT_AVATAR` — shared brand avatar URL.
- `WA_ICONS` — `back`, `user`, `video`, `phone`, `checks`, `emoji`, `mic`, `send`, `link`;
  each is a `(className) => ReactElement`.
- `renderWhatsAppMessage(text)` — returns `{ __html }` for `dangerouslySetInnerHTML`.

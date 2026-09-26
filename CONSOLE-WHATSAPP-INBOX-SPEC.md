# Console WhatsApp page — implementation spec

Handoff for the **other console app**. Build a first-party sidebar page: **WhatsApp**. Click it → connect a WhatsApp Business number (same Meta Coexistence / QR flow as this app) → then the same inbox UI.

This file is the source of truth for that work. Implement against **your console’s own database, session, and Meta Cloud API**. Do **not** copy the FlashManager App Gateway / iframe / app-bridge architecture from `whatsapp-business`.

**Do not build:** AI agent, auto-replies, Qunvert, campaigns, questionnaires, credits, GPT, agent labels.

---

## 1. What this existing app actually is

`/www/apps/whatsapp-business` is a **thin iframe client**. It does **not** store chats or Meta tokens.

| Data | Where it lives today |
|---|---|
| WABA, phone number, Meta user token | FlashManager |
| Conversations, messages, media, statuses | FlashManager |
| This app’s Postgres | Only `app_tenants` (how to call FlashManager) |

The console you are building **is first-party**. It must own:

1. Meta Embedded Signup (code exchange + store tokens)
2. Webhook receiver + persist messages
3. Graph API send / media / calls / health
4. The WhatsApp UI (connect → health checklist → inbox)

Copy **UX, payloads, and edge-case behaviour** from this repo. Reimplement the **backend**.

Copyable UI (rewire fetch URLs to the console’s own `/api/whatsapp/*`):

| File | Role |
|---|---|
| `app/page.tsx` | Screen state machine: connect / health / inbox / reconnect |
| `app/components/ConnectCard.tsx` | “Connect your WhatsApp number” |
| `app/components/EmbeddedSignupButton.tsx` | Facebook JS SDK + Coexistence extras |
| `app/components/ConnectionHealth.tsx` | Post-connect Meta checklist |
| `app/components/Inbox.tsx` | Full inbox |
| `app/components/DisconnectModal.tsx` | Confirm unlink |
| `app/components/Toasts.tsx` | Toasts |
| `lib/health.ts` | Health types + Meta deep links |
| `lib/waMedia.ts` | Message kind / preview labels |
| `lib/threadDedupe.ts` | Coexistence echo collapse |
| `lib/optimisticSend.ts` | Pending bubble matching |
| `lib/useWhatsAppCall.ts` | WhatsApp calling |

**Do not copy** from this app:

- `lib/fm.ts` App Gateway proxy
- `app/api/oauth/callback` FlashManager install (`fmagt_…`)
- `@flashmanager/app-bridge`
- Shared FlashManager number / sunset (`lib/sunset.ts`)
- Super Admin `?platform=1` inbox, Shopify/Meta connection filters
- `qunvert/` (that **is** the AI agent)
- Iframe-only chrome: `zoom: 0.84`, CSP `frame-ancestors`, “Open from FlashManager”
- `fm:nav-stack` / `fm:theme` postMessage (use the console’s own layout + theme)

---

## 2. Product to ship

### Sidebar

Add a **WhatsApp** item. Route e.g. `/whatsapp` (or `/console/whatsapp`). Auth = the console’s logged-in user / workspace. Scope every query by `workspace_id` (or `owner_id`). Never mix tenants.

### Screens (same order as `app/page.tsx`)

```
not connected          → Connect card
just connected         → Connection health (Meta checklist)
connected + healthy    → Inbox
settings / switch #    → Connect card with Back + Disconnect
status call failed     → “Couldn’t check WhatsApp” (never fake “not connected”)
```

**Critical UX rule:** a failed or empty status fetch is **not** “disconnected”. Only show Connect when you **know** there is no own-number connection. After a successful connect, remember the view in `sessionStorage` (`health` | `inbox`) so a slow Graph refresh does not dump the user back on Connect.

### Connect card copy (keep this intent)

Headline: **Connect your WhatsApp Business**

Seller connects the number **already on the WhatsApp Business mobile app** via a QR code. No SMS verification.

Need:

- A Meta Business Portfolio (Meta’s dialog can create one)
- WhatsApp Business app on that number
- ~2 minutes

Warn in amber: in Meta’s window they must pick the number **already in WhatsApp Business**. If they let Meta create a new number they get a **+1 555 test number** customers cannot message.

After connect: **do not** toast “WhatsApp connected” and stop. Show `ConnectionHealth` with Meta’s real verdict (activation, review, payment, test number).

### Inbox (in scope)

WhatsApp Web–style UI:

- Left: conversation list, search, tabs **All / Needs reply / Unread / Sent**, infinite scroll (50/page), poll ~5s
- Right: thread, date groups, poll ~3s
- Composer: text, emoji, attach image/video, paste image, voice note, quote-reply
- Long-press / context: reply, forward, copy, star (local), hide/delete (local hide is OK)
- Reactions (`type: reaction`)
- Render inbound/outbound: text, image, video, audio/PTT, document, sticker, location, template, carousel
- Delivery ticks + failure copy (see §9)
- Lightbox for images
- Header: connected display number, settings (reconnect / disconnect), optional Call button
- Mobile: conversation list → thread (back closes thread)

**Optional (only if the console already has orders):** “Order details” side panel. Skip Shopify icons, send-variants, and FlashManager `contact-orders` unless you have the same commerce data.

**Out of scope:** AI agent, suggested replies, campaigns, questionnaires, product carousels generated by an agent, credits.

---

## 3. Meta app (Facebook) — required setup

You said the console already has a WhatsApp number linked with Facebook. That is the **Meta app + WABA**. You still need Embedded Signup so **each workspace** can connect **their** number (or reconnect). Do not hard-code one WABA for every customer unless the product is single-tenant.

### 3.1 Env

```bash
META_APP_ID=                  # same Facebook app as Cloud API
META_APP_SECRET=              # server only — never in the browser
META_GRAPH_VERSION=v22.0
WA_EMBEDDED_CONFIG_ID=        # Embedded Signup configuration id
META_WEBHOOK_VERIFY_TOKEN=    # random string you choose
WHATSAPP_TOKEN_ENCRYPTION_KEY= # 32-byte key for AES-GCM of user tokens
NEXT_PUBLIC_META_APP_ID=      # same as META_APP_ID (browser SDK)
NEXT_PUBLIC_WA_EMBEDDED_CONFIG_ID=
```

### 3.2 Meta Developer Console

1. **Facebook Login for Business** + **WhatsApp** product on the app.
2. **Embedded Signup** configuration (`WA_EMBEDDED_CONFIG_ID`). Feature: **WhatsApp Business App onboarding (Coexistence)**, not “create a new Cloud API number”.
3. **Allowed Domains for the JavaScript SDK** = the console’s public origin.
4. OAuth redirect / Valid OAuth Redirect URIs = the console origin (popup) **and** the page URL for the `?code=` fallback.
5. Webhook callback: `https://<console>/api/whatsapp/webhook`
   - Verify token = `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe the **app** to WhatsApp fields (below). After each connect, also subscribe **that WABA** to the app (`POST /{waba-id}/subscribed_apps`).

### 3.3 Webhook fields (Coexistence)

If these are missing, Meta **silently falls back** to “add a new number” instead of the QR / keep-the-phone-app flow:

| Field | Why |
|---|---|
| `messages` | Inbound + interactive replies |
| `message_echoes` / `smb_message_echoes` | Messages sent from the phone app |
| `smb_app_state_sync` | Phone app state |
| `history` | Recent chat import after QR scan |
| `message_template_status_update` | Template approved / rejected |
| `account_update` | Account / WABA changes |
| `account_review_update` | Business review |
| `phone_number_quality_update` | Quality / limits |
| `calls` | Calling (if you ship Call) |

Also handle `statuses` inside the `messages` webhook (sent / delivered / read / failed).

Official: [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup), [Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), [Coexistence](https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers/coexistence).

---

## 4. Database (Prisma / Postgres)

One connection **per workspace**. Chats belong to that connection. **Encrypt** `access_token` at rest. Never log tokens.

```prisma
// Console WhatsApp — own this. Not the AI agent.

enum WaConnectionStatus {
  pending
  connected
  disconnected
  token_expired
}

enum WaMessageDirection {
  inbound
  outbound
}

enum WaMessageStatus {
  pending
  sent
  delivered
  read
  failed
}

model whatsapp_connections {
  id                 String              @id @default(uuid())
  workspace_id       String              @unique
  status             WaConnectionStatus  @default(pending)

  waba_id            String?
  phone_number_id    String?
  business_id        String?
  display_phone      String?
  verified_name      String?
  coexistence_mode   Boolean             @default(true)

  /// Encrypted Meta user access token from Embedded Signup code exchange.
  access_token_enc   String?
  token_expires_at   DateTime?
  /// Permanent WABA / system user token if you exchange for a long-lived token.
  /// Prefer long-lived; refresh before expiry.
  scopes             String[]            @default([])

  /// Cached Meta health (see lib/health.ts). Recompute on connect + periodically.
  health_json        Json?
  messaging_limit    String?
  is_test_number     Boolean             @default(false)
  can_place_calls    Boolean             @default(false)

  connected_at       DateTime?
  disconnected_at    DateTime?
  created_at         DateTime            @default(now())
  updated_at         DateTime            @updatedAt

  conversations      whatsapp_conversations[]
  webhook_events     whatsapp_webhook_events[]
  calls              whatsapp_calls[]
}

model whatsapp_conversations {
  id               String   @id @default(uuid())
  connection_id    String
  /// Customer WhatsApp id, digits only (no +). Unique per connection.
  customer_phone   String
  contact_name     String?
  profile_image    String?
  last_message     String?
  last_timestamp   DateTime?
  last_direction   WaMessageDirection?
  unread_count     Int      @default(0)
  /// Last inbound from the customer — used for "needs reply" and 24h window.
  last_inbound_at  DateTime?
  last_failed      Boolean  @default(false)
  last_failure_code Int?
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt

  connection       whatsapp_connections @relation(fields: [connection_id], references: [id], onDelete: Cascade)
  messages         whatsapp_messages[]
  labels           whatsapp_conversation_labels[]

  @@unique([connection_id, customer_phone])
  @@index([connection_id, last_timestamp])
  @@index([connection_id, unread_count])
  @@index([connection_id, last_inbound_at])
}

model whatsapp_messages {
  id               String              @id @default(uuid())
  conversation_id  String
  /// Meta wamid. Use for idempotency + reactions + replies.
  wa_message_id    String?
  direction        WaMessageDirection
  from_phone       String
  to_phone         String?
  /// text | image | video | audio | document | sticker | location |
  /// reaction | edit | template | interactive | button | order |
  /// media_placeholder | errors | unsupported | contacts
  type             String              @default("text")
  body             String?
  status           WaMessageStatus     @default(pending)
  read             Boolean             @default(false)
  timestamp        DateTime
  /// Meta media id (not a URL). Browser loads via your proxy.
  media_id         String?
  mime_type        String?
  caption          String?
  /// Quote-reply target wamid
  context_wa_id    String?
  /// Full Cloud API object: reaction, location, template, errors, carousel, echo flags
  metadata         Json                @default("{}")
  created_at       DateTime            @default(now())

  conversation     whatsapp_conversations @relation(fields: [conversation_id], references: [id], onDelete: Cascade)

  @@unique([conversation_id, wa_message_id])
  @@index([conversation_id, timestamp])
  @@index([wa_message_id])
}

model whatsapp_webhook_events {
  id             String   @id @default(uuid())
  connection_id  String?
  /// Dedup: wamid, status id, or sha256 of the payload entry
  event_key      String   @unique
  field          String
  payload        Json
  received_at    DateTime @default(now())

  connection     whatsapp_connections? @relation(fields: [connection_id], references: [id], onDelete: SetNull)
}

model whatsapp_calls {
  id              String   @id @default(uuid())
  connection_id   String
  customer_phone  String
  /// Meta call id
  meta_call_id    String   @unique
  status          String   // ringing | connected | ended | failed | rejected
  direction       String   @default("outbound")
  offer_sdp       String?
  answer_sdp      String?
  error_code      String?
  started_at      DateTime @default(now())
  ended_at        DateTime?

  connection      whatsapp_connections @relation(fields: [connection_id], references: [id], onDelete: Cascade)
  @@index([connection_id, customer_phone])
}

model whatsapp_call_permissions {
  id              String    @id @default(uuid())
  connection_id   String
  customer_phone  String
  granted         Boolean   @default(false)
  expires_at      DateTime?
  updated_at      DateTime  @updatedAt

  @@unique([connection_id, customer_phone])
}

model whatsapp_labels {
  id             String   @id @default(uuid())
  connection_id  String
  meta_label_id  String
  name           String
  color          String?

  @@unique([connection_id, meta_label_id])
}

model whatsapp_conversation_labels {
  conversation_id String
  label_id        String

  conversation    whatsapp_conversations @relation(fields: [conversation_id], references: [id], onDelete: Cascade)

  @@id([conversation_id, label_id])
}
```

Indexes that matter for the inbox tabs:

- **Unread:** `unread_count > 0`
- **Needs reply:** last message inbound (`last_direction = inbound`) and not replied
- **Sent:** last message outbound
- **24h window:** `last_inbound_at > now() - 24 hours` — outside this, session messages fail with **131047**; you need an approved **template** to start a conversation

On **disconnect:** set `status = disconnected`, wipe tokens / ids on `whatsapp_connections`. **Keep conversations and messages** (same as this app: “chats stay, you can connect again”).

---

## 5. Connect flow (same steps as this app)

### 5.1 Browser (`EmbeddedSignupButton`)

1. Load Facebook JS SDK (`https://connect.facebook.net/en_US/sdk.js`).
2. `FB.init({ appId, cookie: true, xfbml: false, version: 'v22.0' })`.
3. Listen for `postMessage` from `facebook.com` / `meta.com` with `type === 'WA_EMBEDDED_SIGNUP'`.
   - `FINISH` / `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` → capture `waba_id`, `phone_number_id`.
   - `CANCEL` / `ERROR` → stop busy state.
4. `FB.login` with **Login for Business**:

```js
{
  config_id: WA_EMBEDDED_CONFIG_ID,
  response_type: 'code',              // required — token is rejected
  override_default_response_type: true,
  extras: {
    setup: {},
    featureType: 'whatsapp_business_app_onboarding', // Coexistence / QR
    sessionInfoVersion: '3',
    version: 'v4',
  },
}
```

5. `response.authResponse.code` + captured ids → `POST /api/whatsapp/connect`.

Popups must be allowed (the console is first-party, so this is easier than an iframe). If the SDK falls back to a **full-page redirect** with `?code=`, the WhatsApp page must finish the same `POST /connect` then strip `code`/`state` from the URL (see `app/page.tsx` `finishRedirectSignup`).

### 5.2 Server `POST /api/whatsapp/connect`

Body:

```json
{ "code": "<oauth code>", "waba_id": "<optional>", "phone_number_id": "<optional>" }
```

Server (never expose `META_APP_SECRET`):

1. Auth the console user; resolve `workspace_id`.
2. Exchange code:

```
POST https://graph.facebook.com/v22.0/oauth/access_token
  client_id, client_secret, code
```

(Embedded Signup sometimes uses the **debug/exchange** path documented for WhatsApp Embedded Signup — follow current Meta docs for “Exchange the code”. Store the **user** or **system-user** token that can manage that WABA.)

3. If `waba_id` / `phone_number_id` missing, list them from the token (`GET /me/businesses` → owned WABAs → phone numbers). Prefer the ids from the `WA_EMBEDDED_SIGNUP` message.
4. `POST /{waba-id}/subscribed_apps` so webhooks hit **your** callback.
5. If the number is not yet Cloud-API registered, `POST /{phone-number-id}/register` with a 6-digit PIN you store hashed (Coexistence numbers may already be registered — handle “already registered”).
6. `GET /{phone-number-id}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput,is_official_business_account,is_pin_enabled`
7. Detect **test number**: display phone like `+1 555` / Meta sandbox.
8. Compute **health** (next section) and save the connection row (`status = connected`, encrypted token, ids, phone, `coexistence_mode = true`).
9. Return:

```json
{
  "success": true,
  "phone": { "displayPhone": "+212 6…", "verifiedName": "Shop name" },
  "coexistenceMode": true,
  "health": { /* WhatsAppHealth — see §6 */ }
}
```

On failure: `{ "success": false, "error": "<human message>" }`.

### 5.3 `GET /api/whatsapp/status`

Used to choose Connect vs Inbox. Never cache.

```json
{
  "connected": true,
  "tokenExpired": false,
  "phone": { "displayPhone": "+212 6…", "verifiedName": "Shop name" },
  "wabaId": "…",
  "phoneNumberId": "…",
  "health": { }
}
```

`connected: true` only for **this workspace’s own** number with a live token. Do **not** invent a “shared platform number”.

If Graph is down: **500/502 with no `connected` boolean** so the UI can show “Couldn’t check”, not Connect.

### 5.4 `POST /api/whatsapp/disconnect`

Clear WABA / phone / token on **this workspace** so status is not connected. Do **not** delete chat history. Do **not** call Graph “connect” with `disconnect: true` (that refreshes, it does not unlink).

Response: `{ "success": true }`.

---

## 6. Health (post-connect checklist)

Types are in `lib/health.ts`. Keep them.

```ts
type HealthLevel = 'ready' | 'pending' | 'blocked' | 'unknown'

interface WhatsAppHealth {
  level: HealthLevel
  registration: HealthLevel
  review: HealthLevel
  businessVerified: boolean
  linkedToPhoneApp: boolean
  testNumber: boolean
  sending: HealthLevel
  canReply: boolean
  blockers: Array<{
    code: number | null
    entity: string
    message: string
    solution: string | null
    scope: 'business_initiated' | 'all'
  }>
  messagingLimitTier: string | null  // TIER_250, TIER_1K, …
  businessId: string | null
  canPlaceCalls?: boolean
}
```

Pull from Graph (phone + WABA + business):

- Phone `code_verification_status` / platform_type → `registration`
- WABA `account_review_status` → `review`
- Business verification status → `businessVerified`
- Coexistence / `smb_app_state_sync` → `linkedToPhoneApp`
- Display number 555 → `testNumber`
- Messaging limit tier
- Account restrictions / payment errors (**141006** payment, **141010** verification cap — 141010 is advisory, not a send hard-block)

`canReply`: true unless sending is blocked for **all** messages. Replies inside 24h often still work when **business-initiated** sending is blocked.

Deep links (`lib/health.ts` `metaLink`):

- Payment: `https://business.facebook.com/billing_hub/payment_settings?business_id=`
- Verification: `https://business.facebook.com/settings/security?business_id=`
- Numbers: `https://business.facebook.com/wa/manage/phone-numbers/`
- Manager: `https://business.facebook.com/wa/manage/home/`

Show Call in the inbox **only** if `health.canPlaceCalls === true`.

---

## 7. APIs the UI needs

All authenticated as the console user. All scoped to that workspace’s `whatsapp_connections` row.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/whatsapp/status` | Connect vs inbox |
| POST | `/api/whatsapp/connect` | Finish Embedded Signup |
| POST | `/api/whatsapp/disconnect` | Unlink |
| GET | `/api/whatsapp/conversations` | List. Query: `offset`, `limit`, `search`, `filter=all\|needs_reply\|unread\|sent` |
| GET | `/api/whatsapp/conversations?phone=` | Thread messages for that customer |
| POST | `/api/whatsapp/send` | Send (see §8) |
| POST | `/api/whatsapp/media/upload` | `multipart/form-data` `file` + `mediaType` → `{ mediaId }` |
| GET | `/api/whatsapp/media/:mediaId` | Stream Meta media (Range for video). Auth via cookie/session, **not** a public URL |
| GET | `/api/whatsapp/webhook` | Meta verify (`hub.mode`, `hub.verify_token`, `hub.challenge`) |
| POST | `/api/whatsapp/webhook` | Inbound events |
| GET | `/api/whatsapp/call-permission?phone=` | `{ granted, expiresAt, callingEnabled }` |
| POST | `/api/whatsapp/call-permission` | `{ phone }` send permission request |
| POST | `/api/whatsapp/calls` | `{ action: "connect", to, sdp }` or `{ action: "terminate", callId }` |
| GET | `/api/whatsapp/calls/:id` | Poll `{ status, answerSdp }` |

### Conversation list item

```ts
{
  phone: string
  contactName: string | null
  lastMessage: string | null
  lastTimestamp: string // ISO
  unread: number
  direction: 'inbound' | 'outbound'
  needsReply?: boolean
  lastInboundAt?: string | null
  lastFailed?: boolean
  lastFailureCode?: number | null
  profileImage?: string | null
}
```

`lastMessage` preview: use `previewLabelForMessage` (`lib/waMedia.ts`) — e.g. `📷 Photo`, `🎙️ Voice message`, not raw JSON.

Pagination:

```ts
{
  conversations: [],
  pagination: { offset, limit, total, hasMore, nextOffset },
  counts: { all, needsReply, unread, sent }
}
```

Counts must be **global** (unfiltered), so tab badges stay correct.

### Thread message

```ts
{
  id: string
  wa_message_id: string
  direction: 'inbound' | 'outbound'
  from_phone: string
  to_phone: string | null
  body: string | null
  type: string
  status: string | null
  timestamp: string
  read: boolean
  metadata: object
  media_url: string | null  // Meta media id; UI prefixes with /api/whatsapp/media/
  template_preview?: {
    language, rtl, headerImageUrl, headerText, body, footerText,
    buttons, buttonText, buttonUrl, carousel
  }
}
```

Before returning a thread, run `collapseMirroredThread` (`lib/threadDedupe.ts`). Phone-sent seller messages arrive twice (outbound + echo inbound). Keep one **outbound** bubble. Never flip a real customer inbound to outbound.

Opening a conversation sets `unread_count = 0` (optimistic on the client is fine; persist on the server too).

---

## 8. Send (`POST /api/whatsapp/send`)

JSON body (from `Inbox.tsx`):

```ts
{ to: string, type: 'text', text: string, replyTo?: string }
{ to, type: 'image' | 'video', mediaId: string, caption?: string }
{ to, type: 'audio', mediaId: string, duration?: number }
{ to, type: 'reaction', reactTo: string, emoji: string }
```

`to` = customer digits. Server sends through Graph:

```
POST /{phone-number-id}/messages
Authorization: Bearer {workspace access token}
```

Examples:

- Text: `{ messaging_product: "whatsapp", to, type: "text", text: { body }, context?: { message_id: replyTo } }`
- Image: `{ type: "image", image: { id: mediaId, caption } }`
- Audio: `{ type: "audio", audio: { id: mediaId } }` — upload as **`audio/ogg`**. Meta rejects `audio/webm` even when the codec is opus. Convert the blob before upload (see `Inbox.tsx` `sendVoice`).
- Reaction: `{ type: "reaction", reaction: { message_id: reactTo, emoji } }`

Insert an **outbound** row immediately (`status: pending` → `sent` when Graph returns `messages[0].id`). Store `wa_message_id`. Return `{ success: true }`.

Media upload:

```
POST /{phone-number-id}/media
  messaging_product=whatsapp, file, type
```

Limits in the UI: images **5MB**, video **16MB**.

**24h window:** if `last_inbound_at` is older than 24h, a session `text`/`image` will fail with **131047**. Surface that error; do not silently eat it. Template sending can wait unless you already have approved templates.

---

## 9. Webhooks (`POST /api/whatsapp/webhook`)

1. Verify `X-Hub-Signature-256` with `META_APP_SECRET`. Reject bad signatures.
2. Respond **200 quickly**. Process async if needed.
3. Route by `entry[].changes[].value.metadata.phone_number_id` → `whatsapp_connections`.
4. Idempotent on `wa_message_id` / status ids (`whatsapp_webhook_events.event_key`).

### Inbound message

Upsert conversation by customer `from` (or `contacts[0].wa_id`). Insert message. Bump `unread_count`, `last_*`. Save `contacts[0].profile.name` as `contact_name`.

Store media as Meta **id**, not a Graph URL (those expire). `GET /{media-id}` then download `url` with the token when the proxy is hit.

History import (`history` field) often has `media_placeholder` / `errors` with **no file**. Keep `type` as-is so the UI shows “📷 Media” / “Message not available” instead of empty text (`tests/waMedia.test.ts`).

Echoes (`smb_message_echoes`): seller sent from the **phone**. Persist as **outbound** (`metadata.from_me` / `echo` / `source` containing `smb_message_echo`). Dedupe against a Cloud API outbound with the same wamid / body within ~4s.

### Statuses

Match `statuses[].id` to `wa_message_id`. Set `sent` / `delivered` / `read` / `failed`. On failed, store:

```json
{ "delivery_error": { "code": 131047, "title": "…" } }
```

UI copy (`Inbox.tsx` `failureTextForCode`):

| Code | Show |
|---|---|
| 131042 / 141006 | Not sent — your WhatsApp account needs a payment method |
| 131026 | Not delivered — number unreachable on WhatsApp |
| 131047 | Not delivered — 24h window closed (needs a template) |
| 131049 / 131050 | Not delivered — recipient limits these messages |
| 130472 | Not delivered — Meta is limiting this number |
| 131053 | Not delivered — media upload error |

Do **not** word 131042 as a customer problem.

### Calls

Store Meta call events; fill `answer_sdp` when the customer answers so the poller can `setRemoteDescription`.

---

## 10. Calling (include — it is in this inbox, not the agent)

`lib/useWhatsAppCall.ts`:

1. `GET call-permission?phone=` — if not granted, `POST call-permission { phone }` (Cloud API call permission request), poll until granted (~2 min) or fail.
2. `getUserMedia({ audio: true })`, WebRTC offer, wait ICE, `POST /calls { action: "connect", to, sdp }`.
3. Poll `GET /calls/:id` for `answerSdp` + `connected`.
4. Hang up: `POST /calls { action: "terminate", callId }`.

Refuse outbound calling when the **seller’s** number is US/CA (`1` + 11 digits), Egypt (`20`), Vietnam (`84`), Nigeria (`234`) — Meta blocks business-initiated calls from those countries.

STUN: `stun:stun.l.google.com:19302`.

---

## 11. UI state machine (must match)

From `app/page.tsx`:

```
load status
  status.connected && phone → Inbox
  just got connectOutcome    → Health if health present, else Inbox
  remembered sessionStorage  → do not show Connect
  status fetch failed        → “Couldn’t check your WhatsApp”
  else                       → Connect card
```

Reconnect: inbox gear → Connect card with **Back to inbox**, green “Connected and sending from {phone}”, **Disconnect**, button “Reconnect or switch number”.

Colors: WhatsApp green `#25D366`, thread background `#efeae2` / dark `#0b141a`, outbound bubble `#d9fdd3` / `#005c4b`. Icons: `@iconify/react` (`solar:*`, `logos:whatsapp-icon`). Dark mode = console theme (Tailwind `dark:`). **Do not** apply this iframe’s `html { zoom: 0.84 }`.

Poll: conversations 5s, thread 3s (`swr` / `useSWRInfinite`).

Star / hide: `localStorage` is acceptable (this app does that). Prefer DB later.

---

## 12. Implementation order

1. Schema + migrations + encrypt helper for tokens.
2. Webhook verify + persist inbound (test with Meta “test webhook”).
3. Status + Connect (Embedded Signup) + Disconnect.
4. Connect card + health screen + sidebar route.
5. Conversation list + thread read + media proxy.
6. Send text / image / video / voice / reply / reaction.
7. Echo / history dedupe, delivery failures, unread / filters.
8. Connection health from Graph.
9. Calling.
10. Polish: reconnect, token expiry banner, test-number warning.

---

## 13. Pitfalls this codebase already paid for

- **`response_type` must be `code`** for Embedded Signup. Default token login is rejected.
- **`featureType: 'whatsapp_business_app_onboarding'`** + webhook history/echo fields, or Meta shows “create a new number”.
- **Never treat a missing `connected` field as false** — that is how a working number looks “gone”.
- **Never cache GET status** (Next.js `fetch` cache will replay “not connected” after a successful signup).
- **Do not toast success and skip health** — payment / 555 / pending activation.
- **Voice = ogg**, not webm.
- **Media URLs from Graph expire** — store ids, proxy downloads.
- **Coexistence duplicates** — collapse echoes (`lib/threadDedupe.ts`).
- **Disconnect is not connect-with-a-flag.** Clear local credentials; chats stay.
- **Tokens never in the client.** Browser only gets the OAuth `code`.
- **Allow Facebook JS SDK domain** on the Meta app or the popup never returns.

---

## 14. Explicitly out of scope

- Anything under `qunvert/` (agents, campaigns, questionnaire, credits, GPT)
- Auto-reply / AI runtime / follow-ups
- FlashManager App Gateway, app-bridge JWT, `fmagt_` install token
- Shared platform WhatsApp number and sunset banner
- Super Admin platform inbox (`contact-info`, connection icons)
- WhatsApp Flows (`WHATSAPP-FLOWS.md`) — not in the current inbox
- Faking disconnect by only clearing UI state while Meta/WABA stays linked

---

## 15. Done when

1. Sidebar **WhatsApp** opens the connect card for a workspace with no number.
2. Embedded Signup (QR / Coexistence) links the WhatsApp Business app number; health screen shows Meta’s verdict.
3. Inbox lists chats, opens a thread, sends text/media/voice, receives inbound via webhook, shows ticks/failures.
4. Messages sent on the phone appear once, on the business side.
5. Disconnect unlinks; chats remain; connect again works.
6. No AI agent UI or backend.

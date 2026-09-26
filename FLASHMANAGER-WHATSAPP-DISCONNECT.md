# WhatsApp unlink for embedded apps

We need a WhatsApp unlink API that embedded apps can call. Please implement it on FlashManager, not in the WhatsApp Business app.

## Why this is required

WhatsApp Business and Qunvert run in an iframe on `apps.flash-manager.com`, inside `platform.flash-manager.com` / `dev.flash-manager.com`.

The host already mints a short-lived app-bridge JWT via `POST /api/app-gateway/session-token` and posts it as `fm:token`. That JWT is:

- `iss`: `flashmanager-app-bridge`
- `aud`: `whatsapp-business`
- scopes: `whatsapp:connect`, `whatsapp:read`, `whatsapp:write`

The app also has a longer-lived grant token (`fmagt_…`) from install.

Those tokens already work for:

- `GET /api/app-gateway/v1/whatsapp/status`
- `POST /api/app-gateway/v1/whatsapp/connect`
- `GET /api/app-gateway/v1/whatsapp/conversations`
- `POST /api/app-gateway/v1/whatsapp/send`

They do **not** work for unlink.

What exists today:

- `POST /api/whatsapp/disconnect` — this is the real unlink used by the FlashManager UI. It only accepts a **staff JWT** (`localStorage.staff_token` on the host). App-bridge JWTs and grant tokens both return `401 {"error":"Invalid token"}`.
- `POST /api/app-gateway/v1/whatsapp/disconnect` — **does not exist** (HTML 404).
- `POST /v1/whatsapp/connect` cannot be reused as unlink. Sending `disconnect: true` / `action: "disconnect"` still requires `phone_number_id`, `waba_id`, or `access_token` and talks to Meta Graph. It refreshes a connection; it does not clear one.

The iframe cannot use the staff session:

- `staff_token` is host `localStorage` only, not a cookie.
- The iframe is cross-origin, so it cannot read `window.parent.localStorage`.
- The host embed (`/apps/[appId]`) only handles `fm:ready`, `fm:token:request`, `fm:theme:request`, `fm:navigate`, `fm:nav-stack`, `fm:back:handled`. There is no disconnect message.
- The apps VPS can reach FlashManager internally, but it cannot reach `https://platform.flash-manager.com` or `https://dev.flash-manager.com` on `:443`. Browser-only workarounds that depend on the public host are not enough.

Do not ask the app to send the staff JWT to the iframe. That would leak a full FlashManager login into a third-party origin.

Google Sheets already has the correct pattern: the iframe calls `POST /api/google-sheets/disconnect` with the app-bridge `Authorization: Bearer` token. WhatsApp needs the same thing.

This is not optional UI. Until FlashManager exposes unlink for app tokens, the seller can connect a number from the app but cannot disconnect it. We will not fake disconnect in the iframe — FlashManager would still own the WABA and keep sending.

## What to build (preferred)

Add:

```http
POST /api/app-gateway/v1/whatsapp/disconnect
```

Auth: same as the other WhatsApp gateway routes.

- `Authorization: Bearer <app-bridge JWT or fmagt_ grant>`
- `X-App-Id` / `X-App-Secret` as already required by the gateway

Authorize with existing scopes `whatsapp:write` and/or `whatsapp:connect`.

Behavior: run the **same unlink** as `POST /api/whatsapp/disconnect` for that owner — clear the connected WABA / phone number / coexistence link so `GET /v1/whatsapp/status` comes back not-connected / not `mode: "own"`.

Response:

- success: `200 { "success": true }`
- failure: JSON `{ "error": "..." }` with the real reason

Do not send this through Meta Graph as a connect/refresh.

## Optional extra (nice, not sufficient alone)

In the apps embed host, handle:

```js
// from iframe: { source: "fm-app", type: "fm:whatsapp:disconnect" }
// reply: { source: "fm-host", type: "fm:whatsapp:disconnected", success, error }
```

The host already has `localStorage.staff_token` in that file. It can call `/api/whatsapp/disconnect` with that token and post the result back. Useful as a UI helper. Still add the gateway route — background jobs and the apps server use the grant token, not the parent tab.

## How to verify

1. Connect a test WhatsApp number from the WhatsApp Business app.
2. `GET /api/app-gateway/v1/whatsapp/status` with the app token → `connected: true`, `mode: "own"`.
3. `POST /api/app-gateway/v1/whatsapp/disconnect` with the **same app token** (not a staff JWT).
4. Status again → no longer own-connected.
5. Confirm a staff JWT still works on `/api/whatsapp/disconnect` as before.
6. Confirm an app token still gets `401 Invalid token` on `/api/whatsapp/disconnect` (that route should stay staff-only).

## Out of scope

- Do not change Meta Embedded Signup.
- Do not put `staff_token` into the iframe.
- Do not tell the WhatsApp app to delete local state and pretend it unlinked.

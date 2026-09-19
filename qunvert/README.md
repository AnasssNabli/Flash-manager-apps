# Qunvert

Qunvert is a WhatsApp AI agent that automates customer conversations, creates product-aware replies, and runs campaigns through FlashManager's WhatsApp Business integration.

## Workspace

Qunvert is kept inside `whatsapp-business/qunvert` so the WhatsApp Business app and its AI-agent companion can be opened together.

## Database

Qunvert uses the WhatsApp Business PostgreSQL database with its own `qunvert` schema. This keeps Qunvert's agent, campaign, and reply-log tables isolated from the parent app's tables while both apps use the same database.

WhatsApp conversations and Meta credentials are not stored in this app database. They remain in FlashManager and must be accessed through the App Gateway.

## Development

```bash
npm install
npm run db:push
npm run dev
```

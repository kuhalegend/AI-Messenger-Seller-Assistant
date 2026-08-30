# AI Messenger Seller Assistant

AI-assisted seller workflow for personal Facebook Messenger.

## MVP goal

A seller keeps using a normal personal Facebook account. Incoming Messenger chats are detected by a Chrome extension, classified, and routed through a backend workflow.

- Clear sales inquiry -> eligible for controlled AI auto-reply after testing.
- Personal / important / sensitive / uncertain -> AI draft only; seller reviews, edits, or sends manually.
- Seller manual activity always has priority over AI.
- Product, price, stock, variants, promo, COD, shipping and discounts must come from verified seller data.

## Architecture

`Facebook Messenger -> Chrome Extension -> Supabase -> n8n -> Product Retrieval / AI -> Validation -> Draft or Outbound Queue -> Chrome Extension -> Messenger`

## Current build order

1. Supabase MVP backend - created.
2. Chrome extension foundation - in progress.
3. Messenger bridge - detect incoming/outgoing messages without auto-sending.
4. n8n classifier - SALES / PERSONAL / IMPORTANT / UNCERTAIN.
5. Product retrieval and conversation memory.
6. AI Sales Agent with verified facts.
7. Draft approval and human takeover.
8. Controlled auto-reply.
9. Hetzner persistent Chrome test.
10. Multi-seller scaling only after the single-account MVP is stable.

## Safety / repository rules

This repository is public during development. Never commit:

- Supabase service-role / secret keys
- AI provider secret keys
- n8n credentials
- Facebook passwords, cookies, session tokens or private GraphQL/session data
- `.env.local`
- extension production `config.js`

Only public/publishable configuration may be used in client-side code, and database authorization must remain enforced by Supabase RLS.

## Important platform limitation

Personal Facebook Messenger automation does not use an official open third-party Meta API for personal accounts. The Messenger bridge therefore depends on browser automation around the seller's logged-in browser session and must be treated as change-sensitive. Auto-send remains disabled until message detection, human takeover, deduplication and reply safety are proven in live testing.

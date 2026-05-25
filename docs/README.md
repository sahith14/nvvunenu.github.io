# Nuvvu Nenu — Project Docs

## Files in this folder

| File | Purpose |
|---|---|
| `PRODUCT_ROADMAP.md` | Vision, subscription tiers, prioritized feature backlog (P0–P4), tech debt, metrics. |
| `UPGRADE.md` | Hard rules + the migration recipe every module must follow (state, storage, snapshots, cleanup). |
| `CLAUDE_OPUS_4_7_PROMPT.md` | Master "fix everything, no CSS glitches" prompt; the full audit checklist. |
| `env.example.txt` | Template `.env` showing which keys are needed. The real `env.txt` (with live keys) is git-ignored. |

## Required environment

Copy `env.example.txt` into project root as `.env` (or paste the values into
`window.__SUPABASE_URL__` / `window.__SUPABASE_ANON_KEY__` / etc. before the
module scripts in `app.html`). The `.env` is in `.gitignore`.

| Var | Used by | Public-safe? |
|---|---|---|
| `VITE_FIREBASE_*` | Firebase Auth + Firestore (`firebase.js`) | Yes — scoped by Firestore rules |
| `VITE_STRIPE_PUBLIC_KEY` | Subscription paywall (`modules/subscription.js`) | Yes — `pk_live_*` is publishable |
| `VITE_SUPABASE_URL` | Media uploads (`utils/supabase.js`) | Yes |
| `VITE_SUPABASE_ANON_KEY` | Media uploads | Yes — bucket policy enforces access |
| `STRIPE_SECRET_KEY` | Server-side checkout (`server/`) | NO — server only |
| `RAZORPAY_KEY_SECRET` | Server-side checkout (`server/`) | NO — server only |
| `OPENAI_API_KEY` | Optional: real AI replies (`services/aiReply.js` upgrade) | NO — server only |

## Heads-up

- `docs/env.txt` is the **historical** file from the BROKEN snapshot. It
  contains live publishable keys. It is ignored by git via `.gitignore`. Do
  not commit it. If you need the values on a fresh clone, retrieve them from
  your password manager / Firebase / Stripe / Supabase dashboards.
- The Firebase project used by this app is **`nuvvunenu-cf326`**. The keys in
  the historical `env.txt` reference an older project (`zenomedia-work`) and
  should be regenerated against `nuvvunenu-cf326` if you want a fresh `.env`.

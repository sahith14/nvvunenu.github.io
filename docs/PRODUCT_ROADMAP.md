# BondSync / Nuvvu Nenu — Product Roadmap

## 1. Vision (Pivot)
BondSync / Nuvvu Nenu is a **couple-centric shared space**, not a generic social
app. Core thesis: people stay when they have a reason to open the app
*together*. The feed exists for discovery, but the heart of the app is the
private couple home, calls, shared memories, and rituals.

---

## 2. Subscription Tiers

| Plan | Price | Core Value |
|---|---|---|
| **Free** | $0 | Unlimited partner messages, voice notes (10/day), basic memories (max 30) |
| **Together+** | $4.99/mo | Unlimited voice notes, HD video calls, sleep-together mode, premium themes, couple insights, monthly recap, unlimited memories |
| **Forever** | $12.99/mo | Everything in Together+, custom avatar frames, priority support, cinematic recaps, relationship coach, first access to new features |

Plans are enforced through `services/subscriptionService.js` and gated through
`services/featureGate.js`.

---

## 3. Prioritized Feature Backlog

### P0 — Production Blockers
- [x] WebRTC call bug: ICE candidate buffering + ASC signaling order + stale cleanup
- [x] Firestore rules: subscription paths, couple meta, pokes
- [ ] Feature gates wired into messages, posts, themes, stories, calls

### P1 — Couple Home (Live Now)
- [x] Couple Home hero card on home (days together, bond score, mood, quick actions)
- [x] Bond score calculation based on messages + memories + pokes
- [x] Mood sharing between partners
- [x] "Thinking of you" poke with 3-minute cooldown

### P2 — Monetization & Retention
- [ ] Stripe / in-app purchase checkout integration
- [ ] Subscription badge on profile
- [ ] Anniversary reminders + push notifications
- [ ] Shared countdown widget (e.g., "Days until we meet")

### P3 — Discovery & Growth
- [ ] Instagram-style explore grid with trending couple content
- [ ] Couple challenges / quests (e.g., "Send a voice note every day for 7 days")
- [ ] Public couple profiles (opt-in) for community discovery

### P4 — Deep Couple Features
- [ ] Shared calendar with auto-sync from chat date mentions
- [ ] Love language quiz + personalized suggestions
- [ ] Shared bucket list with progress tracking
- [ ] Private photo vault (end-to-end encrypted couple album)

---

## 4. Technical Debt
- Move ICE server config to environment / remote config
- Add call analytics (connect time, drop rate)
- Implement proper E2EE for sensitive couple data
- Add server-side rate limiting for pokes & usage counters

---

## 5. Metrics to Track
1. **Call connect rate** — target > 85%
2. **DAU / MAU couple ratio** — how often both partners open in same day
3. **Feature adoption** — % of couples using mood, poke, check-in
4. **Conversion funnel** — free → Together+ → Forever
5. **Churn signals** — days since last mutual activity

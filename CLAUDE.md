# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
node bot.js          # start the bot (also used for production on Railway)
node --check bot.js  # syntax-check without running
```

There are no tests, no lint step, and no build step. The only runtime dependency check worth doing before shipping is `node --check <file>`.

## Architecture

Four files, single Node.js process:

| File | Role |
|------|------|
| `bot.js` | All Telegram handlers, conversation FSM, game logic (~2200 lines) |
| `database.js` | SQLite abstraction via better-sqlite3 (fully synchronous) |
| `payments.js` | Blockchain polling (TON, BNB, USDT), CoinGecko prices |
| `config.js` | All numeric constants and env-var defaults |

**Deployment:** Railway, `node bot.js`. Required env vars: `BOT_TOKEN`, `ADMIN_IDS` (comma-separated), `WALLET_TON`, `WALLET_BEP20`, `PORT`. The bot starts an HTTP keep-alive server on `PORT` alongside the Telegram polling loop.

**Database:** `cryptotaskbot.db` (SQLite, WAL mode). All `database.js` functions are synchronous — never `await` a DB call. The `db.db` property exposes the raw better-sqlite3 instance for raw SQL when needed.

## Two-bucket balance system

Every user has two independent balances:

- `balance` — earnable from tasks and games; **withdrawable**
- `deposit_balance` — funded by crypto deposits; **not withdrawable**, used to pay for campaigns and play games

Always use these helpers, never raw `updateBalance` for financial flows:

| Function | Moves money to / from |
|----------|-----------------------|
| `debitSmart(uid, amount, type, desc)` | Drains `deposit_balance` first, then `balance`; returns `false` if insufficient — **always check the return value** |
| `creditEarnings(uid, amount, type, desc)` | Adds to `balance` (withdrawable gains) |
| `creditDeposit(uid, amount)` | Adds to `deposit_balance` |

`getTotalBalance(uid)` returns `balance + deposit_balance`.

## Conversation FSM

State is stored in the in-memory `states` map (lost on process restart):

```js
setState(uid, "state_name", { ...data })
getState(uid)   // returns { state, data, ts } or null
clearState(uid)
```

States expire after 30 minutes. The `bot.on("message")` handler dispatches on `st.state` strings. Navigation buttons always call `clearState(uid)` before delegating.

The `callback_query` handler dispatches first (captcha, task actions, game bets, admin actions) then falls through to an `if (!isAdmin(uid)) return` guard that protects all admin callbacks.

## Task duration encoding (design debt)

Task duration is stored in `task.description` as freetext:
- Channel/group: `"Reste abonné 24h minimum"` — parsed with `/(\\d+)h/`
- Bot/miniapp: `"Temps d'attente : 30s"` — uses `bot_wait_seconds` setting

If you change the description format, update all three parse sites: `showTasksByType` (~line 700), `handleStartTask` (~line 757), `handleVerifyTask` (~line 824).

## Admin callback pattern

Inline buttons use prefixed `callback_data` strings that are handled inside `bot.on("callback_query")`. All admin-only callbacks are guarded by `if (!isAdmin(uid)) return` at ~line 489. Pattern:

- `apr_task_<id>` / `rej_task_<id>` — approve/reject campaign
- `conf_dep_<id>` / `rej_dep_<id>` — confirm/reject deposit
- `pay_wd_<id>` / `rej_wd_<id>` — pay/reject withdrawal
- `apr_proof_<id>` / `rej_proof_<id>` — approve/reject task proof
- `set_<key>` — triggers FSM state `setval_<key>` to update a setting

## Auto-deposit flow

`payments.startAutoDepositChecker` polls every 60 s. When a blockchain transaction is detected:
1. `db.confirmDeposit()` is called — this credits `balance` (earnable)
2. The `onConfirmed` callback in `bot.js` immediately corrects this by calling `updateBalance(..., -amount)` then `creditDeposit(..., amount)` to move funds into `deposit_balance`

The correction uses `updateBalance` return value to handle partial-spend races. Do not remove step 2 — the intent is that deposited funds land in `deposit_balance`, not `balance`.

## Settings system

All runtime-configurable values live in the `settings` DB table. `db.getSetting(key, default)` and `db.setSetting(key, value)` are the interface. The admin panel exposes a subset of keys (see `botSettings()` and `gameSettings()` in bot.js). Startup code in bot.js sets defaults for missing keys but also resets some values if they exceed thresholds — be careful adding new game multipliers there.

## Financial transaction invariants

- Every balance change must have a corresponding row in the `transactions` table (handled by `updateBalance` and `debitSmart`/`creditEarnings`)
- Debit + side-effect (INSERT task, INSERT game record) must be wrapped in `db.db.transaction(fn)()` to be atomic
- `updateBalance` returns `false` and makes no change when the result would go below zero — callers must check this

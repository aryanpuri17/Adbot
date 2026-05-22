// ============================================
// 🤖 ADCRYPTON BOT — Version PRO Finale
// Captcha, devise multi, concours structurés, preuves photo
// ============================================

"use strict";

const TelegramBot = require("node-telegram-bot-api");
const config      = require("./config");
const db          = require("./database");
const payments    = require("./payments");

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

// ─────────────────────────────────────────────
//  ÉTAT DE CONVERSATION
// ─────────────────────────────────────────────
const states = {};
function setState(uid, state, data = {}) { states[uid] = { state, data, ts: Date.now() }; }
function getState(uid)  { return states[uid] || null; }
function clearState(uid){ delete states[uid]; }
setInterval(() => {
  const now = Date.now();
  for (const k in states) if (now - states[k].ts > 30 * 60 * 1000) delete states[k];
}, 10 * 60 * 1000);

const ADMIN_UID = config.ADMIN_IDS[0];
let botInfo = null;

// ─────────────────────────────────────────────
//  MIGRATION DB : ajouter deposit_balance si absent
// ─────────────────────────────────────────────
try {
  const cols = db.db.prepare("PRAGMA table_info(users)").all();
  if (!cols.find(c => c.name === "deposit_balance")) {
    db.db.prepare("ALTER TABLE users ADD COLUMN deposit_balance REAL DEFAULT 0").run();
    console.log("✅ Migration: deposit_balance ajouté");
  }
} catch (e) { console.error("Migration error:", e.message); }

// ─────────────────────────────────────────────
//  BALANCE SÉPARÉE (retirable + dépôt)
// ─────────────────────────────────────────────

// Récupère solde total (retirable + dépôt)
function getTotalBalance(uid) {
  const u = db.getUser(uid);
  if (!u) return 0;
  return (u.balance || 0) + (u.deposit_balance || 0);
}

// Débite intelligent : d'abord du dépôt, puis de la balance retirable
// Utilisé pour jeux et création de campagnes
function debitSmart(uid, amount, type, description) {
  const u = db.getUser(uid);
  if (!u) return false;
  const total = (u.balance || 0) + (u.deposit_balance || 0);
  if (total < amount) return false;

  let remainingToTake = amount;
  // 1) Prendre du dépôt d'abord
  const fromDeposit = Math.min(u.deposit_balance || 0, remainingToTake);
  if (fromDeposit > 0) {
    const newDep = Math.round(((u.deposit_balance || 0) - fromDeposit) * 100) / 100;
    db.db.prepare("UPDATE users SET deposit_balance=? WHERE user_id=?").run(newDep, uid);
    remainingToTake -= fromDeposit;
  }
  // 2) Puis de la balance retirable
  if (remainingToTake > 0) {
    db.updateBalance(uid, -remainingToTake, type, description);
  } else {
    // Ajouter quand même une transaction pour l'historique
    db.db.prepare("INSERT INTO transactions (user_id, type, amount, description) VALUES (?,?,?,?)")
      .run(uid, type, -amount, description);
  }
  return true;
}

// Crédite la balance retirable (gains, rewards)
function creditEarnings(uid, amount, type, description) {
  db.updateBalance(uid, amount, type, description);
}

// Crédite le dépôt (non retirable)
function creditDeposit(uid, amount) {
  const u = db.getUser(uid);
  if (!u) return;
  const newDep = Math.round(((u.deposit_balance || 0) + amount) * 100) / 100;
  db.db.prepare("UPDATE users SET deposit_balance=?, total_deposited=total_deposited+? WHERE user_id=?").run(newDep, amount, uid);
}

// ─────────────────────────────────────────────
//  UTILITAIRES
// ─────────────────────────────────────────────
function isAdmin(uid) { return config.ADMIN_IDS.includes(uid); }

// Devise — peut différer pour affichage vs transactions
function getDisplayCurrency() { return db.getSetting("display_currency", "USD"); }
function getTransactionCurrency() { return db.getSetting("transaction_currency", "USD"); }

// Conversion via CoinGecko (utilise payments.js)
async function convertFromUSD(amountUSD, targetCurrency) {
  if (targetCurrency === "USD" || targetCurrency === "USDT") return amountUSD;
  try {
    const prices = await payments.getLivePrices();
    if (targetCurrency === "TON") return Math.round((amountUSD / prices.ton) * 10000) / 10000;
    if (targetCurrency === "BNB") return Math.round((amountUSD / prices.bnb) * 100000) / 100000;
  } catch {}
  return amountUSD;
}

function currencySymbol(cur) {
  if (cur === "USD") return "$";
  if (cur === "USDT") return " USDT";
  if (cur === "TON") return " TON";
  if (cur === "BNB") return " BNB";
  return " " + cur;
}

// Format avec devise d'affichage (synchrone — utilise un cache)
const conversionCache = { ton: 2, bnb: 600, lastUpdate: 0 };
async function updateConversionCache() {
  try {
    const prices = await payments.getLivePrices();
    conversionCache.ton = prices.ton || 2;
    conversionCache.bnb = prices.bnb || 600;
    conversionCache.lastUpdate = Date.now();
  } catch {}
}
setInterval(updateConversionCache, 60000);
updateConversionCache();

function fmt(amountUSD) {
  // Devise interne TOUJOURS en USD
  return `${Number(amountUSD || 0).toFixed(2)}$`;
}

function fmtUSD(amount) {
  return `${Number(amount || 0).toFixed(2)}$`;
}

function esc(t) {
  return String(t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function fmtDate(d) {
  if (!d) return "N/A";
  return new Date(d).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function fmtDuration(seconds) {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.ceil(seconds / 3600)}h`;
  return `${Math.ceil(seconds / 86400)}j`;
}

async function isMember(channel, uid) {
  try {
    const m = await bot.getChatMember(channel, uid);
    return ["member","administrator","creator"].includes(m.status);
  } catch { return false; }
}

function maintenance(uid) {
  if (db.getSetting("maintenance_mode","false") === "true" && !isAdmin(uid))
    return db.getSetting("maintenance_message", config.MAINTENANCE_MESSAGE);
  return null;
}

function creditAdmin(amount, source) {
  if (ADMIN_UID && amount > 0)
    db.updateBalance(ADMIN_UID, amount, "platform_profit", `Profit ${source}`);
}

// ─────────────────────────────────────────────
//  CLAVIERS
// ─────────────────────────────────────────────

function KB(rows)  { return { keyboard: rows, resize_keyboard: true, one_time_keyboard: false }; }
function KBI(rows) { return { inline_keyboard: rows }; }

function KB_MAIN(uid) {
  const rows = [
    ["💳 Balance",  "📋 Tâches"],
    ["🎮 Jeux",     "🏆 Concours"],
    ["👥 Parrainage","🎫 Support"],
    ["⚙️ Paramètres"],
  ];
  if (isAdmin(uid)) rows.push(["👑 Admin"]);
  return KB(rows);
}

const KB_BALANCE  = KB([["💳 Déposer","🏧 Retirer"],["📋 Historique"],["🏠 Accueil"]]);
const KB_TASKS    = KB([["📢 Canaux","👥 Groupes"],["🤖 Bots"],["➕ Créer Campagne","🎁 Bonus Quotidien"],["🏠 Accueil"]]);
const KB_GAMES    = KB([["🎡 Roue Fortune"],["🎲 Dés","🪙 Pile/Face"],["🏆 Jackpot","🔢 Devinette"],["🏠 Accueil"]]);
const KB_PARRAIN  = KB([["🔗 Mon Lien"],["🏠 Accueil"]]);
const KB_ADMIN    = KB([
  ["📊 Stats","⚙️ Config Bot"],
  ["🎮 Config Jeux"],
  ["📋 Tâches Admin","📸 Preuves"],
  ["🏧 Retraits","💳 Dépôts"],
  ["👥 Users","🎫 Tickets"],
  ["🏆 Concours Admin","📢 Broadcast"],
  ["💰 Mod. Solde","⛔ Ban/Unban"],
  ["🏠 Accueil"]
]);
const KB_CANCEL   = KB([["❌ Annuler"]]);

// ─────────────────────────────────────────────
//  CAPTCHA
// ─────────────────────────────────────────────

function generateCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const ops = ["+", "-"];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let answer;
  if (op === "+") answer = a + b;
  else answer = a - b;

  // 3 fausses réponses
  const choices = new Set([answer]);
  while (choices.size < 4) {
    choices.add(answer + Math.floor(Math.random() * 7) - 3);
  }
  const shuffled = [...choices].sort(() => Math.random() - 0.5);

  return { question: `${a} ${op} ${b} = ?`, answer, choices: shuffled };
}

async function sendCaptcha(cid, uid) {
  const captcha = generateCaptcha();
  setState(uid, "captcha", { answer: captcha.answer, attempts: 0 });
  const rows = [captcha.choices.map(c => ({ text: `${c}`, callback_data: `cap_${c}` }))];
  return bot.sendMessage(cid,
    `🛡️ <b>VÉRIFICATION ANTI-BOT</b>\n\n` +
    `Pour continuer, résous ce calcul :\n\n` +
    `<b>${captcha.question}</b>`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

// ─────────────────────────────────────────────
//  VÉRIFICATION CANAUX OBLIGATOIRES
// ─────────────────────────────────────────────

async function checkRequiredChannels(uid) {
  const ch1 = db.getSetting("official_channel", "");
  const ch2 = db.getSetting("payment_channel", "");
  const channels = [ch1, ch2].filter(c => c && c.length > 1);
  for (const ch of channels) {
    if (!await isMember(ch, uid)) return false;
  }
  return true;
}

function channelJoinButtons() {
  const ch1 = db.getSetting("official_channel", "");
  const ch2 = db.getSetting("payment_channel", "");
  const btns = [];
  if (ch1) btns.push([{ text: `📢 Canal Officiel`, url: `https://t.me/${ch1.replace("@","")}` }]);
  if (ch2) btns.push([{ text: `💸 Canal Paiements`, url: `https://t.me/${ch2.replace("@","")}` }]);
  btns.push([{ text: "✅ J'ai rejoint — Continuer", callback_data: "check_join" }]);
  return KBI(btns);
}

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────

bot.onText(/\/start(.*)/, async (msg, match) => {
  const uid   = msg.from.id;
  const cid   = msg.chat.id;
  const maint = maintenance(uid);
  if (maint) return bot.sendMessage(cid, maint);

  // Referral via ID Telegram
  let refBy = null;
  const param = (match[1] || "").trim();
  if (param.startsWith("ref_")) {
    const refId = parseInt(param.replace("ref_",""));
    if (refId && refId !== uid && db.getUser(refId)) refBy = refId;
  }

  let user = db.getUser(uid);
  const isNew = !user;
  if (!user) {
    user = db.createUser(uid, msg.from.username, msg.from.first_name, msg.from.last_name, refBy);
    if (refBy) {
      const bonus = parseFloat(db.getSetting("referral_bonus", config.REFERRAL_BONUS));
      bot.sendMessage(refBy,
        `🎉 <b>Nouveau filleul !</b>\n👤 ${esc(msg.from.first_name)}\n💰 +${fmt(bonus)} crédité !`,
        { parse_mode: "HTML" }).catch(() => {});
    }
  } else {
    db.updateUser(uid, { username: msg.from.username || "", first_name: msg.from.first_name || "" });
    user = db.getUser(uid);
  }

  if (user.is_banned) return bot.sendMessage(cid, `⛔ Compte banni.\n${user.ban_reason || ""}`);
  clearState(uid);

  // Captcha pour nouveaux users non vérifiés
  if (!user.is_verified) {
    await bot.sendMessage(cid,
      `👋 <b>Bienvenue sur ${db.getSetting("bot_name","ADCRYPTON")} !</b>\n\n🛡️ Une vérification rapide d'abord :`,
      { parse_mode: "HTML" });
    return sendCaptcha(cid, uid);
  }

  // Canaux obligatoires
  if (!await checkRequiredChannels(uid)) {
    return bot.sendMessage(cid,
      `👋 <b>${db.getSetting("bot_name","ADCRYPTON")}</b>\n\n📢 Rejoins nos canaux pour continuer :`,
      { parse_mode: "HTML", reply_markup: channelJoinButtons() });
  }

  sendHome(cid, user);
});

// ─────────────────────────────────────────────
//  CALLBACKS
// ─────────────────────────────────────────────

bot.on("callback_query", async (q) => {
  const uid  = q.from.id;
  const cid  = q.message.chat.id;
  const mid  = q.message.message_id;
  const data = q.data;

  bot.answerCallbackQuery(q.id).catch(() => {});

  let user = db.getUser(uid);
  if (!user) user = db.createUser(uid, q.from.username, q.from.first_name, q.from.last_name);
  if (user.is_banned) return;

  // Captcha
  if (data.startsWith("cap_")) {
    const answer = parseInt(data.replace("cap_",""));
    const st = getState(uid);
    if (!st || st.state !== "captcha") return;
    if (answer === st.data.answer) {
      db.updateUser(uid, { is_verified: 1 });
      clearState(uid);
      await bot.editMessageText("✅ <b>Vérifié !</b>", { chat_id: cid, message_id: mid, parse_mode: "HTML" });
      if (!await checkRequiredChannels(uid)) {
        return bot.sendMessage(cid,
          `📢 Rejoins nos canaux pour continuer :`,
          { parse_mode: "HTML", reply_markup: channelJoinButtons() });
      }
      return sendHome(cid, db.getUser(uid));
    } else {
      st.data.attempts = (st.data.attempts || 0) + 1;
      if (st.data.attempts >= 3) {
        clearState(uid);
        db.banUser(uid, true, "Échec captcha");
        return bot.editMessageText("⛔ Trop d'essais. Compte bloqué.", { chat_id: cid, message_id: mid });
      }
      const captcha = generateCaptcha();
      st.data.answer = captcha.answer;
      const rows = [captcha.choices.map(c => ({ text: `${c}`, callback_data: `cap_${c}` }))];
      return bot.editMessageText(
        `❌ Mauvaise réponse (${st.data.attempts}/3)\n\nRéessaie :\n\n<b>${captcha.question}</b>`,
        { chat_id: cid, message_id: mid, parse_mode: "HTML", reply_markup: KBI(rows) });
    }
  }

  if (data === "check_join") {
    if (await checkRequiredChannels(uid)) {
      await bot.deleteMessage(cid, mid).catch(() => {});
      return sendHome(cid, user);
    }
    return bot.answerCallbackQuery(q.id, { text: "❌ Rejoins tous les canaux d'abord !", show_alert: true }).catch(() => {});
  }

  // ─── Tâches ───
  if (data.startsWith("start_task_"))    return handleStartTask(cid, uid, parseInt(data.replace("start_task_","")), user);
  if (data.startsWith("verify_task_"))   return handleVerifyTask(cid, uid, parseInt(data.replace("verify_task_","")), user);
  if (data.startsWith("send_proof_"))    {
    const tid = parseInt(data.replace("send_proof_",""));
    setState(uid, "task_proof", { taskId: tid });
    return bot.sendMessage(cid, "📸 Envoie une <b>capture d'écran</b> comme preuve :", { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // ─── Jeux ───
  if (data === "spin_free")  return doSpin(cid, mid, uid, true,  user);
  if (data === "spin_paid")  return doSpin(cid, mid, uid, false, user);
  if (data.startsWith("dice_")) return playDice(cid, uid, parseFloat(data.replace("dice_","")), user);
  if (data.startsWith("cf_choice_")) {
    const parts = data.split("_");
    return playCoinflip(cid, uid, parts[2], parseFloat(parts[3]), user);
  }
  if (data === "jackpot_play") return playJackpot(cid, uid, user);
  if (data.startsWith("guess_")) return playGuess(cid, uid, parseInt(data.replace("guess_","")), user);
  if (data.startsWith("cf_bet_")) {
    const bet = parseFloat(data.replace("cf_bet_",""));
    user = db.getUser(uid);
    if (user.balance < bet) return bot.editMessageText("❌ Solde insuffisant.", { chat_id: cid, message_id: mid });
    return bot.editMessageText(
      `🪙 <b>Mise : ${fmt(bet)}</b>\n\nChoisis :`,
      { chat_id: cid, message_id: mid, parse_mode: "HTML",
        reply_markup: KBI([[
          { text: "🟡 PILE", callback_data: `cf_choice_pile_${bet}` },
          { text: "⚫ FACE", callback_data: `cf_choice_face_${bet}` }
        ]]) });
  }

  // ─── Concours ───
  if (data.startsWith("join_ga_")) {
    const gaId = parseInt(data.replace("join_ga_",""));
    const r = db.enterGiveaway(gaId, uid, 1);
    if (r && r.success) return bot.sendMessage(cid, "✅ Inscrit au concours !\nLe tirage sera fait à la fin par l'admin.");
    const reasonMap = { not_active: "Concours terminé", already_entered: "Déjà inscrit", insufficient_balance: "Solde insuffisant", max_participants: "Concours plein" };
    return bot.sendMessage(cid, `❌ ${reasonMap[r?.reason] || "Impossible"}.`);
  }

  // ─── Dépôts ───
  if (data.startsWith("dep_")) {
    const method = data.replace("dep_","");
    const m = config.DEPOSIT_METHODS[method];
    if (!m) return;
    setState(uid, "dep_amount", { method });
    return bot.sendMessage(cid,
      `💳 <b>DÉPÔT ${m.name}</b>\n\n📌 Minimum : <b>${m.minAmount} ${m.symbol}</b>\n\nEnvoie le montant :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // ─── Retraits ───
  if (data.startsWith("wd_")) {
    const method = data.replace("wd_","");
    setState(uid, "wd_wallet", { method });
    return bot.sendMessage(cid,
      `🏧 <b>RETRAIT ${config.WITHDRAWAL_METHODS[method]?.name}</b>\n\nEnvoie ton adresse wallet :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // ─── Créer Campagne ───
  if (data.startsWith("ct_type_")) {
    const type = data.replace("ct_type_","");
    setState(uid, "ct_link", { type });
    const typeLabel = type === "channel" ? "canal" : type === "group" ? "groupe" : "bot";
    return bot.sendMessage(cid,
      `➕ <b>NOUVELLE CAMPAGNE ${typeLabel.toUpperCase()}</b>\n\n` +
      `🔗 Envoie le lien Telegram de ton ${typeLabel} :\n\n` +
      `Exemple : <code>https://t.me/Mon${typeLabel === "canal" ? "Canal" : typeLabel === "groupe" ? "Groupe" : "Bot"}</code>`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // Choix de la durée (canal/groupe)
  if (data.startsWith("ct_dur_")) {
    const hours = parseInt(data.replace("ct_dur_",""));
    const st    = getState(uid);
    if (!st) return;
    st.data.durationHours = hours;
    const minKey = `min_price_${hours}h`;
    const minPrice = parseFloat(db.getSetting(minKey, "0.01"));
    setState(uid, "ct_reward", st.data);
    return bot.sendMessage(cid,
      `💰 <b>Récompense par personne ($)</b>\n\n` +
      `Durée choisie : <b>${hours}h</b>\n` +
      `Minimum : <b>${minPrice}$</b>\n\n` +
      `Envoie le montant :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // ─── ADMIN ───
  if (!isAdmin(uid)) return;

  // Admin — Tâches
  if (data.startsWith("apr_task_")) {
    const tid = parseInt(data.replace("apr_task_",""));
    db.approveTask(tid, "OK");
    const t = db.getTask(tid);
    if (t) bot.sendMessage(t.creator_id, `✅ Ta campagne <b>${esc(t.title)}</b> est approuvée !`, { parse_mode: "HTML" }).catch(() => {});
    return bot.editMessageText((q.message.text || "") + "\n\n✅ APPROUVÉ", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("rej_task_")) {
    const tid = parseInt(data.replace("rej_task_",""));
    db.rejectTask(tid, "Rejeté");
    const t = db.getTask(tid);
    if (t) bot.sendMessage(t.creator_id, `❌ Ta campagne a été rejetée. Budget remboursé.`).catch(() => {});
    return bot.editMessageText((q.message.text || "") + "\n\n❌ REJETÉ", { chat_id: cid, message_id: mid });
  }

  // Admin — Preuves
  if (data.startsWith("apr_proof_")) {
    const cmpId = parseInt(data.replace("apr_proof_",""));
    const comp = db.db.prepare("SELECT * FROM task_completions WHERE completion_id=?").get(cmpId);
    if (comp) {
      const r = db.verifyTaskCompletion(comp.task_id, comp.user_id, true);
      if (r.success) bot.sendMessage(comp.user_id, `✅ Preuve validée ! +${fmt(r.reward)} crédité.`).catch(() => {});
    }
    return bot.editMessageCaption((q.message.caption || "") + "\n\n✅ APPROUVÉ", { chat_id: cid, message_id: mid }).catch(() => {
      bot.editMessageText((q.message.text || "") + "\n\n✅ APPROUVÉ", { chat_id: cid, message_id: mid }).catch(() => {});
    });
  }
  if (data.startsWith("rej_proof_")) {
    const cmpId = parseInt(data.replace("rej_proof_",""));
    const comp = db.db.prepare("SELECT * FROM task_completions WHERE completion_id=?").get(cmpId);
    db.db.prepare("UPDATE task_completions SET status='rejected' WHERE completion_id=?").run(cmpId);
    if (comp) bot.sendMessage(comp.user_id, `❌ Preuve rejetée.`).catch(() => {});
    return bot.editMessageCaption((q.message.caption || "") + "\n\n❌ REJETÉ", { chat_id: cid, message_id: mid }).catch(() => {
      bot.editMessageText((q.message.text || "") + "\n\n❌ REJETÉ", { chat_id: cid, message_id: mid }).catch(() => {});
    });
  }

  // Admin — Dépôts
  if (data.startsWith("conf_dep_")) {
    const depId = parseInt(data.replace("conf_dep_",""));
    const dep = db.db.prepare("SELECT * FROM deposits WHERE deposit_id = ?").get(depId);
    if (!dep || dep.status !== "pending") return bot.editMessageText("⚠️ Déjà traité.", { chat_id: cid, message_id: mid });

    // CONVERSION crypto → USD au prix temps réel
    const symbols = { ton:"TON", bnb:"BNB", usdt_bep20:"USDT", usdt_ton:"USDT" };
    const symbol = symbols[dep.method] || "USDT";
    const usdAmount = await payments.cryptoToUSD(dep.amount, symbol);

    // Marquer confirmé
    db.db.prepare("UPDATE deposits SET status='confirmed', amount=?, confirmed_at=CURRENT_TIMESTAMP WHERE deposit_id=?").run(usdAmount, depId);
    // Créditer en USD
    creditDeposit(dep.user_id, usdAmount);

    bot.sendMessage(dep.user_id,
      `✅ <b>Dépôt confirmé !</b>\n\n` +
      `💰 ${dep.amount} ${symbol} → <b>+${fmt(usdAmount)}</b>\n\n` +
      `💳 Ajouté à ta balance dépôt.\nℹ️ Utilisable pour jeux et campagnes (non retirable).`,
      { parse_mode: "HTML" }).catch(() => {});
    return bot.editMessageText((q.message.text || "") + "\n\n✅ CONFIRMÉ", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("rej_dep_")) {
    const depId = parseInt(data.replace("rej_dep_",""));
    db.rejectDeposit(depId);
    return bot.editMessageText((q.message.text || "") + "\n\n❌ REJETÉ", { chat_id: cid, message_id: mid });
  }

  // Admin — Retraits
  if (data.startsWith("pay_wd_")) {
    const wdId = parseInt(data.replace("pay_wd_",""));
    const wd   = db.approveWithdrawal(wdId);
    if (wd) {
      db.markWithdrawalPaid(wdId, "");
      // Conversion USD → crypto pour afficher
      const wdSymbols = { ton:"TON", bnb:"BNB", usdt_bep20:"USDT", usdt_ton:"USDT" };
      const wdSym = wdSymbols[wd.method] || "USDT";
      let cryptoTxt = "";
      try {
        const prices = await payments.getLivePrices();
        if (wdSym === "TON") cryptoTxt = ` (≈ ${(wd.net_amount / prices.ton).toFixed(4)} TON)`;
        else if (wdSym === "BNB") cryptoTxt = ` (≈ ${(wd.net_amount / prices.bnb).toFixed(5)} BNB)`;
        else cryptoTxt = ` (≈ ${wd.net_amount.toFixed(2)} USDT)`;
      } catch {}

      bot.sendMessage(wd.user_id,
        `✅ <b>Retrait envoyé !</b>\n💵 ${fmt(wd.net_amount)}${cryptoTxt}\n👛 <code>${wd.wallet_address}</code>`,
        { parse_mode: "HTML" }).catch(() => {});
      const payChannel = db.getSetting("payment_channel","");
      if (payChannel) {
        bot.sendMessage(payChannel,
          `✅ <b>Retrait effectué</b>\n💵 ${fmt(wd.net_amount)}${cryptoTxt}\n📲 Envoyé avec succès !`,
          { parse_mode: "HTML" }).catch(() => {});
      }
    }
    return bot.editMessageText((q.message.text || "") + "\n\n✅ PAYÉ", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("rej_wd_")) {
    const wdId = parseInt(data.replace("rej_wd_",""));
    const wd   = db.rejectWithdrawal(wdId);
    if (wd) bot.sendMessage(wd.user_id, `❌ Retrait rejeté.\n💰 ${fmt(wd.amount)} remboursé.`).catch(() => {});
    return bot.editMessageText((q.message.text || "") + "\n\n❌ REJETÉ", { chat_id: cid, message_id: mid });
  }

  // Admin — Concours
  if (data === "new_giveaway") {
    setState(uid, "ga_type");
    return bot.sendMessage(cid,
      `🏆 <b>NOUVEAU CONCOURS</b>\n\nChoisis le type :`,
      { parse_mode: "HTML", reply_markup: KBI([
        [{ text: "🎲 Classique (tirage)", callback_data: "ga_type_classic" }],
        [{ text: "👥 Parrainage (top inviteurs)", callback_data: "ga_type_referral" }]
      ]) });
  }
  if (data.startsWith("ga_type_")) {
    const gtype = data.replace("ga_type_","");
    setState(uid, "ga_title", { gtype });
    return bot.sendMessage(cid, "📝 Titre du concours :", { reply_markup: KB_CANCEL });
  }
  if (data.startsWith("draw_ga_")) {
    const gaId = parseInt(data.replace("draw_ga_",""));
    return drawGiveawayManually(cid, gaId);
  }

  // Admin — Settings
  if (data.startsWith("set_")) {
    const key = data.replace("set_","");
    setState(uid, `setval_${key}`, { key });
    const cur = db.getSetting(key, "—");
    return bot.sendMessage(cid,
      `⚙️ <b>${key}</b>\nValeur actuelle : <b>${esc(cur)}</b>\n\nEnvoie la nouvelle valeur :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // Admin — Devise
  if (data.startsWith("setcur_")) {
    const parts = data.split("_");
    const type = parts[1]; // display ou transaction
    const cur  = parts[2]; // USD/USDT/TON/BNB
    db.setSetting(`${type}_currency`, cur);
    return bot.sendMessage(cid, `✅ Devise ${type === "display" ? "d'affichage" : "transactions"} : <b>${cur}</b>`, { parse_mode: "HTML" });
  }
});

// ─────────────────────────────────────────────
//  MENU PRINCIPAL
// ─────────────────────────────────────────────

function sendHome(cid, user) {
  user = db.getUser(user.user_id);
  const botName = db.getSetting("bot_name", "ADCRYPTON");
  const maxT    = db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY);
  const jackpot = parseFloat(db.getSetting("jackpot_pool","0"));

  const earnedBal = user.balance || 0;
  const depBal    = user.deposit_balance || 0;

  bot.sendMessage(cid,
    `╔════════════════════╗\n` +
    `  💎 <b>${esc(botName)}</b>\n` +
    `╚════════════════════╝\n\n` +
    `👋 Salut <b>${esc(user.first_name)}</b> !\n\n` +
    `💰 Gains : <b>${fmt(earnedBal)}</b>\n` +
    `💳 Dépôt : <b>${fmt(depBal)}</b>\n` +
    `✅ Tâches : <b>${user.tasks_completed}</b> | 👥 Filleuls : <b>${user.referral_count}</b>\n` +
    `📅 Aujourd'hui : <b>${user.daily_tasks_done}/${maxT}</b>` +
    (jackpot > 0 ? `\n🎰 Jackpot : <b>${fmt(jackpot)}</b>` : ""),
    { parse_mode: "HTML", reply_markup: KB_MAIN(user.user_id) });
}

// ─────────────────────────────────────────────
//  TÂCHES
// ─────────────────────────────────────────────

function showTasksMenu(cid, user) {
  const maxT = db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY);
  bot.sendMessage(cid,
    `┌─────────────────────┐\n` +
    `   📋 <b>TÂCHES</b>\n` +
    `└─────────────────────┘\n\n` +
    `📅 Aujourd'hui : <b>${user.daily_tasks_done || 0}/${maxT}</b>\n\n` +
    `Choisis une catégorie ci-dessous 👇`,
    { parse_mode: "HTML", reply_markup: KB_TASKS });
}

async function showTasksByType(cid, uid, type, user) {
  const maxT = parseInt(db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY));
  if ((user.daily_tasks_done || 0) >= maxT) {
    return bot.sendMessage(cid, `⏰ <b>Limite atteinte</b>\n\nTu as fait ${maxT}/${maxT} tâches aujourd'hui.\nReviens demain !`, { parse_mode: "HTML" });
  }

  const tasks = db.getActiveTasks(type, uid);
  const typeNames = { channel: "📢 Canal", group: "👥 Groupe", bot: "🤖 Bot" };
  const typeLabel = typeNames[type] || "📋";

  if (!tasks || tasks.length === 0) {
    return bot.sendMessage(cid,
      `${typeLabel}\n\n📭 Aucune tâche disponible.\n\nReviens plus tard !`,
      { parse_mode: "HTML" });
  }

  await bot.sendMessage(cid,
    `${typeLabel} — <b>${tasks.length} tâche${tasks.length > 1 ? "s" : ""} disponible${tasks.length > 1 ? "s" : ""}</b>`,
    { parse_mode: "HTML" });

  for (const task of tasks.slice(0, 5)) {
    let durTxt = "";
    if (task.type === "bot") {
      const secs = parseInt(db.getSetting("bot_wait_seconds", "30"));
      durTxt = `⏱ Attente : ${secs}s`;
    } else {
      // Parse description pour récupérer la durée
      const m = (task.description || "").match(/(\d+)h/);
      const hours = m ? m[1] : "24";
      durTxt = `⏱ Reste abonné : ${hours}h`;
    }

    await bot.sendMessage(cid,
      `╔═══════════════════════╗\n` +
      `  ${typeLabel}\n` +
      `╚═══════════════════════╝\n\n` +
      `📌 <b>${esc(task.title)}</b>\n\n` +
      `💰 Récompense : <b>${fmt(task.reward)}</b>\n` +
      `${durTxt}`,
      {
        parse_mode: "HTML",
        reply_markup: KBI([
          [{ text: "🔗 Ouvrir le lien", url: task.link }],
          [{ text: "✅ J'ai effectué la tâche", callback_data: `start_task_${task.task_id}` }]
        ])
      });
  }
}

async function handleStartTask(cid, uid, taskId, user) {
  const task = db.getTask(taskId);
  if (!task || task.status !== "active") return bot.sendMessage(cid, "❌ Tâche indisponible.");

  // Vérif déjà fait
  const existing = db.db.prepare("SELECT * FROM task_completions WHERE task_id=? AND user_id=?").get(taskId, uid);
  if (existing && existing.status === "verified") {
    return bot.sendMessage(cid, "✅ Tu as déjà complété cette tâche.");
  }

  // ─── CANAL / GROUPE ───
  if (task.type === "channel" || task.type === "group") {
    if (!task.chat_id) return bot.sendMessage(cid, "❌ Tâche mal configurée.");

    const ok = await isMember(task.chat_id, uid);
    if (!ok) {
      return bot.sendMessage(cid,
        `❌ <b>Tu n'es pas abonné !</b>\n\n` +
        `1️⃣ Rejoins le ${task.type === "channel" ? "canal" : "groupe"}\n` +
        `2️⃣ Reviens et clique "Je suis abonné"`,
        { parse_mode: "HTML", reply_markup: KBI([
          [{ text: "🔗 Rejoindre", url: task.link }],
          [{ text: "✅ Je suis abonné", callback_data: `start_task_${taskId}` }]
        ]) });
    }

    // Abonné — démarrer ou valider immédiatement
    if (!existing) {
      const r = db.startTaskCompletion(taskId, uid);
      if (!r) return bot.sendMessage(cid, "❌ Erreur.");
    }

    // Récupérer la durée d'attente depuis description
    const m = (task.description || "").match(/(\d+)h/);
    const hours = m ? parseInt(m[1]) : 24;

    return bot.sendMessage(cid,
      `✅ <b>Abonnement confirmé !</b>\n\n` +
      `📌 ${esc(task.title)}\n` +
      `💰 Récompense : <b>${fmt(task.reward)}</b>\n\n` +
      `⏳ <b>Attends ${hours}h</b> avant de pouvoir réclamer ta récompense.\n` +
      `⚠️ <b>Ne te désabonne pas avant !</b>\n\n` +
      `Tu pourras valider ici dans ${hours}h 👇`,
      { parse_mode: "HTML", reply_markup: KBI([
        [{ text: `⏳ Valider dans ${hours}h`, callback_data: `verify_task_${taskId}` }]
      ]) });
  }

  // ─── BOT TELEGRAM ───
  if (task.type === "bot") {
    if (!existing) {
      const r = db.startTaskCompletion(taskId, uid);
      if (!r) return bot.sendMessage(cid, "❌ Erreur.");
    }
    const secs = parseInt(db.getSetting("bot_wait_seconds", "30"));
    return bot.sendMessage(cid,
      `▶️ <b>Démarre le bot</b>\n\n` +
      `📌 ${esc(task.title)}\n` +
      `💰 Récompense : <b>${fmt(task.reward)}</b>\n\n` +
      `1️⃣ Ouvre le bot et clique <b>/start</b>\n` +
      `2️⃣ Reviens ici dans <b>${secs}s</b>\n` +
      `3️⃣ Clique "Valider"`,
      { parse_mode: "HTML", reply_markup: KBI([
        [{ text: "🔗 Ouvrir le bot", url: task.link }],
        [{ text: `✅ Valider (après ${secs}s)`, callback_data: `verify_task_${taskId}` }]
      ]) });
  }

  return bot.sendMessage(cid, "❌ Type de tâche non supporté.");
}

async function handleVerifyTask(cid, uid, taskId, user) {
  const task = db.getTask(taskId);
  if (!task) return bot.sendMessage(cid, "❌ Tâche introuvable.");

  const existing = db.db.prepare("SELECT * FROM task_completions WHERE task_id=? AND user_id=?").get(taskId, uid);
  if (!existing) return bot.sendMessage(cid, "❌ Tu n'as pas démarré cette tâche.");
  if (existing.status === "verified") return bot.sendMessage(cid, "✅ Déjà validée.");

  // Vérif abonnement canal/groupe
  if ((task.type === "channel" || task.type === "group") && task.chat_id) {
    const ok = await isMember(task.chat_id, uid);
    if (!ok) {
      return bot.sendMessage(cid,
        `❌ <b>Tu t'es désabonné !</b>\n\nLa tâche est annulée.`,
        { parse_mode: "HTML", reply_markup: KBI([[{ text: "🔗 Rejoindre à nouveau", url: task.link }]]) });
    }

    // Vérifier que la durée est écoulée
    const m = (task.description || "").match(/(\d+)h/);
    const hours = m ? parseInt(m[1]) : 24;
    const startedAt = new Date(existing.completed_at).getTime();
    const elapsed = (Date.now() - startedAt) / 1000;
    const required = hours * 3600;
    if (elapsed < required) {
      return bot.sendMessage(cid,
        `⏳ <b>Pas encore !</b>\n\nAttends encore <b>${fmtDuration(required - elapsed)}</b>\n⚠️ Ne te désabonne pas !`,
        { parse_mode: "HTML" });
    }
  }

  // Vérif délai pour bot
  if (task.type === "bot") {
    const secs = parseInt(db.getSetting("bot_wait_seconds", "30"));
    const startedAt = new Date(existing.completed_at).getTime();
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed < secs) {
      return bot.sendMessage(cid,
        `⏳ <b>Attends encore ${Math.ceil(secs - elapsed)}s !</b>`,
        { parse_mode: "HTML" });
    }
  }

  // Tout OK — créditer
  const r = db.verifyTaskCompletion(taskId, uid, true);
  if (r.success) {
    return bot.sendMessage(cid,
      `✅ <b>Tâche validée !</b>\n\n💰 +${fmt(r.reward)} crédité !\n💵 Nouvelle balance : ${fmt((db.getUser(uid)).balance)}`,
      { parse_mode: "HTML" });
  }
  return bot.sendMessage(cid, "❌ Validation impossible.");
}

// ─────────────────────────────────────────────
//  BALANCE
// ─────────────────────────────────────────────

function showBalance(cid, user) {
  user = db.getUser(user.user_id);
  const earned = user.balance || 0;
  const deposit = user.deposit_balance || 0;
  bot.sendMessage(cid,
    `┌─────────────────────┐\n` +
    `  💳 <b>MA BALANCE</b>\n` +
    `└─────────────────────┘\n\n` +
    `💰 <b>Gains (retirable) :</b> ${fmt(earned)}\n` +
    `💳 <b>Dépôt (non retirable) :</b> ${fmt(deposit)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total : <b>${fmt(earned + deposit)}</b>\n\n` +
    `📥 Total déposé : ${fmt(user.total_deposited)}\n` +
    `📤 Total retiré : ${fmt(user.total_withdrawn)}\n\n` +
    `ℹ️ Les dépôts ne sont pas retirables.\nIls servent à créer des campagnes ou jouer.`,
    { parse_mode: "HTML", reply_markup: KB_BALANCE });
}

function showDeposit(cid) {
  const methods = config.DEPOSIT_METHODS;
  const rows = Object.entries(methods)
    .filter(([,m]) => m.enabled)
    .map(([key, m]) => [{ text: `${m.name} — min ${m.minAmount} ${m.symbol}`, callback_data: `dep_${key}` }]);

  bot.sendMessage(cid,
    `┌─────────────────────┐\n` +
    `  💳 <b>DÉPOSER</b>\n` +
    `└─────────────────────┘\n\n` +
    `⚡ Dépôt automatique\n` +
    `📊 Prix en temps réel\n\n` +
    `Choisis ta crypto :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showWithdraw(cid, user) {
  const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
  if (user.balance < minW) {
    return bot.sendMessage(cid,
      `┌─────────────────────┐\n` +
      `  🏧 <b>RETRAIT</b>\n` +
      `└─────────────────────┘\n\n` +
      `❌ Solde insuffisant.\n💵 Ton solde : ${fmt(user.balance)}\n📌 Minimum : ${fmt(minW)}`,
      { parse_mode: "HTML" });
  }

  const feeP = parseFloat(db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT));
  const rows  = Object.entries(config.WITHDRAWAL_METHODS)
    .filter(([,m]) => m.enabled)
    .map(([key,m]) => [{ text: m.name, callback_data: `wd_${key}` }]);

  bot.sendMessage(cid,
    `┌─────────────────────┐\n` +
    `  🏧 <b>RETRAIT</b>\n` +
    `└─────────────────────┘\n\n` +
    `💵 Solde : ${fmt(user.balance)}\n` +
    `📌 Min : ${fmt(minW)}\n` +
    `💸 Frais : ${feeP}%\n\n` +
    `Choisis la méthode :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showHistory(cid, uid) {
  const deps = db.getUserDeposits(uid, 5);
  const wds  = db.getUserWithdrawals(uid, 5);
  let txt = `┌─────────────────────┐\n  📋 <b>HISTORIQUE</b>\n└─────────────────────┘\n\n`;
  txt += `<b>Derniers dépôts :</b>\n`;
  if (!deps.length) txt += "Aucun.\n";
  else deps.forEach(d => { txt += `• ${fmt(d.amount)} ${d.method} — ${d.status}\n`; });
  txt += `\n<b>Derniers retraits :</b>\n`;
  if (!wds.length) txt += "Aucun.\n";
  else wds.forEach(w => { txt += `• ${fmt(w.net_amount)} — ${w.status}\n`; });
  bot.sendMessage(cid, txt, { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  JEUX
// ─────────────────────────────────────────────

function showGames(cid, user) {
  const jackpot = parseFloat(db.getSetting("jackpot_pool","0"));
  bot.sendMessage(cid,
    `┌─────────────────────┐\n  🎮 <b>MINI-JEUX</b>\n└─────────────────────┘\n\n` +
    `💵 Balance : <b>${fmt(user.balance)}</b>\n` +
    `🎟️ Spins gratuits : <b>${user.free_spins || 0}</b>\n` +
    `🏆 Jackpot : <b>${fmt(jackpot)}</b>`,
    { parse_mode: "HTML", reply_markup: KB_GAMES });
}

async function doSpin(cid, mid, uid, free, user) {
  user = db.getUser(uid);
  const cost = parseFloat(db.getSetting("spin_cost", config.SPIN_WHEEL.cost));

  if (free && (user.free_spins || 0) <= 0) {
    return bot.sendMessage(cid, "❌ Plus de spins gratuits !");
  }
  if (!free) {
    const total = (user.balance || 0) + (user.deposit_balance || 0);
    if (total < cost) return bot.sendMessage(cid, `❌ Solde insuffisant. Besoin : ${fmt(cost)}`);
  }

  // Tirage maison-favorable : 70% chance perdre/gain inférieur à mise
  const prizes = config.SPIN_WHEEL.prizes;
  const totalChance = prizes.reduce((a,p) => a + p.chance, 0);
  let roll = Math.random() * totalChance;
  let prize = prizes[prizes.length - 1];
  for (const p of prizes) {
    if (roll < p.chance) { prize = p; break; }
    roll -= p.chance;
  }

  if (free) {
    db.db.prepare("UPDATE users SET free_spins=free_spins-1 WHERE user_id=?").run(uid);
  } else {
    debitSmart(uid, cost, "spin_bet", `Roue mise ${fmtUSD(cost)}`);
  }

  const won = prize.value || 0;
  if (won > 0) {
    creditEarnings(uid, won, "spin_win", `Roue gain ${fmtUSD(won)}`);
  }

  if (!free && won < cost) {
    creditAdmin((cost - won) * 0.90, "roue");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + (cost - won) * 0.10) * 100) / 100));
  }

  db.recordGame(uid, "spin_wheel", free ? 0 : cost, won, prize.label);

  const nu = db.getUser(uid);
  bot.sendMessage(cid,
    `🎡 <b>ROUE DE FORTUNE</b>\n\n🎰 ${prize.label}\n\n${won > 0 ? `🎉 Tu gagnes <b>${fmt(won)}</b> !` : "😢 Pas de chance !"}\n\n💰 Gains : ${fmt(nu.balance)}\n💳 Dépôt : ${fmt(nu.deposit_balance || 0)}`,
    { parse_mode: "HTML" });
}

async function playDice(cid, uid, bet, user) {
  user = db.getUser(uid);
  const mult = parseFloat(db.getSetting("dice_multiplier", config.DICE_GAME.multiplier_win));
  const total = (user.balance || 0) + (user.deposit_balance || 0);
  if (total < bet) return bot.sendMessage(cid, "❌ Solde insuffisant !");

  debitSmart(uid, bet, "dice_bet", `Dés mise ${fmtUSD(bet)}`);
  const diceMsg = await bot.sendDice(cid, { emoji: "🎲" });
  const val = diceMsg.dice.value;
  await new Promise(r => setTimeout(r, 3500));

  // Gagne seulement sur 5 ou 6 (33% chance)
  let win = 0;
  if (val >= 5) {
    win = Math.round(bet * mult * 100) / 100;
    creditEarnings(uid, win, "dice_win", `Dés gain ${fmtUSD(win)}`);
  } else {
    creditAdmin(bet * 0.90, "dés");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + bet * 0.10) * 100) / 100));
  }

  db.recordGame(uid, "dice", bet, win, String(val));
  const nu = db.getUser(uid);
  bot.sendMessage(cid,
    `🎲 <b>Résultat : ${val}</b>\n\n${win > 0 ? `🎉 Gagné ! +${fmt(win)}` : `😢 Perdu ! -${fmt(bet)}`}\n\n💰 Gains : ${fmt(nu.balance)}\n💳 Dépôt : ${fmt(nu.deposit_balance || 0)}`,
    { parse_mode: "HTML" });
}

async function playCoinflip(cid, uid, choice, bet, user) {
  user = db.getUser(uid);
  const mult = parseFloat(db.getSetting("coinflip_multiplier", config.COINFLIP.multiplier_win));
  const total = (user.balance || 0) + (user.deposit_balance || 0);
  if (total < bet) return bot.sendMessage(cid, "❌ Solde insuffisant !");

  debitSmart(uid, bet, "cf_bet", `Pile/Face mise ${fmtUSD(bet)}`);
  // Asymétrie maison : 40% chance utilisateur gagne (au lieu de 50%)
  const userWinsRoll = Math.random() < 0.40;
  const result = userWinsRoll ? choice : (choice === "pile" ? "face" : "pile");
  const won = result === choice;

  let win = 0;
  if (won) {
    win = Math.round(bet * mult * 100) / 100;
    creditEarnings(uid, win, "cf_win", `Pile/Face gain ${fmtUSD(win)}`);
  } else {
    creditAdmin(bet * 0.90, "pile/face");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + bet * 0.10) * 100) / 100));
  }

  db.recordGame(uid, "coinflip", bet, win, result);
  const nu = db.getUser(uid);
  bot.sendMessage(cid,
    `🪙 <b>${result.toUpperCase()}</b>\n\nTu avais choisi : <b>${choice.toUpperCase()}</b>\n\n${won ? `🎉 Gagné ! +${fmt(win)}` : `😢 Perdu ! -${fmt(bet)}`}\n\n💰 Gains : ${fmt(nu.balance)}\n💳 Dépôt : ${fmt(nu.deposit_balance || 0)}`,
    { parse_mode: "HTML" });
}

async function playJackpot(cid, uid, user) {
  user = db.getUser(uid);
  const cost   = parseFloat(db.getSetting("jackpot_cost","0.10"));
  const chance = parseFloat(db.getSetting("jackpot_chance","0.2"));
  const pool   = parseFloat(db.getSetting("jackpot_pool","0"));
  const total = (user.balance || 0) + (user.deposit_balance || 0);

  if (cost <= 0) return bot.sendMessage(cid, "❌ Jackpot indisponible.");
  if (total < cost) return bot.sendMessage(cid, `❌ Solde insuffisant ! Besoin : ${fmt(cost)}`);

  // Débiter le ticket
  debitSmart(uid, cost, "jackpot_bet", `Jackpot ticket ${fmtUSD(cost)}`);

  // 50% du ticket va dans le pool, 50% commission admin
  creditAdmin(cost * 0.50, "jackpot");
  const newPool = Math.round((pool + cost * 0.50) * 100) / 100;

  // Tirage très rare
  const isWin = pool > 0 && Math.random() * 100 < chance;

  await new Promise(r => setTimeout(r, 2000));

  if (isWin) {
    creditEarnings(uid, pool, "jackpot_win", `Jackpot gagné ${fmtUSD(pool)}`);
    db.setSetting("jackpot_pool", "0");

    const winner = db.getUser(uid);
    const winnerName = winner?.first_name || "Anonyme";

    // Message au gagnant
    bot.sendMessage(cid,
      `🎉🎉🎉 <b>JACKPOT !!!</b> 🎉🎉🎉\n\n` +
      `Tu as gagné <b>${fmt(pool)}</b> !\n\n` +
      `💰 Crédité dans tes gains (retirable)`,
      { parse_mode: "HTML" });

    // Notification admin
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid, `🏆 Jackpot gagné par ${esc(winnerName)} (${uid}) : ${fmt(pool)}`).catch(() => {});
    }

    // Notification canal paiements
    const payChannel = db.getSetting("payment_channel", "");
    if (payChannel) {
      bot.sendMessage(payChannel,
        `🎉🎉 <b>GROS GAGNANT JACKPOT !</b> 🎉🎉\n\n` +
        `<b>${esc(winnerName)}</b> vient de remporter <b>${fmt(pool)}</b> !\n\n` +
        `🎰 Le jackpot revient à 0\n` +
        `🎟️ Tente ta chance maintenant !`,
        { parse_mode: "HTML" }).catch(() => {});
    }

    // Broadcast à tous les users
    try {
      const allUsers = db.getAllUsers({ banned: false });
      for (const u of allUsers) {
        if (u.user_id === uid) continue;
        bot.sendMessage(u.user_id,
          `🎉🎉 <b>GROS GAGNANT JACKPOT !</b> 🎉🎉\n\n` +
          `<b>${esc(winnerName)}</b> vient de remporter <b>${fmt(pool)}</b> !\n\n` +
          `🎰 Le jackpot revient à 0\n` +
          `🎟️ Tente ta chance maintenant !`,
          { parse_mode: "HTML" }).catch(() => {});
        await new Promise(r => setTimeout(r, 30));
      }
    } catch (e) { console.error("Broadcast jackpot:", e.message); }

  } else {
    db.setSetting("jackpot_pool", String(newPool));
    bot.sendMessage(cid, `😢 <b>Pas de chance !</b>\n\nJackpot monte à <b>${fmt(newPool)}</b>\n🎟️ Réessaye !`, { parse_mode: "HTML" });
  }
}

async function playGuess(cid, uid, guess, user) {
  user = db.getUser(uid);
  const cost  = parseFloat(db.getSetting("guess_cost", config.GUESS_NUMBER.cost));
  const prize = parseFloat(db.getSetting("guess_prize", config.GUESS_NUMBER.prize));
  const range = config.GUESS_NUMBER.range;
  const total = (user.balance || 0) + (user.deposit_balance || 0);
  if (total < cost) return bot.sendMessage(cid, "❌ Solde insuffisant !");

  debitSmart(uid, cost, "guess_bet", `Devinette`);
  const secret = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

  let win = 0;
  if (guess === secret) {
    win = prize;
    creditEarnings(uid, win, "guess_win", `Devinette gain`);
  } else {
    creditAdmin(cost * 0.90, "devinette");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + cost * 0.10) * 100) / 100));
  }

  db.recordGame(uid, "guess", cost, win, String(secret));
  const nu = db.getUser(uid);
  bot.sendMessage(cid,
    `🔢 <b>Résultat</b>\n\nTu as dit : <b>${guess}</b>\nRéponse : <b>${secret}</b>\n\n${win > 0 ? `🎉 Gagné ! +${fmt(win)}` : `😢 Perdu ! -${fmt(cost)}`}\n\n💰 Gains : ${fmt(nu.balance)}\n💳 Dépôt : ${fmt(nu.deposit_balance || 0)}`,
    { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  CONCOURS
// ─────────────────────────────────────────────

function showGiveaways(cid) {
  const list = db.getActiveGiveaways();
  let txt = `┌─────────────────────┐\n  🏆 <b>CONCOURS ACTIFS</b>\n└─────────────────────┘\n\n`;
  if (!list.length) txt += "Aucun concours actif. Reviens plus tard !";
  else list.forEach(g => {
    const count = db.db.prepare("SELECT COUNT(*) as n FROM giveaway_entries WHERE giveaway_id=?").get(g.giveaway_id);
    let prizes = "";
    try {
      const req = JSON.parse(g.requirements || "{}");
      if (req.prizes && Array.isArray(req.prizes)) {
        prizes = req.prizes.map((p, i) => `${i+1}er : ${fmt(p)}`).join(" | ");
      }
    } catch {}
    const ginfo = JSON.parse(g.requirements || "{}");
    const gtype = ginfo.gtype === "referral" ? "👥 Parrainage" : "🎲 Classique";
    txt += `🎁 <b>${esc(g.title)}</b>\n${gtype}\n💰 ${prizes || fmt(g.prize_amount)}\n👥 ${count.n || 0} participants\n⏰ Fin : ${fmtDate(g.ends_at)}\n\n`;
  });

  const rows = list.map(g => [{ text: `🎟️ Participer — ${esc(g.title)}`, callback_data: `join_ga_${g.giveaway_id}` }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: rows.length ? KBI(rows) : undefined });
}

async function drawGiveawayManually(cid, gaId) {
  const ga = db.getGiveaway(gaId);
  if (!ga) return bot.sendMessage(cid, "❌ Concours introuvable.");

  const req = JSON.parse(ga.requirements || "{}");
  const prizes = req.prizes || [ga.prize_amount];
  const gtype  = req.gtype || "classic";

  let winners = [];

  if (gtype === "referral") {
    // Top inviteurs depuis la création du concours
    const start = new Date(ga.created_at).toISOString();
    winners = db.db.prepare(`
      SELECT u.user_id, COUNT(r.user_id) as refs FROM users u
      LEFT JOIN users r ON r.referred_by = u.user_id AND r.created_at >= ?
      WHERE u.user_id IN (SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?)
      GROUP BY u.user_id
      HAVING refs > 0
      ORDER BY refs DESC
      LIMIT ?
    `).all(start, gaId, prizes.length).map(r => r.user_id);
  } else {
    // Tirage classique
    const entries = db.db.prepare("SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?").all(gaId).map(e => e.user_id);
    if (!entries.length) {
      db.db.prepare("UPDATE giveaways SET status='cancelled' WHERE giveaway_id=?").run(gaId);
      return bot.sendMessage(cid, "❌ Aucun participant. Concours annulé.");
    }
    const shuffled = entries.sort(() => Math.random() - 0.5);
    winners = shuffled.slice(0, prizes.length);
  }

  if (!winners.length) return bot.sendMessage(cid, "❌ Aucun gagnant.");

  // Crédit gagnants
  let report = `🎉 <b>Concours terminé : ${esc(ga.title)}</b>\n\n`;
  for (let i = 0; i < winners.length; i++) {
    const winnerId = winners[i];
    const prize = prizes[i];
    db.updateBalance(winnerId, prize, "giveaway_win", `Gagnant concours: ${ga.title}`);
    db.db.prepare("UPDATE giveaway_entries SET is_winner=1, prize_amount=? WHERE giveaway_id=? AND user_id=?").run(prize, gaId, winnerId);
    const w = db.getUser(winnerId);
    report += `${i+1}er : <b>${esc(w?.first_name || "?")}</b> — ${fmt(prize)}\n`;
    bot.sendMessage(winnerId, `🎉 <b>Tu as gagné le concours !</b>\nPosition : ${i+1}er\n💰 +${fmt(prize)} crédité !`, { parse_mode: "HTML" }).catch(() => {});
  }

  db.db.prepare("UPDATE giveaways SET status='ended', drawn_at=CURRENT_TIMESTAMP WHERE giveaway_id=?").run(gaId);

  // Publier sur canal paiements
  const payChannel = db.getSetting("payment_channel","");
  if (payChannel) bot.sendMessage(payChannel, report, { parse_mode: "HTML" }).catch(() => {});

  return bot.sendMessage(cid, `✅ Tirage effectué !\n\n${report}`, { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  PARRAINAGE
// ─────────────────────────────────────────────

async function showReferral(cid, user) {
  if (!botInfo) botInfo = await bot.getMe();
  const link  = `https://t.me/${botInfo.username}?start=ref_${user.user_id}`;
  const bonus = db.getSetting("referral_bonus", config.REFERRAL_BONUS);
  const pct   = db.getSetting("referral_percent", config.REFERRAL_PERCENT);

  bot.sendMessage(cid,
    `┌─────────────────────┐\n  👥 <b>PARRAINAGE</b>\n└─────────────────────┘\n\n` +
    `🔗 Ton lien :\n<code>${link}</code>\n\n` +
    `💰 Bonus par filleul : <b>${fmt(bonus)}</b>\n` +
    `📊 Commission gains : <b>${pct}%</b>\n` +
    `👥 Tes filleuls : <b>${user.referral_count}</b>`,
    { parse_mode: "HTML", reply_markup: KB_PARRAIN });
}

// ─────────────────────────────────────────────
//  BONUS QUOTIDIEN
// ─────────────────────────────────────────────

function claimBonus(cid, uid, user) {
  const r = db.claimDailyBonus(uid);
  if (!r) return bot.sendMessage(cid, `🎁 Déjà réclamé !\nProchain dans 24h.`);
  const nu = db.getUser(uid);
  bot.sendMessage(cid,
    `🎁 <b>Bonus réclamé !</b>\n\n💰 +${fmt(r.amount)}\n💵 Balance : ${fmt(nu.balance)}`,
    { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  CRÉER CAMPAGNE
// ─────────────────────────────────────────────

function showCreateCampaign(cid, user) {
  const rows = [
    [{ text: "📢 Canal Telegram",  callback_data: "ct_type_channel" }],
    [{ text: "👥 Groupe Telegram", callback_data: "ct_type_group"   }],
    [{ text: "🤖 Bot Telegram",    callback_data: "ct_type_bot"     }],
  ];
  bot.sendMessage(cid,
    `┌─────────────────────┐\n  ➕ <b>CRÉER CAMPAGNE</b>\n└─────────────────────┘\n\n` +
    `💵 Balance : <b>${fmt(user.balance)}</b>\n\n` +
    `Choisis le type de campagne :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

// Helper: Vérifier le type d'un chat Telegram via son lien
async function verifyChatType(link, expectedType) {
  // Extraire le username depuis le lien
  let username = link.trim();
  if (username.startsWith("https://t.me/"))  username = username.replace("https://t.me/", "");
  if (username.startsWith("http://t.me/"))   username = username.replace("http://t.me/", "");
  if (username.startsWith("t.me/"))          username = username.replace("t.me/", "");
  if (username.startsWith("@"))              username = username.substring(1);
  username = username.split("/")[0].split("?")[0];
  if (!username) return { ok: false, reason: "invalid_link" };

  try {
    const chat = await bot.getChat("@" + username);
    if (expectedType === "channel") {
      if (chat.type !== "channel") return { ok: false, reason: "not_channel", got: chat.type };
    } else if (expectedType === "group") {
      if (chat.type !== "group" && chat.type !== "supergroup") return { ok: false, reason: "not_group", got: chat.type };
    } else if (expectedType === "bot") {
      // Les bots sont des chats privés avec is_bot=true
      // bot.getChat() pour un bot retourne type "private"
      if (chat.type !== "private") return { ok: false, reason: "not_bot", got: chat.type };
      // Vérif additionnelle : le username doit finir par "bot"
      if (!username.toLowerCase().endsWith("bot")) return { ok: false, reason: "not_bot", got: chat.type };
    }
    return { ok: true, chat, username };
  } catch (e) {
    return { ok: false, reason: "not_found", error: e.message };
  }
}

// Helper: Vérifier que ce bot est admin du canal/groupe
async function verifyBotIsAdmin(chatUsername) {
  try {
    if (!botInfo) botInfo = await bot.getMe();
    const m = await bot.getChatMember("@" + chatUsername, botInfo.id);
    return ["administrator", "creator"].includes(m.status);
  } catch { return false; }
}

// ─────────────────────────────────────────────
//  SUPPORT
// ─────────────────────────────────────────────

function showSupport(cid, uid) {
  const su = db.getSetting("support_username","");
  bot.sendMessage(cid,
    `┌─────────────────────┐\n  🎫 <b>SUPPORT</b>\n└─────────────────────┘\n\n` +
    `${su ? `📩 Contact : @${su}\n\n` : ""}Envoie ton message ici :`,
    { parse_mode: "HTML" });
  setState(uid, "support_msg");
}

// ─────────────────────────────────────────────
//  PARAMÈTRES USER
// ─────────────────────────────────────────────

function showSettings(cid, user) {
  bot.sendMessage(cid,
    `┌─────────────────────┐\n  ⚙️ <b>PARAMÈTRES</b>\n└─────────────────────┘\n\n` +
    `👤 ${esc(user.first_name)}\n🆔 <code>${user.user_id}</code>\n💱 Devise : <b>${getDisplayCurrency()}</b>`,
    { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  ADMIN
// ─────────────────────────────────────────────

function showAdmin(cid) {
  const s = db.getStats();
  bot.sendMessage(cid,
    `┌─────────────────────┐\n  👑 <b>PANNEAU ADMIN</b>\n└─────────────────────┘\n\n` +
    `👤 ${s.users} users (${s.activeUsers24h} actifs)\n` +
    `📋 ${s.pendingTasks} tâches | 📸 ${s.pendingProofs} preuves\n` +
    `🏧 ${s.pendingWithdrawals} retraits | 💳 ${s.pendingDeposits} dépôts\n` +
    `🎫 ${s.openTickets} tickets\n\n` +
    `💵 Déposé: ${fmt(s.totalDeposited)} | Retiré: ${fmt(s.totalWithdrawn)}\n` +
    `📈 Profit: ${fmt(s.profit || 0)}`,
    { parse_mode: "HTML", reply_markup: KB_ADMIN });
}

function showAdminStats(cid) {
  const s = db.getStats();
  bot.sendMessage(cid,
    `📊 <b>STATS</b>\n\n` +
    `👤 ${s.users} users | ${s.bannedUsers} bannis\n` +
    `👥 24h: ${s.activeUsers24h} | 7j: ${s.activeUsers7d}\n\n` +
    `💵 Déposé: ${fmt(s.totalDeposited)}\n` +
    `💸 Retiré: ${fmt(s.totalWithdrawn)}\n` +
    `🏦 Frais: ${fmt(s.totalFees || 0)}\n` +
    `📈 Profit: ${fmt(s.profit || 0)}\n` +
    `🎰 Jackpot: ${fmt(parseFloat(db.getSetting("jackpot_pool","0")))}`,
    { parse_mode: "HTML", reply_markup: KB_ADMIN });
}

function botSettings() {
  return [
    { key: "bot_name",              label: "🤖 Nom du bot" },
    { key: "official_channel",      label: "📢 Canal officiel" },
    { key: "payment_channel",       label: "💸 Canal paiements" },
    { key: "support_username",      label: "🎫 Username support" },
    { key: "daily_bonus_min",       label: "📅 Bonus quotidien min" },
    { key: "daily_bonus_max",       label: "📅 Bonus quotidien max" },
    { key: "referral_bonus",        label: "👥 Bonus parrainage" },
    { key: "referral_percent",      label: "👥 Commission %" },
    { key: "min_withdrawal",        label: "🏧 Min retrait" },
    { key: "max_withdrawal",        label: "🏧 Max retrait" },
    { key: "withdrawal_fee_percent",label: "💸 Frais retrait %" },
    { key: "max_tasks_day",         label: "📋 Max tâches/jour" },
    { key: "min_price_1h",          label: "💰 Min prix canal 1h" },
    { key: "min_price_12h",         label: "💰 Min prix canal 12h" },
    { key: "min_price_24h",         label: "💰 Min prix canal 24h" },
    { key: "min_price_48h",         label: "💰 Min prix canal 48h" },
    { key: "min_price_bot",         label: "💰 Min prix bot" },
    { key: "bot_wait_seconds",      label: "⏱ Attente bot (secondes)" },
    { key: "maintenance_mode",      label: "🔧 Maintenance (true/false)" },
  ];
}

function gameSettings() {
  return [
    { key: "spin_cost",          label: "🎡 Coût spin" },
    { key: "dice_multiplier",    label: "🎲 Dés multiplicateur" },
    { key: "coinflip_multiplier",label: "🪙 Pile/Face multiplicateur" },
    { key: "jackpot_cost",       label: "🏆 Jackpot ticket" },
    { key: "jackpot_chance",     label: "🏆 Jackpot chance %" },
    { key: "jackpot_pool",       label: "🏆 Jackpot pool" },
    { key: "guess_cost",         label: "🔢 Devinette coût" },
    { key: "guess_prize",        label: "🔢 Devinette gain" },
  ];
}

function showConfigBot(cid) {
  const settings = botSettings();
  let txt = `⚙️ <b>CONFIG BOT</b>\n\n`;
  settings.forEach(s => { txt += `${s.label}: <b>${esc(db.getSetting(s.key,"—"))}</b>\n`; });
  const rows = settings.map(s => [{ text: `✏️ ${s.label}`, callback_data: `set_${s.key}` }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showConfigGames(cid) {
  const settings = gameSettings();
  let txt = `🎮 <b>CONFIG JEUX</b>\n\n`;
  settings.forEach(s => { txt += `${s.label}: <b>${esc(db.getSetting(s.key,"—"))}</b>\n`; });
  const rows = settings.map(s => [{ text: `✏️ ${s.label}`, callback_data: `set_${s.key}` }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showConfigCurrency(cid) {
  const disp = getDisplayCurrency();
  const tx   = getTransactionCurrency();
  bot.sendMessage(cid,
    `💱 <b>DEVISES</b>\n\n` +
    `Affichage : <b>${disp}</b>\nTransactions : <b>${tx}</b>\n\n` +
    `Choisis :`,
    { parse_mode: "HTML", reply_markup: KBI([
      [{ text: "💵 Affichage USD",  callback_data: "setcur_display_USD"  },
       { text: "💵 Trans. USD",     callback_data: "setcur_transaction_USD"  }],
      [{ text: "💎 Affichage TON",  callback_data: "setcur_display_TON"  },
       { text: "💎 Trans. TON",     callback_data: "setcur_transaction_TON"  }],
      [{ text: "🟡 Affichage BNB",  callback_data: "setcur_display_BNB"  },
       { text: "🟡 Trans. BNB",     callback_data: "setcur_transaction_BNB"  }],
      [{ text: "💵 Affichage USDT", callback_data: "setcur_display_USDT" },
       { text: "💵 Trans. USDT",    callback_data: "setcur_transaction_USDT" }]
    ]) });
}

function showAdminTasks(cid) {
  const tasks = db.getPendingTasks();
  if (!tasks.length) return bot.sendMessage(cid, "✅ Aucune tâche en attente.");
  tasks.slice(0,5).forEach(t => {
    bot.sendMessage(cid,
      `📋 #${t.task_id} <b>${esc(t.title)}</b>\n👤 ${esc(t.first_name)}\n💰 ${fmt(t.reward)} | Budget: ${fmt(t.budget)}\n🔗 ${esc(t.link)}`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "✅ Approuver", callback_data: `apr_task_${t.task_id}` },
        { text: "❌ Rejeter",  callback_data: `rej_task_${t.task_id}` }
      ]]) });
  });
}

function showAdminProofs(cid) {
  const proofs = db.db.prepare(
    "SELECT tc.*, t.title, u.first_name FROM task_completions tc JOIN tasks t ON tc.task_id=t.task_id JOIN users u ON tc.user_id=u.user_id WHERE tc.status='pending_review' ORDER BY tc.completed_at ASC LIMIT 10"
  ).all();
  if (!proofs.length) return bot.sendMessage(cid, "✅ Aucune preuve en attente.");
  proofs.forEach(p => {
    const opts = { parse_mode: "HTML", reply_markup: KBI([[
      { text: "✅ Valider",  callback_data: `apr_proof_${p.completion_id}` },
      { text: "❌ Rejeter", callback_data: `rej_proof_${p.completion_id}` }
    ]]) };
    const caption = `📸 <b>Preuve #${p.completion_id}</b>\n👤 ${esc(p.first_name)} (${p.user_id})\n📌 ${esc(p.title)}\n${p.proof_message ? `💬 ${esc(p.proof_message)}` : ""}`;
    if (p.proof_url && p.proof_url.startsWith("AgAC")) {
      bot.sendPhoto(cid, p.proof_url, { caption, ...opts }).catch(() => {
        bot.sendMessage(cid, caption, opts);
      });
    } else {
      bot.sendMessage(cid, caption, opts);
    }
  });
}

async function showAdminWithdrawals(cid) {
  const wds = db.getPendingWithdrawals();
  if (!wds.length) return bot.sendMessage(cid, "✅ Aucun retrait en attente.");
  const symbols = { ton:"TON", bnb:"BNB", usdt_bep20:"USDT", usdt_ton:"USDT" };
  let prices;
  try { prices = await payments.getLivePrices(); } catch {}

  for (const w of wds.slice(0, 5)) {
    const sym = symbols[w.method] || "USDT";
    let cryptoTxt = "";
    if (prices) {
      if (sym === "TON") cryptoTxt = `\n💎 À envoyer : <b>${(w.net_amount / prices.ton).toFixed(4)} TON</b>`;
      else if (sym === "BNB") cryptoTxt = `\n🟡 À envoyer : <b>${(w.net_amount / prices.bnb).toFixed(5)} BNB</b>`;
      else cryptoTxt = `\n💵 À envoyer : <b>${w.net_amount.toFixed(2)} USDT</b>`;
    }

    await bot.sendMessage(cid,
      `🏧 <b>Retrait #${w.withdrawal_id}</b>\n` +
      `👤 ${esc(w.first_name)} (${w.user_id})\n` +
      `💵 ${fmt(w.net_amount)} (frais: ${fmt(w.fee)})${cryptoTxt}\n` +
      `👛 <code>${w.wallet_address}</code>\n` +
      `📌 Méthode : ${sym}`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "✅ Payé",    callback_data: `pay_wd_${w.withdrawal_id}` },
        { text: "❌ Rejeter", callback_data: `rej_wd_${w.withdrawal_id}` }
      ]]) });
  }
}

function showAdminDeposits(cid) {
  const deps = db.getPendingDeposits();
  if (!deps.length) return bot.sendMessage(cid, "✅ Aucun dépôt en attente.");
  deps.slice(0,5).forEach(d => {
    bot.sendMessage(cid,
      `💳 #${d.deposit_id}\n👤 ${esc(d.first_name)} (${d.user_id})\n💰 ${fmt(d.amount)} ${d.method}`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "✅ Confirmer", callback_data: `conf_dep_${d.deposit_id}` },
        { text: "❌ Rejeter",   callback_data: `rej_dep_${d.deposit_id}` }
      ]]) });
  });
}

function showAdminTickets(cid) {
  const tickets = db.getOpenTickets();
  if (!tickets.length) return bot.sendMessage(cid, "✅ Aucun ticket ouvert.");
  let txt = `🎫 <b>TICKETS (${tickets.length})</b>\n\n`;
  tickets.slice(0,10).forEach(t => { txt += `#${t.ticket_id} | ${esc(t.first_name)} : ${esc(t.subject)}\n${esc(t.message?.substring(0,100) || "")}\n\n`; });
  bot.sendMessage(cid, txt, { parse_mode: "HTML" });
}

function showAdminGiveaways(cid) {
  const list = db.getActiveGiveaways();
  let txt = `🏆 <b>CONCOURS ACTIFS</b>\n\n`;
  if (!list.length) txt += "Aucun concours actif.";
  else list.forEach(g => {
    const req = JSON.parse(g.requirements || "{}");
    const gtype = req.gtype === "referral" ? "👥 Parrainage" : "🎲 Classique";
    txt += `#${g.giveaway_id} ${esc(g.title)} — ${gtype}\n💰 ${fmt(g.prize_amount)} | Fin : ${fmtDate(g.ends_at)}\n\n`;
  });
  const rows = [
    [{ text: "➕ Nouveau Concours", callback_data: "new_giveaway" }],
    ...list.map(g => [{ text: `🎲 Tirer #${g.giveaway_id}`, callback_data: `draw_ga_${g.giveaway_id}` }])
  ];
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

// ─────────────────────────────────────────────
//  HANDLER MESSAGES + PHOTOS
// ─────────────────────────────────────────────

bot.on("message", async (msg) => {
  if (msg.text && msg.text.startsWith("/")) return;

  const uid  = msg.from.id;
  const cid  = msg.chat.id;
  const text = (msg.text || "").trim();

  const maint = maintenance(uid);
  if (maint) return bot.sendMessage(cid, maint);

  let user = db.getUser(uid);
  if (!user) return;
  if (user.is_banned) return;

  const st = getState(uid);

  // ─── Gestion photos pour preuves ───
  if (msg.photo && st && st.state === "task_proof") {
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    const taskId = st.data.taskId;

    db.submitTaskProof(taskId, uid, fileId, msg.caption || "");
    clearState(uid);

    bot.sendMessage(cid, "✅ <b>Preuve envoyée !</b>\nUn admin va vérifier sous 24h.", { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });

    // Notif admins
    const task = db.getTask(taskId);
    const completion = db.db.prepare("SELECT completion_id FROM task_completions WHERE task_id=? AND user_id=?").get(taskId, uid);
    for (const aid of config.ADMIN_IDS) {
      bot.sendPhoto(aid, fileId, {
        caption: `📸 <b>Nouvelle preuve</b>\n👤 ${esc(user.first_name)} (${uid})\n📌 ${esc(task?.title || "?")}\n💰 ${fmt(task?.reward || 0)}`,
        parse_mode: "HTML",
        reply_markup: KBI([[
          { text: "✅ Valider",  callback_data: `apr_proof_${completion?.completion_id}` },
          { text: "❌ Rejeter", callback_data: `rej_proof_${completion?.completion_id}` }
        ]])
      }).catch(() => {});
    }
    return;
  }

  if (!text) return;

  // ─── Annuler ───
  if (text === "❌ Annuler") {
    clearState(uid);
    return bot.sendMessage(cid, "❌ Annulé.", { reply_markup: KB_MAIN(uid) });
  }

  // ─── Accueil ───
  if (text === "🏠 Accueil") {
    clearState(uid);
    return sendHome(cid, user);
  }

  // ─── Navigation principale ───
  if (text === "💳 Balance")    { clearState(uid); return showBalance(cid, user); }
  if (text === "📋 Tâches")     { clearState(uid); return showTasksMenu(cid, user); }
  if (text === "🎮 Jeux")       { clearState(uid); return showGames(cid, user); }
  if (text === "🏆 Concours")   { clearState(uid); return showGiveaways(cid); }
  if (text === "👥 Parrainage") { clearState(uid); return showReferral(cid, user); }
  if (text === "🎫 Support")    { clearState(uid); return showSupport(cid, uid); }
  if (text === "⚙️ Paramètres"){ clearState(uid); return showSettings(cid, user); }
  if (text === "👑 Admin" && isAdmin(uid)) { clearState(uid); return showAdmin(cid); }

  // ─── Balance ───
  if (text === "💳 Déposer")    { clearState(uid); return showDeposit(cid); }
  if (text === "🏧 Retirer")    { clearState(uid); return showWithdraw(cid, user); }
  if (text === "📋 Historique") { clearState(uid); return showHistory(cid, uid); }

  // ─── Tâches ───
  const typeMap = {
    "📢 Canaux":  "channel",
    "👥 Groupes": "group",
    "🤖 Bots":    "bot",
  };
  if (typeMap[text]) { clearState(uid); return showTasksByType(cid, uid, typeMap[text], user); }
  if (text === "➕ Créer Campagne")  { clearState(uid); return showCreateCampaign(cid, user); }
  if (text === "🎁 Bonus Quotidien") { clearState(uid); return claimBonus(cid, uid, user); }

  // ─── Jeux ───
  if (text === "🎡 Roue Fortune") {
    clearState(uid);
    const cost = parseFloat(db.getSetting("spin_cost", config.SPIN_WHEEL.cost));
    const rows = [];
    if ((user.free_spins || 0) > 0) rows.push([{ text: `🎟️ Spin gratuit (${user.free_spins})`, callback_data: "spin_free" }]);
    if (user.balance >= cost) rows.push([{ text: `🎡 Spin — ${fmt(cost)}`, callback_data: "spin_paid" }]);
    if (!rows.length) return bot.sendMessage(cid, `❌ Solde insuffisant (${fmt(cost)}) et pas de spin gratuit.`);
    return bot.sendMessage(cid, `🎡 <b>ROUE</b>\n\n${config.SPIN_WHEEL.prizes.map(p=>`${p.label} — ${p.chance}%`).join("\n")}\n\n💵 ${fmt(user.balance)}`, { parse_mode: "HTML", reply_markup: KBI(rows) });
  }
  if (text === "🎲 Dés") {
    clearState(uid);
    const minB = parseFloat(db.getSetting("dice_min_bet", config.DICE_GAME.min_bet));
    const maxB = parseFloat(db.getSetting("dice_max_bet", config.DICE_GAME.max_bet));
    const mult = parseFloat(db.getSetting("dice_multiplier", config.DICE_GAME.multiplier_win));
    const bets = [0.05,0.10,0.25,0.50,1.00,2.00,5.00].filter(b=>b>=minB&&b<=maxB&&b<=user.balance);
    if (!bets.length) return bot.sendMessage(cid, `❌ Solde insuffisant. Min : ${fmt(minB)}`);
    const rows = [];
    for (let i=0;i<bets.length;i+=3) rows.push(bets.slice(i,i+3).map(b=>({ text: fmt(b), callback_data:`dice_${b}` })));
    return bot.sendMessage(cid, `🎲 <b>DÉS</b>\n\n4,5,6 → x${mult} | 1,2,3 → Perdu\n💵 ${fmt(user.balance)}`, { parse_mode: "HTML", reply_markup: KBI(rows) });
  }
  if (text === "🪙 Pile/Face") {
    clearState(uid);
    const minB = parseFloat(db.getSetting("coinflip_min_bet", config.COINFLIP.min_bet));
    const maxB = parseFloat(db.getSetting("coinflip_max_bet", config.COINFLIP.max_bet));
    const mult = parseFloat(db.getSetting("coinflip_multiplier", config.COINFLIP.multiplier_win));
    const bets = [0.05,0.10,0.25,0.50,1.00,2.00,5.00].filter(b=>b>=minB&&b<=maxB&&b<=user.balance);
    if (!bets.length) return bot.sendMessage(cid, `❌ Solde insuffisant. Min : ${fmt(minB)}`);
    const rows = [];
    for (let i=0;i<bets.length;i+=3) rows.push(bets.slice(i,i+3).map(b=>({ text: fmt(b), callback_data:`cf_bet_${b}` })));
    return bot.sendMessage(cid, `🪙 <b>PILE / FACE</b>\n\nx${mult} si tu devines !\n💵 ${fmt(user.balance)}`, { parse_mode: "HTML", reply_markup: KBI(rows) });
  }
  if (text === "🏆 Jackpot") {
    clearState(uid);
    const cost   = parseFloat(db.getSetting("jackpot_cost","0.10"));
    const chance = parseFloat(db.getSetting("jackpot_chance","5"));
    const pool   = parseFloat(db.getSetting("jackpot_pool","0"));
    const rows   = user.balance >= cost ? [[{ text: `🎟️ Jouer — ${fmt(cost)}`, callback_data: "jackpot_play" }]] : [];
    return bot.sendMessage(cid, `🏆 <b>JACKPOT</b>\n\n💰 Pool : <b>${fmt(pool)}</b>\n🎟️ Ticket : ${fmt(cost)}\n🎯 Chance : ${chance}%\n\n💵 ${fmt(user.balance)}`, { parse_mode: "HTML", reply_markup: KBI(rows) });
  }
  if (text === "🔢 Devinette") {
    clearState(uid);
    const cost  = parseFloat(db.getSetting("guess_cost", config.GUESS_NUMBER.cost));
    const prize = parseFloat(db.getSetting("guess_prize", config.GUESS_NUMBER.prize));
    const range = config.GUESS_NUMBER.range;
    const nums  = [...Array(range[1]-range[0]+1)].map((_,i)=>i+range[0]);
    const rows  = nums.reduce((acc,n,i)=>{ if(i%5===0) acc.push([]); acc[acc.length-1].push({ text:`${n}`, callback_data:`guess_${n}` }); return acc; },[]);
    return bot.sendMessage(cid, `🔢 <b>DEVINETTE</b>\n\nDevine entre ${range[0]} et ${range[1]}\n🎟️ ${fmt(cost)} | 🏆 ${fmt(prize)}\n💵 ${fmt(user.balance)}`, { parse_mode: "HTML", reply_markup: KBI(rows) });
  }

  // ─── Parrainage ───
  if (text === "🔗 Mon Lien") {
    if (!botInfo) botInfo = await bot.getMe();
    return bot.sendMessage(cid, `<code>https://t.me/${botInfo.username}?start=ref_${uid}</code>`, { parse_mode: "HTML" });
  }

  // ─── ADMIN navigation ───
  if (isAdmin(uid)) {
    if (text === "📊 Stats")          return showAdminStats(cid);
    if (text === "⚙️ Config Bot")     return showConfigBot(cid);
    if (text === "🎮 Config Jeux")    return showConfigGames(cid);
    if (text === "📋 Tâches Admin")   return showAdminTasks(cid);
    if (text === "📸 Preuves")        return showAdminProofs(cid);
    if (text === "🏧 Retraits")       return showAdminWithdrawals(cid);
    if (text === "💳 Dépôts")         return showAdminDeposits(cid);
    if (text === "🎫 Tickets")        return showAdminTickets(cid);
    if (text === "🏆 Concours Admin") return showAdminGiveaways(cid);
    if (text === "👥 Users")          { setState(uid, "adm_find_user"); return bot.sendMessage(cid, "👥 ID user :", { reply_markup: KB_CANCEL }); }
    if (text === "📢 Broadcast")      { setState(uid, "broadcast"); return bot.sendMessage(cid, "📢 Message :", { reply_markup: KB_CANCEL }); }
    if (text === "💰 Mod. Solde")     { setState(uid, "adm_bal_uid"); return bot.sendMessage(cid, "💰 ID user :", { reply_markup: KB_CANCEL }); }
    if (text === "⛔ Ban/Unban")      { setState(uid, "adm_ban_uid"); return bot.sendMessage(cid, "⛔ ID à ban (préfixe 'unban:' pour débannir) :", { reply_markup: KB_CANCEL }); }
  }

  // ─── FSM ───
  if (!st) return;
  const s    = st.state;
  const data = st.data || {};

  // Dépôt — montant
  if (s === "dep_amount") {
    const amount = parseFloat(text);
    const m      = config.DEPOSIT_METHODS[data.method];
    if (!m || isNaN(amount) || amount < m.minAmount) {
      return bot.sendMessage(cid, `❌ Minimum : ${m?.minAmount || 0} ${m?.symbol || ""}`);
    }
    clearState(uid);
    const depId = db.createDeposit(uid, data.method, amount);
    const depMsg = await payments.buildDepositMessage(data.method, amount, m.wallet, uid, depId);
    bot.sendMessage(cid, depMsg, { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `💳 <b>Nouveau dépôt #${depId}</b>\n👤 ${esc(user.first_name)} (${uid})\n💰 ${amount} ${m.symbol}`,
        { parse_mode: "HTML", reply_markup: KBI([[
          { text: "✅ Confirmer", callback_data: `conf_dep_${depId}` },
          { text: "❌ Rejeter",   callback_data: `rej_dep_${depId}` }
        ]]) }).catch(() => {});
    }
    return;
  }

  // Retrait — wallet
  if (s === "wd_wallet") {
    setState(uid, "wd_amount", { ...data, wallet: text });
    const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    return bot.sendMessage(cid, `👛 OK.\n\n💵 Balance : ${fmt(user.balance)}\nMin : ${fmt(minW)} | Max : ${fmt(maxW)}\n\nMontant :`, { reply_markup: KB_CANCEL });
  }
  if (s === "wd_amount") {
    const amount = parseFloat(text);
    const minW   = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW   = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    user = db.getUser(uid);
    if (isNaN(amount) || amount < minW || amount > maxW || amount > user.balance) {
      return bot.sendMessage(cid, `❌ Invalide.\nMin: ${fmt(minW)} | Max: ${fmt(maxW)} | Balance: ${fmt(user.balance)}`);
    }
    clearState(uid);
    const wdId = db.createWithdrawal(uid, data.method, amount, data.wallet);
    if (!wdId) return bot.sendMessage(cid, "❌ Erreur.", { reply_markup: KB_MAIN(uid) });
    const wd = db.db.prepare("SELECT * FROM withdrawals WHERE withdrawal_id=?").get(wdId);
    bot.sendMessage(cid, `✅ <b>Retrait demandé !</b>\n\n💵 ${fmt(wd.net_amount)} (frais: ${fmt(wd.fee)})\n👛 <code>${data.wallet}</code>\n\n⏳ Traitement sous 24h.`, { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `🏧 <b>Retrait #${wdId}</b>\n👤 ${esc(user.first_name)} (${uid})\n💵 ${fmt(wd.net_amount)}\n👛 <code>${data.wallet}</code>\n📌 ${data.method}`,
        { parse_mode: "HTML", reply_markup: KBI([[
          { text: "✅ Payé",    callback_data: `pay_wd_${wdId}` },
          { text: "❌ Rejeter", callback_data: `rej_wd_${wdId}` }
        ]]) }).catch(() => {});
    }
    return;
  }

  // Créer campagne — FSM (NOUVELLE VERSION)
  if (s === "ct_link") {
    const type = data.type;
    const verif = await verifyChatType(text, type);
    if (!verif.ok) {
      const typeLabel = type === "channel" ? "canal" : type === "group" ? "groupe" : "bot";
      let reason = "Lien invalide.";
      if (verif.reason === "not_channel") reason = `❌ Ce lien n'est pas un <b>canal</b> (c'est un ${verif.got}).`;
      if (verif.reason === "not_group")   reason = `❌ Ce lien n'est pas un <b>groupe</b> (c'est un ${verif.got}).`;
      if (verif.reason === "not_bot")     reason = `❌ Ce lien n'est pas un <b>bot</b>.`;
      if (verif.reason === "not_found")   reason = `❌ Lien introuvable. Vérifie l'orthographe.`;
      if (verif.reason === "invalid_link")reason = `❌ Format de lien invalide.`;
      return bot.sendMessage(cid,
        `${reason}\n\nEnvoie un lien valide vers un <b>${typeLabel}</b> :`,
        { parse_mode: "HTML", reply_markup: KB_CANCEL });
    }

    // Pour canal/groupe : vérifier que le bot est admin
    if (type === "channel" || type === "group") {
      const isAdminOK = await verifyBotIsAdmin(verif.username);
      if (!isAdminOK) {
        if (!botInfo) botInfo = await bot.getMe();
        return bot.sendMessage(cid,
          `❌ <b>Je ne suis pas administrateur de ce ${type === "channel" ? "canal" : "groupe"} !</b>\n\n` +
          `1️⃣ Ajoute <b>@${botInfo.username}</b> comme administrateur\n` +
          `2️⃣ Reviens et renvoie le lien\n\n` +
          `🔐 C'est obligatoire pour vérifier les abonnements.`,
          { parse_mode: "HTML", reply_markup: KB_CANCEL });
      }
    }

    // Tout OK — enregistrer chat_id et lien
    const cleanLink = "https://t.me/" + verif.username;
    setState(uid, "ct_title", { ...data, link: cleanLink, chatId: "@" + verif.username });
    return bot.sendMessage(cid,
      `✅ <b>Lien vérifié !</b>\n\n📝 Envoie maintenant le <b>titre</b> de ta campagne :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  if (s === "ct_title") {
    if (text.length < 3 || text.length > 100) {
      return bot.sendMessage(cid, "❌ Titre entre 3 et 100 caractères.");
    }
    const type = data.type;
    // Pour bot Telegram : pas de durée, juste un temps d'attente fixe
    if (type === "bot") {
      const seconds = parseInt(db.getSetting("bot_wait_seconds", "30"));
      const minPrice = parseFloat(db.getSetting("min_price_bot", "0.01"));
      setState(uid, "ct_reward", { ...data, title: text, durationSeconds: seconds });
      return bot.sendMessage(cid,
        `💰 <b>Récompense par personne ($)</b>\n\n` +
        `⏱ Temps d'attente : <b>${seconds}s</b>\n` +
        `Minimum : <b>${minPrice}$</b>\n\n` +
        `Envoie le montant :`,
        { parse_mode: "HTML", reply_markup: KB_CANCEL });
    }

    // Canal/Groupe : afficher les boutons de durée
    setState(uid, "ct_duration", { ...data, title: text });
    const durations = [1, 12, 24, 48];
    const rows = durations.map(h => {
      const price = parseFloat(db.getSetting(`min_price_${h}h`, "0.01"));
      return [{ text: `⏱ ${h}h — min ${price}$/personne`, callback_data: `ct_dur_${h}` }];
    });
    return bot.sendMessage(cid,
      `⏱ <b>Durée d'abonnement</b>\n\n` +
      `Combien de temps les users doivent rester abonnés ?`,
      { parse_mode: "HTML", reply_markup: KBI(rows) });
  }

  if (s === "ct_reward") {
    const reward = parseFloat(text);
    const type = data.type;
    let minKey;
    if (type === "bot") minKey = "min_price_bot";
    else minKey = `min_price_${data.durationHours}h`;
    const minPrice = parseFloat(db.getSetting(minKey, "0.01"));
    if (isNaN(reward) || reward < minPrice) {
      return bot.sendMessage(cid, `❌ Minimum : ${minPrice}$ par personne.`);
    }
    setState(uid, "ct_budget", { ...data, reward });
    user = db.getUser(uid);
    return bot.sendMessage(cid,
      `💵 <b>Budget total ($)</b>\n\n` +
      `Balance : ${fmt(user.balance)}\n` +
      `Récompense : ${reward}$/personne\n\n` +
      `Le nombre de participants sera calculé automatiquement.\n\n` +
      `Envoie le budget total :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  if (s === "ct_budget") {
    const budget = parseFloat(text);
    user = db.getUser(uid);
    const tt  = config.TASK_TYPES[data.type] || {};
    const fee = tt.platform_fee || 0;
    const totalPerUser = data.reward + fee;
    if (isNaN(budget) || budget < totalPerUser) {
      return bot.sendMessage(cid, `❌ Budget minimum : ${totalPerUser}$ (1 personne).`);
    }
    if (budget > user.balance) {
      return bot.sendMessage(cid, `❌ Solde insuffisant. Balance : ${fmt(user.balance)}`);
    }
    const maxC = Math.floor(budget / totalPerUser);
    const realBudget = maxC * totalPerUser;

    // Calculer expires_at
    let expiresAt = null;
    if (data.type === "channel" || data.type === "group") {
      // Durée de la tâche = 7 jours (l'utilisateur reste durationHours après chaque clic)
      expiresAt = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
    } else {
      expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    }

    // Vérifier solde total (gains + dépôt)
    const total = (user.balance || 0) + (user.deposit_balance || 0);
    if (total < realBudget) {
      return bot.sendMessage(cid, `❌ Solde total insuffisant.\n💰 Gains : ${fmt(user.balance)}\n💳 Dépôt : ${fmt(user.deposit_balance || 0)}`, { parse_mode: "HTML" });
    }

    // Débiter en mode smart (d'abord du dépôt)
    debitSmart(uid, realBudget, "task_creation", `Campagne: ${data.title}`);

    // Insérer la tâche directement (sans utiliser createTask qui refait updateBalance)
    const tt2 = config.TASK_TYPES[data.type] || {};
    const platformFee = tt2.platform_fee || 0;
    const insertResult = db.db.prepare(`
      INSERT INTO tasks (creator_id, type, title, description, link, chat_id, proof_required, proof_instructions, reward, platform_fee, max_completions, budget, budget_remaining, countries, min_level, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, ?, NULL, 1, ?)
    `).run(
      uid, data.type, data.title,
      data.type === "bot" ? `Temps d'attente : ${data.durationSeconds}s` : `Reste abonné ${data.durationHours}h minimum`,
      data.link, data.chatId || null,
      data.reward, platformFee, maxC, realBudget, realBudget, expiresAt
    );
    const taskId = insertResult.lastInsertRowid;
    db.db.prepare("UPDATE users SET tasks_created = tasks_created + 1 WHERE user_id = ?").run(uid);

    clearState(uid);
    if (!taskId) return bot.sendMessage(cid, "❌ Erreur création.", { reply_markup: KB_MAIN(uid) });

    // Stocker la durée custom dans description (déjà fait)
    const durationTxt = data.type === "bot"
      ? `⏱ ${data.durationSeconds}s`
      : `⏱ ${data.durationHours}h d'abonnement`;

    bot.sendMessage(cid,
      `✅ <b>Campagne soumise !</b>\n\n` +
      `📌 ${esc(data.title)}\n` +
      `💰 ${fmt(data.reward)}/personne\n` +
      `🎯 ${maxC} personnes max\n` +
      `💵 Budget : ${fmt(realBudget)}\n` +
      `${durationTxt}\n\n` +
      `⏳ En attente de validation par l'admin.`,
      { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });

    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `📋 <b>Nouvelle campagne #${taskId}</b>\n\n` +
        `👤 ${esc(user.first_name)} (${uid})\n` +
        `📌 ${esc(data.title)}\n` +
        `💰 ${fmt(data.reward)} × ${maxC} personnes\n` +
        `${durationTxt}\n` +
        `🔗 ${esc(data.link)}`,
        { parse_mode: "HTML", reply_markup: KBI([[
          { text: "✅ Approuver", callback_data: `apr_task_${taskId}` },
          { text: "❌ Rejeter",   callback_data: `rej_task_${taskId}` }
        ]]) }).catch(() => {});
    }
    return;
  }

  // Admin — broadcast
  if (s === "broadcast" && isAdmin(uid)) {
    clearState(uid);
    const all = db.getAllUsers({ banned: false });
    let sent = 0;
    for (const u of all) {
      try { await bot.sendMessage(u.user_id, `📢 <b>Annonce</b>\n\n${esc(text)}`, { parse_mode: "HTML" }); sent++; await new Promise(r=>setTimeout(r,50)); } catch {}
    }
    return bot.sendMessage(cid, `✅ Envoyé à ${sent} users.`, { reply_markup: KB_ADMIN });
  }

  // Admin — modifier solde
  if (s === "adm_bal_uid" && isAdmin(uid)) {
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(cid, "❌ Invalide.");
    setState(uid, "adm_bal_amount", { uid: tid });
    return bot.sendMessage(cid, `Solde de ${tid}: ${fmt((db.getUser(tid)||{}).balance||0)}\n\nMontant (+ ou -) :`, { reply_markup: KB_CANCEL });
  }
  if (s === "adm_bal_amount" && isAdmin(uid)) {
    const amount = parseFloat(text);
    if (isNaN(amount)) return bot.sendMessage(cid, "❌ Invalide.");
    db.updateBalance(data.uid, amount, "admin_edit", `Admin: ${fmtUSD(amount)}`);
    bot.sendMessage(data.uid, `💰 Solde modifié par admin : <b>${amount>0?"+":""}${fmt(amount)}</b>`, { parse_mode: "HTML" }).catch(() => {});
    clearState(uid);
    return bot.sendMessage(cid, `✅ Modifié.`, { reply_markup: KB_ADMIN });
  }

  // Admin — ban/unban
  if (s === "adm_ban_uid" && isAdmin(uid)) {
    clearState(uid);
    if (text.startsWith("unban:")) {
      const tid = parseInt(text.replace("unban:",""));
      db.banUser(tid, false, "");
      bot.sendMessage(tid, "✅ Débanni !").catch(() => {});
      return bot.sendMessage(cid, `✅ ${tid} débanni.`, { reply_markup: KB_ADMIN });
    }
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(cid, "❌ Invalide.");
    db.banUser(tid, true, "Admin");
    bot.sendMessage(tid, "⛔ Compte banni.").catch(() => {});
    return bot.sendMessage(cid, `✅ ${tid} banni.`, { reply_markup: KB_ADMIN });
  }

  // Admin — paramètre
  if (s.startsWith("setval_") && isAdmin(uid)) {
    const key = data.key;
    clearState(uid);
    db.setSetting(key, text);
    return bot.sendMessage(cid, `✅ <b>${key}</b> = <b>${esc(text)}</b>`, { parse_mode: "HTML", reply_markup: KB_ADMIN });
  }

  // Admin — find user
  if (s === "adm_find_user" && isAdmin(uid)) {
    clearState(uid);
    const tid = parseInt(text);
    const tu  = isNaN(tid) ? null : db.getUser(tid);
    if (!tu) return bot.sendMessage(cid, "❌ Introuvable.", { reply_markup: KB_ADMIN });
    return bot.sendMessage(cid,
      `👤 <b>${esc(tu.first_name)}</b> (${tu.user_id})\n💵 ${fmt(tu.balance)}\n✅ ${tu.tasks_completed} tâches\n👥 ${tu.referral_count} filleuls\n${tu.is_banned ? "⛔ BANNI" : "✅ Actif"}`,
      { parse_mode: "HTML", reply_markup: KB_ADMIN });
  }

  // Concours — création FSM
  if (s === "ga_title" && isAdmin(uid)) {
    setState(uid, "ga_winners", { ...data, title: text });
    return bot.sendMessage(cid, "🏆 Combien de gagnants ?", { reply_markup: KB_CANCEL });
  }
  if (s === "ga_winners" && isAdmin(uid)) {
    const n = parseInt(text);
    if (isNaN(n) || n < 1) return bot.sendMessage(cid, "❌ Invalide.");
    setState(uid, "ga_prizes", { ...data, winnersCount: n, prizes: [], currentPrize: 1 });
    return bot.sendMessage(cid, `💰 Prix pour le <b>1er</b> ($) :`, { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }
  if (s === "ga_prizes" && isAdmin(uid)) {
    const p = parseFloat(text);
    if (isNaN(p) || p < 0) return bot.sendMessage(cid, "❌ Invalide.");
    data.prizes.push(p);
    if (data.prizes.length < data.winnersCount) {
      data.currentPrize++;
      setState(uid, "ga_prizes", data);
      return bot.sendMessage(cid, `💰 Prix pour le <b>${data.currentPrize}${data.currentPrize === 1 ? "er" : "ème"}</b> ($) :`, { parse_mode: "HTML", reply_markup: KB_CANCEL });
    }
    setState(uid, "ga_duration", data);
    return bot.sendMessage(cid, "⏰ Durée en heures :", { reply_markup: KB_CANCEL });
  }
  if (s === "ga_duration" && isAdmin(uid)) {
    const hours = parseInt(text);
    if (isNaN(hours) || hours < 1) return bot.sendMessage(cid, "❌ Invalide.");
    setState(uid, "ga_max_participants", { ...data, hours });
    return bot.sendMessage(cid, "👥 Nombre max de participants (0 = illimité) :", { reply_markup: KB_CANCEL });
  }
  if (s === "ga_max_participants" && isAdmin(uid)) {
    const maxP = parseInt(text);
    if (isNaN(maxP)) return bot.sendMessage(cid, "❌ Invalide.");
    clearState(uid);
    const endsAt = new Date(Date.now() + data.hours * 3600000).toISOString();
    const totalPrize = data.prizes.reduce((a,b) => a+b, 0);
    const gaId = db.createGiveaway({
      title:        data.title,
      prizeAmount:  totalPrize,
      winnerCount:  data.winnersCount,
      maxParticipants: maxP > 0 ? maxP : null,
      entryType:    "free",
      entryCost:    0,
      requirements: { gtype: data.gtype, prizes: data.prizes },
      endsAt:       endsAt,
      createdBy:    uid,
    });
    return bot.sendMessage(cid,
      `✅ <b>Concours créé !</b>\n\n📌 ${esc(data.title)}\n🏆 Type : ${data.gtype === "referral" ? "Parrainage" : "Classique"}\n💰 Prix : ${data.prizes.map((p,i)=>`${i+1}er = ${fmt(p)}`).join(", ")}\n⏰ Durée : ${data.hours}h`,
      { parse_mode: "HTML", reply_markup: KB_ADMIN });
  }

  // Support
  if (s === "support_msg") {
    clearState(uid);
    db.createTicket(uid, "Support", text);
    bot.sendMessage(cid, "✅ Message envoyé !", { reply_markup: KB_MAIN(uid) });
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid, `🎫 <b>Ticket</b>\n👤 ${esc(user.first_name)} (${uid})\n💬 ${esc(text)}`, { parse_mode: "HTML" }).catch(() => {});
    }
    return;
  }
});

// ─────────────────────────────────────────────
//  VÉRIF AUTO DÉPÔTS
// ─────────────────────────────────────────────

payments.startAutoDepositChecker(db, config, async (deposit, usdAmount, tx) => {
  try {
    const symbols = { ton:"TON", bnb:"BNB", usdt_bep20:"USDT", usdt_ton:"USDT" };
    const symbol = symbols[deposit.method] || "CRYPTO";
    const user = db.getUser(deposit.user_id);
    if (!user) return;

    // Bascule balance normale → deposit_balance (confirmDeposit a crédité balance)
    db.updateBalance(deposit.user_id, -usdAmount, "deposit_correction", "Bascule vers deposit_balance");
    creditDeposit(deposit.user_id, usdAmount);

    await bot.sendMessage(deposit.user_id,
      `✅ <b>Dépôt confirmé automatiquement !</b>\n\n` +
      `💰 ${tx.amount} ${symbol} → <b>+${fmt(usdAmount)}</b>\n` +
      `🔗 <code>${tx.txHash}</code>\n\n` +
      `💳 Balance dépôt : <b>${fmt((db.getUser(deposit.user_id)).deposit_balance)}</b>\n\n` +
      `ℹ️ Utilisable pour jeux et campagnes.`,
      { parse_mode: "HTML" });
  } catch (e) { console.error("Auto dep notif:", e.message); }
});

// ─────────────────────────────────────────────
//  KEEP-ALIVE
// ─────────────────────────────────────────────

const http = require("http");
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("✅ ADCRYPTON Bot running!");
}).listen(process.env.PORT || 3000, () => {
  console.log(`✅ Keep-alive on port ${process.env.PORT || 3000}`);
});

// ─── Init defaults ───
const defaults = {
  "min_price_1h":  "0.01",
  "min_price_12h": "0.02",
  "min_price_24h": "0.03",
  "min_price_48h": "0.05",
  "min_price_bot": "0.01",
  "bot_wait_seconds": "30",
  "dice_multiplier":     "1.5",
  "coinflip_multiplier": "1.6",
  "jackpot_chance":      "0.2",
  "jackpot_cost":        "0.10",
  "guess_cost":          "0.05",
  "guess_prize":         "0.30",
};
for (const [k, v] of Object.entries(defaults)) {
  if (db.getSetting(k, null) === null || db.getSetting(k, "") === "") {
    db.setSetting(k, v);
  }
}

// Reset des valeurs des jeux trop élevées (ancienne version)
const cur_dice = parseFloat(db.getSetting("dice_multiplier", "1.5"));
if (cur_dice >= 1.8) db.setSetting("dice_multiplier", "1.5");
const cur_cf = parseFloat(db.getSetting("coinflip_multiplier", "1.6"));
if (cur_cf >= 1.8) db.setSetting("coinflip_multiplier", "1.6");
const cur_jp = parseFloat(db.getSetting("jackpot_chance", "0.2"));
if (cur_jp >= 1) db.setSetting("jackpot_chance", "0.2");

bot.on("polling_error", e => console.error("Polling:", e.message));
process.on("uncaughtException",  e => console.error("Exception:", e.message));
process.on("unhandledRejection", e => console.error("Rejection:", e));

console.log("🚀 ADCRYPTON Bot démarré !");

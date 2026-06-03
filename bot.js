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
  if (!cols.find(c => c.name === "daily_streak")) {
    db.db.prepare("ALTER TABLE users ADD COLUMN daily_streak INTEGER DEFAULT 0").run();
    console.log("✅ Migration: daily_streak ajouté");
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
// Utilisé pour création de campagnes et achat VIP
function debitSmart(uid, amount, type, description) {
  const u = db.getUser(uid);
  if (!u) return false;
  const total = (u.balance || 0) + (u.deposit_balance || 0);
  if (total < amount) return false;

  let remainingToTake = amount;
  // 1) Prendre du dépôt d'abord
  const fromDeposit = Math.min(u.deposit_balance || 0, remainingToTake);
  if (fromDeposit > 0) {
    const newDep = Math.round(((u.deposit_balance || 0) - fromDeposit) * 10000) / 10000;
    db.db.prepare("UPDATE users SET deposit_balance=? WHERE user_id=?").run(newDep, uid);
    remainingToTake -= fromDeposit;
  }
  // 2) Puis de la balance retirable — UPDATE direct pour préserver 4 décimales
  if (remainingToTake > 0) {
    const uAfter = db.getUser(uid);
    const newBal = Math.round(((uAfter.balance || 0) - remainingToTake) * 10000) / 10000;
    db.db.prepare("UPDATE users SET balance=? WHERE user_id=?").run(newBal, uid);
  }
  // Log transaction
  try {
    db.db.prepare("INSERT INTO transactions (user_id, type, amount, description) VALUES (?,?,?,?)")
      .run(uid, type, -amount, description);
  } catch {}
  return true;
}

// Crédite la balance retirable (gains, rewards) — préserve 4 décimales
function creditEarnings(uid, amount, type, description) {
  const u = db.getUser(uid);
  if (!u) return false;
  // Arrondi à 4 décimales (pas 2 comme updateBalance par défaut)
  const newBalance = Math.round(((u.balance || 0) + amount) * 10000) / 10000;
  db.db.prepare("UPDATE users SET balance=?, last_active=CURRENT_TIMESTAMP WHERE user_id=?").run(newBalance, uid);
  if (amount > 0 && (type.includes("reward") || type.includes("task") || type.includes("win"))) {
    db.db.prepare("UPDATE users SET total_earned = total_earned + ? WHERE user_id=?").run(amount, uid);
  }
  // Log transaction
  try {
    db.db.prepare("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)").run(uid, type, amount, description);
  } catch {}
  return true;
}

// Crédite le dépôt (non retirable) — 4 décimales
function creditDeposit(uid, amount) {
  const u = db.getUser(uid);
  if (!u) return;
  const newDep = Math.round(((u.deposit_balance || 0) + amount) * 10000) / 10000;
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

function fmt(amountUSD) {
  // Devise interne TOUJOURS en USD
  // Affichage : 4 décimales si < 0.01, sinon 2 décimales
  const n = Number(amountUSD || 0);
  if (n === 0) return "0.00$";
  if (Math.abs(n) < 0.01) return `${n.toFixed(4)}$`;
  return `${n.toFixed(2)}$`;
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

// ─────────────────────────────────────────────
//  CLAVIERS
// ─────────────────────────────────────────────

function KB(rows)  { return { keyboard: rows, resize_keyboard: true, one_time_keyboard: false }; }
function KBI(rows) { return { inline_keyboard: rows }; }

function KB_MAIN(uid) {
  const rows = [
    ["💰 Gains",     "📋 Tâches"],
    ["🏆 Concours",  "🎁 Bonus du jour"],
    ["👥 Parrainer", "👤 Profil"],
    ["💬 Support"],
  ];
  if (isAdmin(uid)) rows.push(["👑 Admin"]);
  return KB(rows);
}

const KB_BALANCE  = KB([["💰 Déposer","🏧 Retirer"],["📋 Historique","📜 Transactions"],["🏠 Accueil"]]);
const KB_TASKS    = KB([["📢 Canaux","👥 Groupes"],["🤖 Bots","🎮 Mini Apps"],["➕ Créer Campagne","📊 Mes Campagnes"],["🏠 Accueil"]]);
const KB_PARRAIN  = KB([["🔗 Mon Lien"],["🏠 Accueil"]]);
const KB_ADMIN    = KB([
  ["📊 Stats","⚙️ Config Bot"],
  ["📝 Messages","💎 VIP & Niveaux"],
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
    `🛡️ <b>Vérification rapide</b>\n\n` +
    `Résous ce calcul pour continuer :\n\n` +
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
        `🎉 <b>Nouveau filleul !</b>\n\n👤 <b>${esc(msg.from.first_name)}</b> vient de rejoindre via ton lien.\n💰 +<b>${fmt(bonus)}</b> crédité dans tes gains !`,
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
    const botName = db.getSetting("bot_name","ADCRYPTON");
    const refBonus = parseFloat(db.getSetting("referral_bonus", config.REFERRAL_BONUS));
    const dailyMin = parseFloat(db.getSetting("daily_bonus_min", config.DAILY_BONUS_MIN));
    const dailyMax = parseFloat(db.getSetting("daily_bonus_max", config.DAILY_BONUS_MAX));
    const welcomeBody = db.getSetting("welcome_text",
      `Gagne de l'argent réel en crypto — directement sur Telegram.\n\n` +
      `✅ <b>Tâches</b> — rejoins des canaux, gagne à chaque fois\n` +
      `👥 <b>Parrainage</b> — ${fmt(refBonus)} par ami invité\n` +
      `🎁 <b>Bonus quotidien</b> — connexion = argent\n\n` +
      `💸 Paiements en TON · BNB · USDT`
    );
    await bot.sendMessage(cid,
      `🚀 <b>Bienvenue sur ${esc(botName)} !</b>\n\n` +
      welcomeBody + `\n\n━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🛡️ Confirme que tu es humain pour continuer :`,
      { parse_mode: "HTML" });
    return sendCaptcha(cid, uid);
  }

  // Canaux obligatoires
  if (!await checkRequiredChannels(uid)) {
    const botNameJoin = db.getSetting("bot_name","ADCRYPTON");
    return bot.sendMessage(cid,
      `📢 <b>Dernière étape !</b>\n\nPour accéder à <b>${esc(botNameJoin)}</b>, rejoins nos canaux officiels :`,
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
      await bot.editMessageText("✅ <b>Identité confirmée !</b>\n\nBienvenue 🎉", { chat_id: cid, message_id: mid, parse_mode: "HTML" });
      if (!await checkRequiredChannels(uid)) {
        const botName2 = db.getSetting("bot_name","ADCRYPTON");
        return bot.sendMessage(cid,
          `📢 <b>Dernière étape !</b>\n\nRejoins nos canaux officiels pour accéder à <b>${esc(botName2)}</b> :`,
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

  if (data === "go_home") {
    clearState(uid);
    return sendHome(cid, db.getUser(uid));
  }

  if (data === "claim_daily_bonus") {
    return claimBonus(cid, uid);
  }

  // ─── Tâches ───
  if (data.startsWith("start_task_"))    return handleStartTask(cid, uid, parseInt(data.replace("start_task_","")), user);
  if (data.startsWith("verify_task_"))   return handleVerifyTask(cid, uid, parseInt(data.replace("verify_task_","")), user);
  if (data.startsWith("send_proof_"))    {
    const tid = parseInt(data.replace("send_proof_",""));
    setState(uid, "task_proof", { taskId: tid });
    return bot.sendMessage(cid, "📸 Envoie une <b>capture d'écran</b> comme preuve :", { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // ─── Concours ───
  if (data.startsWith("join_ga_")) {
    const gaId = parseInt(data.replace("join_ga_",""));
    const r = db.enterGiveaway(gaId, uid, 1);
    if (r && r.success) return bot.sendMessage(cid, "✅ Inscrit au concours !\nLe tirage sera fait à la fin par l'admin.");
    const reasonMap = { not_active: "Concours terminé", already_entered: "Déjà inscrit", insufficient_balance: "Solde insuffisant", max_participants: "Concours plein" };
    return bot.sendMessage(cid, `❌ ${reasonMap[r?.reason] || "Impossible"}.`);
  }

  // ─── VIP Purchase ───
  if (data.startsWith("buy_vip_")) {
    const vipLvl = parseInt(data.replace("buy_vip_",""));
    if (vipLvl < 1 || vipLvl > 4) return;
    const vipNames2 = { 1: "🥉 Bronze", 2: "🥈 Silver", 3: "🥇 Gold", 4: "💎 Diamond" };
    const defConf2  = config.VIP_LEVELS[vipLvl] || {};
    const price2    = parseFloat(db.getSetting(`vip_${vipLvl}_price`, defConf2.price || 0));
    if (user.vip_level >= vipLvl) {
      return bot.answerCallbackQuery(q.id, { text: "✅ Tu as déjà ce niveau VIP ou supérieur." });
    }
    setState(uid, "vip_confirm", { level: vipLvl, price: price2 });
    return bot.sendMessage(cid,
      `💎 <b>Acheter VIP ${vipNames2[vipLvl]}</b>\n\n` +
      `💰 Prix : <b>${fmt(price2)}</b>\n` +
      `💳 Sera débité de ton solde (dépôt puis gains).\n\n` +
      `Confirmes-tu l'achat ?`,
      { parse_mode: "HTML", reply_markup: KBI([
        [{ text: "✅ Confirmer", callback_data: `vip_buy_confirm_${vipLvl}` },
         { text: "❌ Annuler",   callback_data: "vip_buy_cancel" }]
      ]) });
  }
  if (data.startsWith("vip_buy_confirm_")) {
    const vipLvl2 = parseInt(data.replace("vip_buy_confirm_",""));
    const st3 = getState(uid);
    if (!st3 || st3.state !== "vip_confirm" || st3.data.level !== vipLvl2) return;
    clearState(uid);
    const vipNames3 = { 1: "🥉 Bronze", 2: "🥈 Silver", 3: "🥇 Gold", 4: "💎 Diamond" };
    const defConf3  = config.VIP_LEVELS[vipLvl2] || {};
    const price3    = parseFloat(db.getSetting(`vip_${vipLvl2}_price`, defConf3.price || 0));
    const ok = debitSmart(uid, price3, "vip_purchase", `Achat VIP ${vipNames3[vipLvl2]}`);
    if (!ok) {
      return bot.sendMessage(cid,
        `❌ Solde insuffisant.\n\n💰 Requis : <b>${fmt(price3)}</b>\n\nDépose des fonds pour acheter le VIP.`,
        { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
    }
    const vipExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.db.prepare("UPDATE users SET vip_level = ?, vip_expires_at = ?, total_spent = total_spent + ? WHERE user_id = ?")
      .run(vipLvl2, vipExpiresAt, price3, uid);
    db.db.prepare("INSERT INTO vip_purchases (user_id, vip_level, amount, expires_at) VALUES (?,?,?,?)")
      .run(uid, vipLvl2, price3, vipExpiresAt);
    return bot.sendMessage(cid,
      `🎉 <b>Félicitations !</b>\n\nTu es maintenant <b>${vipNames3[vipLvl2]}</b> !\n\n` +
      `✅ Avantages activés immédiatement.`,
      { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
  }
  if (data === "vip_buy_cancel") {
    clearState(uid);
    return bot.editMessageText("❌ Achat VIP annulé.", { chat_id: cid, message_id: mid }).catch(() =>
      bot.sendMessage(cid, "❌ Achat VIP annulé.", { reply_markup: KB_MAIN(uid) }));
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
  if (data === "wd_confirm") {
    const st2 = getState(uid);
    if (!st2 || st2.state !== "wd_pending_confirm") return;
    const { method, amount, wallet } = st2.data;
    clearState(uid);
    const wdId = db.createWithdrawal(uid, method, amount, wallet);
    if (!wdId) return bot.sendMessage(cid, "❌ Erreur lors de la création du retrait.", { reply_markup: KB_MAIN(uid) });
    const wd = db.db.prepare("SELECT * FROM withdrawals WHERE withdrawal_id=?").get(wdId);
    bot.sendMessage(cid,
      `✅ <b>Retrait soumis avec succès !</b>\n\n` +
      `💵 Tu recevras : <b>${fmt(wd.net_amount)}</b>\n` +
      `👛 Vers : <code>${wallet}</code>\n\n` +
      `⏳ Traitement sous 24h.`,
      { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
    // Notif canal paiements — retraits en attente supprimés (on poste seulement les confirmés)
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `🏧 <b>Retrait #${wdId}</b>\n👤 ${esc(user.first_name)} (${uid})\n💵 ${fmt(wd.net_amount)} (frais: ${fmt(wd.fee)})\n👛 <code>${wallet}</code>\n📌 ${method}`,
        { parse_mode: "HTML", reply_markup: KBI([[
          { text: "✅ Payé",    callback_data: `pay_wd_${wdId}` },
          { text: "❌ Rejeter", callback_data: `rej_wd_${wdId}` }
        ]]) }).catch(() => {});
    }
    return;
  }
  if (data === "wd_cancel") {
    clearState(uid);
    return bot.editMessageText("❌ Retrait annulé.", { chat_id: cid, message_id: mid }).catch(() =>
      bot.sendMessage(cid, "❌ Retrait annulé.", { reply_markup: KB_MAIN(uid) }));
  }
  if (data.startsWith("wd_preset_")) {
    const parts = data.replace("wd_preset_","").split("_");
    const presetAmt = parseFloat(parts[0]);
    // Treat like user typed the amount while in wd_amount state
    const stNow = getState(uid);
    if (!stNow || stNow.state !== "wd_amount") return;
    const method = stNow.data.method;
    const minW2  = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW2  = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    const u2     = db.getUser(uid);
    if (isNaN(presetAmt) || presetAmt < minW2 || presetAmt > maxW2 || presetAmt > u2.balance) {
      return bot.answerCallbackQuery(q.id, { text: `❌ Montant invalide ou solde insuffisant.` });
    }
    const feeP3 = parseFloat(db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT));
    const fee3  = Math.round(presetAmt * (feeP3 / 100) * 100) / 100;
    const net3  = Math.round((presetAmt - fee3) * 100) / 100;
    setState(uid, "wd_wallet", { method, amount: presetAmt, fee: fee3, netAmount: net3 });
    return bot.sendMessage(cid,
      `👛 Envoie maintenant ton adresse wallet <b>${config.WITHDRAWAL_METHODS[method]?.name}</b> :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }
  if (data.startsWith("wd_") && !data.startsWith("wd_confirm") && !data.startsWith("wd_cancel") && !data.startsWith("wd_wallet") && !data.startsWith("wd_pending")) {
    const method = data.replace("wd_","");
    if (!config.WITHDRAWAL_METHODS[method]) return;
    const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    setState(uid, "wd_amount", { method });
    const presets = [5, 10, 25, 50].filter(p => p >= minW && p <= maxW && p <= user.balance);
    const presetRows = presets.length
      ? [presets.map(p => ({ text: `${p}$`, callback_data: `wd_preset_${p}_${method}` }))]
      : [];
    const allPresetRows = [
      ...presetRows,
      [{ text: "❌ Annuler", callback_data: "wd_cancel" }]
    ];
    return bot.sendMessage(cid,
      `🏧 <b>RETRAIT ${config.WITHDRAWAL_METHODS[method]?.name}</b>\n\n` +
      `💰 Solde retirable : <b>${fmt(user.balance)}</b>\n` +
      `📌 Min : <b>${fmt(minW)}</b> · Max : <b>${fmt(maxW)}</b>\n\n` +
      `Choisis un montant ou tape le montant souhaité :`,
      { parse_mode: "HTML", reply_markup: KBI(allPresetRows) });
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
    const minPrice = parseFloat(db.getSetting(minKey, "0.001"));
    const realMin = Math.max(minPrice, 0.001);
    const minTxt = realMin < 0.01 ? realMin.toFixed(4) : realMin.toFixed(2);
    setState(uid, "ct_reward", st.data);
    return bot.sendMessage(cid,
      `💰 <b>Récompense par personne ($)</b>\n\n` +
      `Durée choisie : <b>${hours}h</b>\n` +
      `Minimum : <b>${minTxt}$</b>\n\n` +
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
    if (t) bot.sendMessage(t.creator_id,
      `✅ <b>Campagne approuvée !</b>\n\n` +
      `📌 <b>${esc(t.title)}</b>\n` +
      `💰 ${fmt(t.reward)} par personne · ${t.max_completions} participants max\n\n` +
      `Ta campagne est maintenant visible par tous les utilisateurs.`,
      { parse_mode: "HTML" }).catch(() => {});
    return bot.editMessageText((q.message.text || "") + "\n\n✅ APPROUVÉ", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("rej_task_")) {
    const tid = parseInt(data.replace("rej_task_",""));
    db.rejectTask(tid, "Rejeté");
    const t = db.getTask(tid);
    if (t) bot.sendMessage(t.creator_id,
      `❌ <b>Campagne rejetée</b>\n\n` +
      `📌 ${esc(t.title)}\n\n` +
      `Ton budget a été remboursé intégralement.\n` +
      `Contacte le support si tu as des questions.`,
      { parse_mode: "HTML" }).catch(() => {});
    return bot.editMessageText((q.message.text || "") + "\n\n❌ REJETÉ", { chat_id: cid, message_id: mid });
  }

  // Admin — Preuves
  if (data.startsWith("apr_proof_")) {
    const cmpId = parseInt(data.replace("apr_proof_",""));
    const comp = db.db.prepare("SELECT * FROM task_completions WHERE completion_id=?").get(cmpId);
    if (comp) {
      const r = db.verifyTaskCompletion(comp.task_id, comp.user_id, true);
      if (r.success) bot.sendMessage(comp.user_id,
        `✅ <b>Preuve validée !</b>\n\n💰 +<b>${fmt(r.reward)}</b> crédité dans tes gains.\n\nMerci pour ta participation !`,
        { parse_mode: "HTML" }).catch(() => {});
    }
    return bot.editMessageCaption((q.message.caption || "") + "\n\n✅ APPROUVÉ", { chat_id: cid, message_id: mid }).catch(() => {
      bot.editMessageText((q.message.text || "") + "\n\n✅ APPROUVÉ", { chat_id: cid, message_id: mid }).catch(() => {});
    });
  }
  if (data.startsWith("rej_proof_")) {
    const cmpId = parseInt(data.replace("rej_proof_",""));
    const comp = db.db.prepare("SELECT * FROM task_completions WHERE completion_id=?").get(cmpId);
    db.db.prepare("UPDATE task_completions SET status='rejected' WHERE completion_id=?").run(cmpId);
    if (comp) bot.sendMessage(comp.user_id,
      `❌ <b>Preuve refusée</b>\n\nTa preuve n'a pas été acceptée.\nTu peux retenter ou contacter le support via 💬 Support.`,
      { parse_mode: "HTML" }).catch(() => {});
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
      `💎 ${dep.amount} ${symbol} → <b>+${fmt(usdAmount)}</b>\n\n` +
      `💳 Ajouté à ta balance dépôt.\n` +
      `📌 Utilisable pour créer des campagnes et jouer aux mini-jeux.\n\n` +
      `Ton nouveau solde dépôt : <b>${fmt((db.getUser(dep.user_id) || {}).deposit_balance || 0)}</b>`,
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

      const wdUser = db.getUser(wd.user_id);
      // Notification à l'utilisateur
      bot.sendMessage(wd.user_id,
        `✅ <b>Ton retrait a été envoyé !</b>\n\n` +
        `💵 Montant : <b>${fmt(wd.net_amount)}</b>${cryptoTxt}\n` +
        `👛 Adresse : <code>${wd.wallet_address}</code>\n\n` +
        `Merci pour ta confiance 🙏`,
        { parse_mode: "HTML" }).catch(() => {});
      // Notification canal paiements — seulement les retraits confirmés
      const payChannel = db.getSetting("payment_channel","");
      if (payChannel) {
        const wdDate = new Date().toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
        const walletShort = wd.wallet_address.length > 12
          ? wd.wallet_address.slice(0,6) + "..." + wd.wallet_address.slice(-4)
          : wd.wallet_address;
        const botName = db.getSetting("bot_name", "ADCRYPTON");
        bot.sendMessage(payChannel,
          `✅ <b>Retrait confirmé</b>\n\n` +
          `👤 ID : <code>${wd.user_id}</code>\n` +
          `💵 Montant : <b>${fmt(wd.net_amount)}</b>${cryptoTxt}\n` +
          `💎 Méthode : <b>${wdSym}</b>\n` +
          `👛 Adresse : <code>${walletShort}</code>\n` +
          `🕐 ${wdDate}\n\n` +
          `💸 Rejoins <b>${esc(botName)}</b> et gagne toi aussi !`,
          { parse_mode: "HTML" }).catch(() => {});
      }
    }
    return bot.editMessageText((q.message.text || "") + "\n\n✅ PAYÉ", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("rej_wd_")) {
    const wdId = parseInt(data.replace("rej_wd_",""));
    const wd   = db.rejectWithdrawal(wdId);
    if (wd) bot.sendMessage(wd.user_id,
      `❌ <b>Retrait annulé</b>\n\n` +
      `💵 ${fmt(wd.amount)} a été remboursé dans ton solde.\n\n` +
      `Si tu as des questions, contacte le support via 💬 Support.`,
      { parse_mode: "HTML" }).catch(() => {});
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

  // Admin — Tickets
  if (data.startsWith("reply_ticket_")) {
    const tid = parseInt(data.replace("reply_ticket_",""));
    const t = db.getTicket(tid);
    if (!t) return bot.sendMessage(cid, "❌ Ticket introuvable.");
    setState(uid, "ticket_reply", { ticketId: tid, userId: t.user_id, firstName: t.first_name });
    return bot.sendMessage(cid,
      `💬 <b>Répondre à ${esc(t.first_name)} :</b>\n\n"${esc((t.message || "").substring(0,150))}"`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }
  if (data.startsWith("close_ticket_")) {
    const tid = parseInt(data.replace("close_ticket_",""));
    db.closeTicket(tid);
    return bot.editMessageText((q.message.text || "") + "\n\n✅ FERMÉ", { chat_id: cid, message_id: mid }).catch(() => {});
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
  db.resetDailyTasksIfNeeded(user.user_id);
  user = db.getUser(user.user_id);
  const botName = db.getSetting("bot_name", "ADCRYPTON");
  const maxT    = db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY);

  const earnedBal = user.balance || 0;
  const depBal    = user.deposit_balance || 0;
  const streak    = user.daily_streak || 0;
  const lastBonus = user.last_daily_bonus ? new Date(user.last_daily_bonus) : null;
  const bonusReady = !lastBonus || new Date().toDateString() !== lastBonus.toDateString();

  const bonusTxt  = bonusReady ? `\n\n🎁 <b>Bonus du jour disponible !</b>` : "";
  const streakTxt = streak > 0 ? `\n🔥 Série : <b>${streak} jour${streak > 1 ? "s" : ""}</b>` : "";
  const homeExtra = db.getSetting("home_extra_text", "");
  const extraTxt  = homeExtra ? `\n\n${homeExtra}` : "";
  bot.sendMessage(cid,
    `🏠 <b>${esc(botName)}</b>\n\n` +
    `👋 Salut <b>${esc(user.first_name)}</b> !\n\n` +
    `💰 Gains : <b>${fmt(earnedBal)}</b>\n` +
    `💳 Dépôt : <b>${fmt(depBal)}</b>\n\n` +
    `📋 Tâches aujourd'hui : <b>${user.daily_tasks_done}/${maxT}</b>\n` +
    `👥 Filleuls : <b>${user.referral_count}</b>` +
    streakTxt + bonusTxt + extraTxt,
    { parse_mode: "HTML", reply_markup: KB_MAIN(user.user_id) });
}

// ─────────────────────────────────────────────
//  TÂCHES
// ─────────────────────────────────────────────

function showTasksMenu(cid, user) {
  const maxT = db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY);
  bot.sendMessage(cid,
    `📋 <b>TÂCHES</b>\n\n` +
    `📅 Aujourd'hui : <b>${user.daily_tasks_done || 0}/${maxT}</b> tâches complétées\n\n` +
    `Choisis une catégorie pour commencer à gagner :`,
    { parse_mode: "HTML", reply_markup: KB_TASKS });
}

async function showTasksByType(cid, uid, type, user) {
  const maxT = parseInt(db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY));
  if ((user.daily_tasks_done || 0) >= maxT) {
    return bot.sendMessage(cid, `⏰ <b>Limite atteinte</b>\n\nTu as fait ${maxT}/${maxT} tâches aujourd'hui.\nReviens demain !`, { parse_mode: "HTML" });
  }

  const tasks = db.getActiveTasks(type, uid);
  const typeNames = { channel: "📢 Canal", group: "👥 Groupe", bot: "🤖 Bot", miniapp: "🎮 Mini App" };
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
    if (task.type === "bot" || task.type === "miniapp") {
      const secs = parseInt(db.getSetting("bot_wait_seconds", "30"));
      durTxt = `⏱ Attente : ${secs}s`;
    } else {
      // Parse description pour récupérer la durée
      const m = (task.description || "").match(/(\d+)h/);
      const hours = m ? m[1] : "24";
      durTxt = `⏱ Reste abonné : ${hours}h`;
    }

    const completionsTxt = task.current_completions > 0
      ? `\n✅ Déjà complété par <b>${task.current_completions}</b> personne${task.current_completions > 1 ? "s" : ""}`
      : "";
    await bot.sendMessage(cid,
      `${typeLabel} <b>${esc(task.title)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Récompense : <b>${fmt(task.reward)}</b>\n` +
      `${durTxt}${completionsTxt}`,
      {
        parse_mode: "HTML",
        reply_markup: KBI([
          [{ text: "🔗 Ouvrir le lien", url: task.link }],
          [{ text: "▶️ Démarrer la tâche", callback_data: `start_task_${task.task_id}` }]
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

  // ─── BOT TELEGRAM ou MINI APP ───
  if (task.type === "bot" || task.type === "miniapp") {
    // Démarrer la complétion : INSERT direct, fiable
    if (!existing) {
      const secsWait = parseInt(db.getSetting("bot_wait_seconds", "30"));
      const mustStayUntil = new Date(Date.now() + secsWait * 1000).toISOString();
      try {
        db.db.prepare(
          "INSERT INTO task_completions (task_id, user_id, reward, must_stay_until, status) VALUES (?, ?, ?, ?, 'pending')"
        ).run(taskId, uid, task.reward, mustStayUntil);
      } catch (e) {
        console.error("Insert completion error:", e.message);
        return bot.sendMessage(cid, "❌ Erreur de démarrage. Réessaie.");
      }
    }
    const secs = parseInt(db.getSetting("bot_wait_seconds", "30"));
    const label = task.type === "miniapp" ? "Mini App" : "Bot";
    const action = task.type === "miniapp" ? "Ouvre et utilise la Mini App" : "Ouvre le bot et clique /start";
    return bot.sendMessage(cid,
      `▶️ <b>Démarre la ${label}</b>\n\n` +
      `📌 ${esc(task.title)}\n` +
      `💰 Récompense : <b>${fmt(task.reward)}</b>\n\n` +
      `1️⃣ ${action}\n` +
      `2️⃣ Reviens ici dans <b>${secs}s</b>\n` +
      `3️⃣ Clique "Valider"`,
      { parse_mode: "HTML", reply_markup: KBI([
        [{ text: `🔗 Ouvrir`, url: task.link }],
        [{ text: `✅ Valider (après ${secs}s)`, callback_data: `verify_task_${taskId}` }]
      ]) });
  }

  return bot.sendMessage(cid, "❌ Type de tâche non supporté.");
}

async function handleVerifyTask(cid, uid, taskId, user) {
  const task = db.getTask(taskId);
  if (!task) return bot.sendMessage(cid, "❌ Tâche introuvable.");
  if (task.status !== "active") return bot.sendMessage(cid, "❌ Cette tâche n'est plus disponible.");

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

  // Vérif délai pour bot ou miniapp
  if (task.type === "bot" || task.type === "miniapp") {
    // Utiliser must_stay_until si dispo, sinon calculer depuis started_at
    let remainingSec = 0;
    if (existing.must_stay_until) {
      remainingSec = Math.ceil((new Date(existing.must_stay_until).getTime() - Date.now()) / 1000);
    } else {
      const secs = parseInt(db.getSetting("bot_wait_seconds", "30"));
      const startedAt = new Date(existing.completed_at).getTime();
      const elapsed = (Date.now() - startedAt) / 1000;
      remainingSec = Math.ceil(secs - elapsed);
    }
    if (remainingSec > 0) {
      return bot.sendMessage(cid,
        `⏳ <b>Attends encore ${remainingSec}s !</b>`,
        { parse_mode: "HTML" });
    }
  }

  // Tout OK — créditer
  const r = db.verifyTaskCompletion(taskId, uid, true);
  if (r.success) {
    const nuAfter = db.getUser(uid);
    let msg = `✅ <b>Tâche validée !</b>\n\n💰 +<b>${fmt(r.reward)}</b> crédité !\n💵 Gains : <b>${fmt(nuAfter.balance)}</b>`;
    if (r.levelUp && r.levelUp.leveledUp) {
      msg += `\n\n🎉 <b>NIVEAU ${r.levelUp.newLevel} ATTEINT !</b>`;
      if (r.levelUp.reward > 0) msg += `\n🎁 Bonus : +<b>${fmt(r.levelUp.reward)}</b>`;
    }
    // Notifier le créateur si la campagne vient de se terminer
    if (r.taskCompleted && r.task) {
      const creatorId = r.task.creator_id;
      if (creatorId && creatorId !== uid) {
        bot.sendMessage(creatorId,
          `📢 <b>Campagne terminée !</b>\n\n` +
          `📋 <b>${esc(r.task.title)}</b>\n` +
          `✅ Toutes les places ont été complétées.\n` +
          `💰 Budget utilisé : <b>${fmt(r.task.budget - (r.task.budget_remaining || 0))}</b>`,
          { parse_mode: "HTML" }).catch(() => {});
      }
    }
    return bot.sendMessage(cid, msg, { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
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
    `💳 <b>MA BALANCE</b>\n\n` +
    `💰 Gains (retirable)\n` +
    `   <b>${fmt(earned)}</b>\n\n` +
    `💳 Dépôt (campagnes/jeux)\n` +
    `   <b>${fmt(deposit)}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total : <b>${fmt(earned + deposit)}</b>\n` +
    `📥 Déposé : ${fmt(user.total_deposited)} · 📤 Retiré : ${fmt(user.total_withdrawn)}\n\n` +
    `ℹ️ Les fonds déposés ne sont pas retirables.`,
    { parse_mode: "HTML", reply_markup: KB_BALANCE });
}

function showDeposit(cid) {
  const methods = config.DEPOSIT_METHODS;
  const rows = Object.entries(methods)
    .filter(([,m]) => m.enabled)
    .map(([key, m]) => [{ text: `${m.name} — min ${m.minAmount} ${m.symbol}`, callback_data: `dep_${key}` }]);

  bot.sendMessage(cid,
    `💰 <b>DÉPOSER DES FONDS</b>\n\n` +
    `⚡ Détection automatique · Prix temps réel\n\n` +
    `Choisis ta crypto :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showWithdraw(cid, user) {
  const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
  if (user.balance < minW) {
    return bot.sendMessage(cid,
      `🏧 <b>RETRAIT</b>\n\n` +
      `❌ Solde retirable insuffisant.\n\n` +
      `💰 Ton solde : <b>${fmt(user.balance)}</b>\n` +
      `📌 Minimum requis : <b>${fmt(minW)}</b>\n\n` +
      `Continue à compléter des tâches pour atteindre le minimum !`,
      { parse_mode: "HTML" });
  }

  const rows  = Object.entries(config.WITHDRAWAL_METHODS)
    .filter(([,m]) => m.enabled)
    .map(([key,m]) => [{ text: m.name, callback_data: `wd_${key}` }]);

  bot.sendMessage(cid,
    `🏧 <b>RETRAIT</b>\n\n` +
    `💰 Solde retirable : <b>${fmt(user.balance)}</b>\n` +
    `📌 Minimum : <b>${fmt(minW)}</b>\n\n` +
    `Choisis ta méthode de paiement :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showHistory(cid, uid) {
  const deps = db.getUserDeposits(uid, 5);
  const wds  = db.getUserWithdrawals(uid, 5);
  let txt = `📋 <b>HISTORIQUE</b>\n\n`;
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

// ─────────────────────────────────────────────
//  CONCOURS
// ─────────────────────────────────────────────

function showGiveaways(cid) {
  const list = db.getActiveGiveaways();
  let txt = `🏆 <b>CONCOURS ACTIFS</b>\n\n`;
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
    bot.sendMessage(winnerId,
      `🎉 <b>Félicitations — Tu as gagné !</b>\n\n` +
      `🏆 Concours : <b>${esc(ga.title)}</b>\n` +
      `🥇 Position : <b>${i+1}${i === 0 ? "er" : "ème"}</b>\n` +
      `💰 +<b>${fmt(prize)}</b> crédité dans tes gains !`,
      { parse_mode: "HTML" }).catch(() => {});
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
  user = db.getUser(user.user_id);
  const link  = `https://t.me/${botInfo.username}?start=ref_${user.user_id}`;
  const bonus = db.getSetting("referral_bonus", config.REFERRAL_BONUS);
  const pct   = db.getSetting("referral_percent", config.REFERRAL_PERCENT);
  const referrals = db.getUserReferrals(user.user_id, 5);

  let refListTxt = "\n<b>Tes 5 derniers filleuls :</b>\n";
  if (!referrals.length) {
    refListTxt += "Aucun filleul pour le moment.\n";
  } else {
    referrals.forEach((r, i) => {
      refListTxt += `${i+1}. ${esc(r.first_name)} — ✅ ${r.tasks_completed} tâches\n`;
    });
  }

  const shareText = encodeURIComponent(`💰 Gagne de l'argent réel sur Telegram !\n\nRécompenses crypto, tâches simples, jeux. Rejoint maintenant :`);
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${shareText}`;
  bot.sendMessage(cid,
    `👥 <b>PARRAINAGE</b>\n\n` +
    `🔗 Ton lien de parrainage :\n<code>${link}</code>\n\n` +
    `💰 Bonus par filleul : <b>${fmt(bonus)}</b>\n` +
    `📊 Commission sur leurs gains : <b>${pct}%</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 Total filleuls : <b>${user.referral_count}</b>\n` +
    `💸 Gains parrainage : <b>${fmt(user.referral_earnings || 0)}</b>\n` +
    refListTxt,
    { parse_mode: "HTML", reply_markup: KBI([
      [{ text: "📤 Partager mon lien", url: shareUrl }],
      [{ text: "🏠 Accueil", callback_data: "go_home" }]
    ]) });
}

// ─────────────────────────────────────────────
//  BONUS QUOTIDIEN
// ─────────────────────────────────────────────

function claimBonus(cid, uid) {
  const r = db.claimDailyBonus(uid);
  if (!r || !r.success) {
    const u = db.getUser(uid);
    const lastB = u && u.last_daily_bonus ? new Date(u.last_daily_bonus) : null;
    const hoursLeft = lastB ? Math.max(0, Math.ceil((lastB.getTime() + 86400000 - Date.now()) / 3600000)) : 0;
    return bot.sendMessage(cid, `⏰ <b>Déjà réclamé !</b>\n\nProchain bonus dans <b>${hoursLeft}h</b>`, { parse_mode: "HTML" });
  }
  const nu = db.getUser(uid);
  const streakTxt = r.streak > 1 ? `\n🔥 Série : <b>${r.streak} jours</b>${r.multiplier > 1 ? ` · ×${r.multiplier}` : ""}` : "";
  bot.sendMessage(cid,
    `🎁 <b>Bonus réclamé !</b>\n\n` +
    `💰 +<b>${fmt(r.amount)}</b> ajouté à tes gains !${streakTxt}\n\n` +
    `💰 Nouveau solde : <b>${fmt(nu.balance)}</b>`,
    { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
}

function showDailyBonus(cid, uid, user) {
  user = db.getUser(uid);
  const lastBonus = user.last_daily_bonus ? new Date(user.last_daily_bonus) : null;
  const now = new Date();
  const alreadyClaimed = lastBonus && now.toDateString() === lastBonus.toDateString();
  const streak = user.daily_streak || 0;

  const minB = parseFloat(db.getSetting("daily_bonus_min", config.DAILY_BONUS_MIN));
  const maxB = parseFloat(db.getSetting("daily_bonus_max", config.DAILY_BONUS_MAX));
  let multiplier = 1;
  if (streak >= 30) multiplier = 2.0;
  else if (streak >= 14) multiplier = 1.75;
  else if (streak >= 7) multiplier = 1.5;
  else if (streak >= 3) multiplier = 1.25;

  let streakLabel = "";
  if (streak >= 30) streakLabel = "💎 Légendaire (x2.0)";
  else if (streak >= 14) streakLabel = "🥇 Or (x1.75)";
  else if (streak >= 7) streakLabel = "🥈 Argent (x1.5)";
  else if (streak >= 3) streakLabel = "🥉 Bronze (x1.25)";
  else streakLabel = "🆕 Commence une série !";

  const milestones = [3, 7, 14, 30];
  const nextMilestone = milestones.find(m => m > streak) || 30;

  let timeTxt = "";
  if (alreadyClaimed && lastBonus) {
    const nextBonusTime = new Date(lastBonus);
    nextBonusTime.setDate(nextBonusTime.getDate() + 1);
    nextBonusTime.setHours(0, 0, 0, 0);
    const msLeft = Math.max(0, nextBonusTime.getTime() - now.getTime());
    const h = Math.floor(msLeft / 3600000);
    const m = Math.floor((msLeft % 3600000) / 60000);
    timeTxt = `\n⏰ Prochain bonus dans : <b>${h}h ${m}min</b>`;
  }

  const baseRange = `${(minB * multiplier).toFixed(4)}$ – ${(maxB * multiplier).toFixed(4)}$`;

  bot.sendMessage(cid,
    `🎁 <b>BONUS QUOTIDIEN</b>\n\n` +
    `🔥 Série actuelle : <b>${streak} jour${streak > 1 ? "s" : ""}</b>\n` +
    `${streakLabel}\n\n` +
    `💰 Bonus aujourd'hui : <b>${baseRange}</b>\n` +
    (multiplier > 1 ? `✨ Multiplicateur : <b>×${multiplier}</b>\n` : "") +
    `📈 Prochain palier : <b>${nextMilestone} jours</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    (alreadyClaimed
      ? `✅ Déjà réclamé aujourd'hui.${timeTxt}`
      : `🎯 <b>Ton bonus t'attend !</b>`),
    { parse_mode: "HTML",
      reply_markup: alreadyClaimed
        ? KB([["🏠 Accueil"]])
        : KBI([[{ text: "🎁 Réclamer mon bonus !", callback_data: "claim_daily_bonus" }]]) });
}

function showVipShop(cid, uid) {
  const user = db.getUser(uid);
  if (!user) return;
  const vipNames = { 1: "🥉 Bronze", 2: "🥈 Silver", 3: "🥇 Gold", 4: "💎 Diamond" };
  const currentVip = user.vip_level || 0;
  const total = (user.balance || 0) + (user.deposit_balance || 0);

  let txt = `💎 <b>BOUTIQUE VIP</b>\n\n💰 Ton solde : <b>${fmt(total)}</b>\n\n`;
  const rows = [];

  for (let lvl = 1; lvl <= 4; lvl++) {
    const defConf = config.VIP_LEVELS[lvl] || {};
    const price       = parseFloat(db.getSetting(`vip_${lvl}_price`,       defConf.price        || 0));
    const taskBonus   = parseFloat(db.getSetting(`vip_${lvl}_task_bonus_pct`, defConf.bonus_percent || 0));
    const maxTasks    = parseInt  (db.getSetting(`vip_${lvl}_max_tasks`,    defConf.max_tasks_day || 50));
    const feeDiscount = parseFloat(db.getSetting(`vip_${lvl}_fee_discount`, defConf.withdrawal_fee_discount || 0));

    const isCurrent = currentVip === lvl;
    const isOwned   = currentVip > lvl;
    txt += `${vipNames[lvl]}${isCurrent ? " ✅ ACTIF" : isOwned ? " ✓ Déjà dépassé" : ""}\n`;
    txt += `  💰 ${fmt(price)} | +${taskBonus}% tâches | ${maxTasks} tâches/j | -${feeDiscount}% frais\n\n`;

    if (!isCurrent && !isOwned) {
      rows.push([{ text: `Acheter ${vipNames[lvl]} — ${fmt(price)}`, callback_data: `buy_vip_${lvl}` }]);
    }
  }

  rows.push([{ text: "🏠 Accueil", callback_data: "go_home" }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showProfile(cid, uid) {
  const user = db.getUser(uid);
  if (!user) return;
  const thresholds = config.LEVEL_THRESHOLDS;
  const lvl = user.level || 1;
  const xp = user.xp || 0;
  const currThresh = thresholds[lvl - 1] || 0;
  const nextThresh = lvl < thresholds.length ? thresholds[lvl] : thresholds[thresholds.length - 1];
  const pctRaw = lvl >= thresholds.length ? 10 : Math.round(((xp - currThresh) / Math.max(nextThresh - currThresh, 1)) * 10);
  const pct = Math.max(0, Math.min(10, pctRaw));
  const bar = "█".repeat(pct) + "░".repeat(10 - pct);

  const vipNames = { 0: "", 1: "🥉 Bronze", 2: "🥈 Silver", 3: "🥇 Gold", 4: "💎 Diamond" };
  const vipBadge = vipNames[user.vip_level || 0] || "";

  const rankRow = db.db.prepare("SELECT COUNT(*) as r FROM users WHERE total_earned > ? AND is_banned = 0").get(user.total_earned || 0);
  const rank = (rankRow?.r || 0) + 1;
  const streak = user.daily_streak || 0;

  bot.sendMessage(cid,
    `👤 <b>MON PROFIL</b>\n\n` +
    `<b>${esc(user.first_name)}</b>${vipBadge ? ` · ${vipBadge}` : ""}\n` +
    `🆔 <code>${user.user_id}</code>\n\n` +
    `🏆 Niveau <b>${lvl}</b> · ⚡ <b>${xp}</b>/<b>${nextThresh}</b> XP\n` +
    `[${bar}] ${pct * 10}%\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Tâches complétées : <b>${user.tasks_completed}</b>\n` +
    `💰 Total gagné : <b>${fmt(user.total_earned)}</b>\n` +
    `👥 Filleuls : <b>${user.referral_count}</b>\n` +
    `💸 Gains parrainage : <b>${fmt(user.referral_earnings || 0)}</b>\n` +
    `🔥 Série bonus : <b>${streak} jour${streak > 1 ? "s" : ""}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏅 Classement : <b>#${rank}</b>\n` +
    `📅 Inscrit : <b>${fmtDate(user.created_at)}</b>`,
    { parse_mode: "HTML",
      reply_markup: KB([["🏅 Classement", "📜 Transactions"], ["💎 Acheter VIP", "⚙️ Paramètres"], ["🏠 Accueil"]]) });
}

function showLeaderboard(cid, uid) {
  const topEarners   = db.getTopUsers("earned", 10);
  const topTasks     = db.getTopUsers("tasks", 10);
  const topReferrers = db.getTopUsers("referrals", 10);
  const medals = ["🥇", "🥈", "🥉"];

  const myRankRow = db.db.prepare("SELECT COUNT(*) as r FROM users WHERE total_earned > ? AND is_banned = 0").get((db.getUser(uid) || {}).total_earned || 0);
  const myRank = (myRankRow?.r || 0) + 1;

  let txt = `🏅 <b>CLASSEMENT</b>\n\n`;

  txt += `💰 <b>Top Gains</b>\n`;
  topEarners.forEach((u, i) => { txt += `${medals[i] || `${i+1}.`} ${esc(u.first_name)} — ${fmt(u.total_earned)}\n`; });

  txt += `\n📋 <b>Top Tâches</b>\n`;
  topTasks.forEach((u, i) => { txt += `${medals[i] || `${i+1}.`} ${esc(u.first_name)} — ${u.tasks_completed} tâches\n`; });

  txt += `\n👥 <b>Top Parrainage</b>\n`;
  topReferrers.forEach((u, i) => { txt += `${medals[i] || `${i+1}.`} ${esc(u.first_name)} — ${u.referral_count} filleuls\n`; });

  txt += `\n━━━━━━━━━━━━━━━━━━━━━━\n🏅 Ton rang : <b>#${myRank}</b>`;

  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KB([["🏠 Accueil"]]) });
}

function showMyCampaigns(cid, uid) {
  const tasks = db.getUserTasks(uid);
  let txt = `📊 <b>MES CAMPAGNES</b>\n\n`;
  if (!tasks.length) {
    txt += "Aucune campagne créée.\n\n💡 Crée ta première campagne via ➕ Créer Campagne !";
    return bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KB_TASKS });
  }
  const statusEmoji = { pending:"⏳", active:"✅", completed:"🏁", rejected:"❌", paused:"⏸" };
  tasks.slice(0, 10).forEach(t => {
    const emoji = statusEmoji[t.status] || "❓";
    const pct = t.max_completions > 0 ? Math.round((t.current_completions / t.max_completions) * 100) : 0;
    txt += `${emoji} <b>${esc(t.title)}</b>\n` +
           `   📊 ${t.current_completions}/${t.max_completions} (${pct}%) | 💰 ${fmt(t.budget_remaining)}\n\n`;
  });
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KB_TASKS });
}

function showTransactions(cid, uid) {
  const txs = db.getUserTransactions(uid, 15);
  let txt = `📜 <b>TRANSACTIONS</b>\n\n`;
  if (!txs.length) {
    txt += "Aucune transaction.";
  } else {
    const typeEmoji = {
      welcome_bonus:"🎁", daily_bonus:"🎁", task_reward:"✅",
      referral_bonus:"👥", referral_commission:"👥",
      spin_win:"🎡", dice_win:"🎲", cf_win:"🪙", jackpot_win:"🏆", guess_win:"🔢",
      deposit:"💳", withdrawal_pending:"🏧", withdrawal_refund:"🔄",
      task_creation:"➕", level_up:"⭐", admin_edit:"⚙️",
      giveaway_win:"🏆", spin_bet:"🎡", dice_bet:"🎲", cf_bet:"🪙",
      jackpot_bet:"🏆", guess_bet:"🔢",
    };
    txs.forEach(tx => {
      const sign = tx.amount > 0 ? "+" : "";
      const emoji = typeEmoji[tx.type] || "💫";
      const desc = (tx.description || tx.type).substring(0, 40);
      txt += `${emoji} <b>${sign}${fmt(tx.amount)}</b> — ${esc(desc)}\n`;
    });
  }
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KB([["🏠 Accueil"]]) });
}

// ─────────────────────────────────────────────
//  CRÉER CAMPAGNE
// ─────────────────────────────────────────────

function showCreateCampaign(cid, user) {
  const rows = [
    [{ text: "📢 Canal Telegram",  callback_data: "ct_type_channel" }],
    [{ text: "👥 Groupe Telegram", callback_data: "ct_type_group"   }],
    [{ text: "🤖 Bot Telegram",    callback_data: "ct_type_bot"     }],
    [{ text: "🎮 Mini App",        callback_data: "ct_type_miniapp" }],
  ];
  const totalCamp = (user.balance || 0) + (user.deposit_balance || 0);
  bot.sendMessage(cid,
    `➕ <b>CRÉER UNE CAMPAGNE</b>\n\n` +
    `💳 Solde disponible : <b>${fmt(totalCamp)}</b>\n\n` +
    `Quel type de campagne veux-tu lancer ?`,
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
      if (chat.type !== "private") return { ok: false, reason: "not_bot", got: chat.type };
      if (!username.toLowerCase().endsWith("bot")) return { ok: false, reason: "not_bot", got: chat.type };
    } else if (expectedType === "miniapp") {
      // Mini app = lien du type t.me/Bot/AppName?startapp=...
      // Le username de base doit être un bot
      if (chat.type !== "private") return { ok: false, reason: "not_miniapp", got: chat.type };
      if (!username.toLowerCase().endsWith("bot")) return { ok: false, reason: "not_miniapp", got: chat.type };
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
    `💬 <b>SUPPORT</b>\n\n` +
    `${su ? `📩 Tu peux aussi nous contacter directement : @${esc(su)}\n\n` : ""}` +
    `Décris ton problème et nous te répondrons dès que possible :`,
    { parse_mode: "HTML", reply_markup: KB_CANCEL });
  setState(uid, "support_msg");
}

// ─────────────────────────────────────────────
//  PARAMÈTRES USER
// ─────────────────────────────────────────────

function showSettings(cid, user) {
  user = db.getUser(user.user_id);
  const vipNames = { 0:"Aucun", 1:"🥉 Bronze", 2:"🥈 Silver", 3:"🥇 Gold", 4:"💎 Diamond" };
  const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
  const feeP = parseFloat(db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT));
  bot.sendMessage(cid,
    `⚙️ <b>PARAMÈTRES</b>\n\n` +
    `👤 <b>${esc(user.first_name)}</b>\n` +
    `🆔 <code>${user.user_id}</code>\n` +
    `🏆 Niveau <b>${user.level || 1}</b> · ⚡ ${user.xp || 0} XP\n` +
    `💎 VIP : <b>${vipNames[user.vip_level || 0]}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 Code parrainage :\n<code>${user.referral_code || "N/A"}</code>\n\n` +
    `📊 Min retrait : <b>${fmt(minW)}</b>\n` +
    `💸 Frais retrait : <b>${feeP}%</b>\n` +
    `📅 Inscrit : <b>${fmtDate(user.created_at)}</b>`,
    { parse_mode: "HTML", reply_markup: KB([["👤 Profil", "👥 Parrainer"], ["🏠 Accueil"]]) });
}

// ─────────────────────────────────────────────
//  ADMIN
// ─────────────────────────────────────────────

function showAdmin(cid) {
  const s = db.getStats();
  bot.sendMessage(cid,
    `👑 <b>PANNEAU ADMIN</b>\n\n` +
    `👤 <b>${s.users}</b> utilisateurs · <b>${s.activeUsers24h}</b> actifs aujourd'hui\n\n` +
    `⏳ En attente :\n` +
    `   📋 ${s.pendingTasks} tâches · 📸 ${s.pendingProofs} preuves\n` +
    `   🏧 ${s.pendingWithdrawals} retraits · 💳 ${s.pendingDeposits} dépôts\n` +
    `   🎫 ${s.openTickets} tickets\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 Déposé : <b>${fmt(s.totalDeposited)}</b>\n` +
    `💸 Retiré : <b>${fmt(s.totalWithdrawn)}</b>\n` +
    `📈 Profit plateforme : <b>${fmt(s.profit || 0)}</b>`,
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
    `📈 Profit: ${fmt(s.profit || 0)}`,
    { parse_mode: "HTML", reply_markup: KB_ADMIN });
}

function botSettings() {
  return [
    { key: "bot_name",              label: "🤖 Nom du bot" },
    { key: "official_channel",      label: "📢 Canal officiel" },
    { key: "payment_channel",       label: "💸 Canal paiements" },
    { key: "support_username",      label: "🎫 Username support" },
    { key: "referral_bonus",        label: "👥 Bonus parrainage" },
    { key: "referral_percent",      label: "👥 Commission %" },
    { key: "min_withdrawal",        label: "🏧 Min retrait" },
    { key: "max_withdrawal",        label: "🏧 Max retrait" },
    { key: "withdrawal_fee_percent",label: "💸 Frais retrait %" },
    { key: "task_fee_percent",      label: "💸 Frais tâches %" },
    { key: "max_tasks_day",         label: "📋 Max tâches/jour" },
    { key: "min_price_1h",          label: "💰 Min prix 1h" },
    { key: "min_price_12h",         label: "💰 Min prix 12h" },
    { key: "min_price_24h",         label: "💰 Min prix 24h" },
    { key: "min_price_48h",         label: "💰 Min prix 48h" },
    { key: "min_price_bot",         label: "💰 Min prix bot/miniapp" },
    { key: "bot_wait_seconds",      label: "⏱ Attente bot (s)" },
    { key: "maintenance_mode",      label: "🔧 Maintenance" },
  ];
}

function messageSettings() {
  return [
    { key: "welcome_text",          label: "🚀 Texte de bienvenue" },
    { key: "home_extra_text",       label: "🏠 Texte extra accueil" },
    { key: "referral_notif_text",   label: "👥 Notif parrainage" },
    { key: "deposit_confirm_text",  label: "💳 Confirmation dépôt" },
    { key: "withdrawal_confirm_text", label: "🏧 Confirmation retrait" },
    { key: "task_complete_text",    label: "✅ Tâche validée" },
    { key: "campaign_complete_text",label: "📢 Campagne terminée" },
  ];
}

function vipSettings() {
  const defs = config.VIP_LEVELS;
  const result = [];
  for (let lvl = 1; lvl <= 4; lvl++) {
    const d = defs[lvl] || {};
    result.push({ key: `vip_${lvl}_price`,         label: `💎 Prix VIP ${lvl}` });
    result.push({ key: `vip_${lvl}_task_bonus_pct`, label: `📈 Bonus tâches VIP ${lvl} (%)` });
    result.push({ key: `vip_${lvl}_max_tasks`,      label: `📋 Max tâches/j VIP ${lvl}` });
    result.push({ key: `vip_${lvl}_fee_discount`,   label: `💸 Réduction frais VIP ${lvl} (%)` });
  }
  return result;
}

function levelSettings() {
  return [
    { key: "xp_per_task",     label: "⚡ XP par tâche" },
    { key: "xp_per_referral", label: "⚡ XP par parrainage" },
    ...Array.from({ length: 9 }, (_, i) => ({
      key:   `level_reward_${i + 2}`,
      label: `🎁 Récompense niveau ${i + 2}`,
    })),
  ];
}

function showConfigVipLevels(cid) {
  const vS = vipSettings();
  const lS = levelSettings();
  let txt = `💎 <b>CONFIG VIP & NIVEAUX</b>\n\n<b>VIP :</b>\n`;
  const vipNames4 = { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Diamond" };
  for (let lvl = 1; lvl <= 4; lvl++) {
    const price   = db.getSetting(`vip_${lvl}_price`,         config.VIP_LEVELS[lvl]?.price         || "—");
    const bonus   = db.getSetting(`vip_${lvl}_task_bonus_pct`,config.VIP_LEVELS[lvl]?.bonus_percent  || "—");
    const maxT    = db.getSetting(`vip_${lvl}_max_tasks`,      config.VIP_LEVELS[lvl]?.max_tasks_day || "—");
    const feeD    = db.getSetting(`vip_${lvl}_fee_discount`,   config.VIP_LEVELS[lvl]?.withdrawal_fee_discount || "—");
    txt += `${vipNames4[lvl]}: ${price}$ | +${bonus}% | ${maxT}t/j | -${feeD}%\n`;
  }
  txt += `\n<b>XP & Niveaux :</b>\n`;
  lS.forEach(s => { txt += `${s.label}: <b>${esc(String(db.getSetting(s.key, "—")))}</b>\n`; });
  const rows = [...vS, ...lS].map(s => [{ text: `✏️ ${s.label}`, callback_data: `set_${s.key}` }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showConfigBot(cid) {
  const settings = botSettings();
  let txt = `⚙️ <b>CONFIG BOT</b>\n\n`;
  settings.forEach(s => { txt += `${s.label}: <b>${esc(db.getSetting(s.key,"—"))}</b>\n`; });
  const rows = settings.map(s => [{ text: `✏️ ${s.label}`, callback_data: `set_${s.key}` }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showConfigMessages(cid) {
  const settings = messageSettings();
  let txt = `📝 <b>CONFIG MESSAGES</b>\n\n`;
  settings.forEach(s => {
    const val = db.getSetting(s.key, "—");
    const preview = typeof val === "string" && val.length > 60 ? val.slice(0, 60) + "…" : val;
    txt += `${s.label}:\n<i>${esc(String(preview))}</i>\n\n`;
  });
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
  tickets.slice(0, 8).forEach(t => {
    bot.sendMessage(cid,
      `🎫 <b>Ticket #${t.ticket_id}</b>\n👤 ${esc(t.first_name)} (${t.user_id})\n\n💬 ${esc((t.message || "").substring(0, 300))}`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "💬 Répondre",  callback_data: `reply_ticket_${t.ticket_id}` },
        { text: "✅ Fermer",    callback_data: `close_ticket_${t.ticket_id}` }
      ]]) });
  });
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

  db.resetDailyTasksIfNeeded(uid);
  user = db.getUser(uid);

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
  if (text === "💰 Gains")       { clearState(uid); return showBalance(cid, user); }
  if (text === "💳 Balance")     { clearState(uid); return showBalance(cid, user); }
  if (text === "📋 Tâches")      { clearState(uid); return showTasksMenu(cid, user); }
  if (text === "🏆 Concours")    { clearState(uid); return showGiveaways(cid); }
  if (text === "👥 Parrainer")   { clearState(uid); return showReferral(cid, user); }
  if (text === "👥 Parrainage")  { clearState(uid); return showReferral(cid, user); }
  if (text === "🎁 Bonus du jour"){ clearState(uid); return showDailyBonus(cid, uid, user); }
  if (text === "🎁 Bonus")       { clearState(uid); return showDailyBonus(cid, uid, user); }
  if (text === "👤 Profil")      { clearState(uid); return showProfile(cid, uid); }
  if (text === "📊 Profil")      { clearState(uid); return showProfile(cid, uid); }
  if (text === "💬 Support")     { clearState(uid); return showSupport(cid, uid); }
  if (text === "🎫 Support")     { clearState(uid); return showSupport(cid, uid); }
  if (text === "⚙️ Paramètres") { clearState(uid); return showSettings(cid, user); }
  if (text === "💎 Acheter VIP") { clearState(uid); return showVipShop(cid, uid); }
  if (text === "👑 Admin" && isAdmin(uid)) { clearState(uid); return showAdmin(cid); }

  // ─── Balance ───
  if (text === "💰 Déposer" || text === "💳 Déposer") { clearState(uid); return showDeposit(cid); }
  if (text === "🏧 Retirer")    { clearState(uid); return showWithdraw(cid, user); }
  if (text === "📋 Historique")  { clearState(uid); return showHistory(cid, uid); }
  if (text === "📜 Transactions"){ clearState(uid); return showTransactions(cid, uid); }

  // ─── Tâches ───
  const typeMap = {
    "📢 Canaux":   "channel",
    "👥 Groupes":  "group",
    "🤖 Bots":     "bot",
    "🎮 Mini Apps":"miniapp",
  };
  if (typeMap[text]) { clearState(uid); return showTasksByType(cid, uid, typeMap[text], user); }
  if (text === "➕ Créer Campagne")   { clearState(uid); return showCreateCampaign(cid, user); }
  if (text === "📊 Mes Campagnes")   { clearState(uid); return showMyCampaigns(cid, uid); }
  if (text === "🏅 Classement")      { clearState(uid); return showLeaderboard(cid, uid); }

  // ─── Parrainage ───
  if (text === "🔗 Mon Lien") {
    if (!botInfo) botInfo = await bot.getMe();
    const myLink = `https://t.me/${botInfo.username}?start=ref_${uid}`;
    const shareT = encodeURIComponent(`💰 Rejoins-moi sur ${botInfo.first_name} et gagne de l'argent réel en crypto :`);
    return bot.sendMessage(cid,
      `🔗 <b>Ton lien de parrainage :</b>\n<code>${myLink}</code>`,
      { parse_mode: "HTML", reply_markup: KBI([
        [{ text: "📤 Partager", url: `https://t.me/share/url?url=${encodeURIComponent(myLink)}&text=${shareT}` }]
      ]) });
  }

  // ─── ADMIN navigation ───
  if (isAdmin(uid)) {
    if (text === "📊 Stats")          return showAdminStats(cid);
    if (text === "⚙️ Config Bot")     return showConfigBot(cid);
    if (text === "📝 Messages")       return showConfigMessages(cid);
    if (text === "💎 VIP & Niveaux")  return showConfigVipLevels(cid);
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

  // Retrait — montant d'abord
  if (s === "wd_amount") {
    const amount = parseFloat(text);
    const minW   = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW   = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    user = db.getUser(uid);
    if (isNaN(amount) || amount < minW || amount > maxW || amount > user.balance) {
      return bot.sendMessage(cid,
        `❌ Montant invalide.\n\n💰 Ton solde : <b>${fmt(user.balance)}</b>\nMin : <b>${fmt(minW)}</b> · Max : <b>${fmt(maxW)}</b>\n\nEnvoie un montant valide :`,
        { parse_mode: "HTML", reply_markup: KB_CANCEL });
    }
    const feeP2 = parseFloat(db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT));
    const fee2 = Math.round(amount * (feeP2 / 100) * 100) / 100;
    const net2 = Math.round((amount - fee2) * 100) / 100;
    setState(uid, "wd_wallet", { ...data, amount, fee: fee2, netAmount: net2 });
    return bot.sendMessage(cid,
      `👛 Envoie maintenant ton adresse wallet <b>${config.WITHDRAWAL_METHODS[data.method]?.name}</b> :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }
  // Retrait — adresse wallet
  if (s === "wd_wallet") {
    const { method, amount, fee: feeAmt, netAmount } = data;
    setState(uid, "wd_pending_confirm", { method, amount, wallet: text, fee: feeAmt, netAmount });
    return bot.sendMessage(cid,
      `🏧 <b>Résumé du retrait</b>\n\n` +
      `💵 Montant : <b>${fmt(amount)}</b>\n` +
      `💸 Frais : <b>${fmt(feeAmt)}</b>\n` +
      `✅ Tu recevras : <b>${fmt(netAmount)}</b>\n` +
      `👛 Vers : <code>${esc(text)}</code>\n\n` +
      `Confirmes-tu ce retrait ?`,
      { parse_mode: "HTML", reply_markup: KBI([
        [{ text: "✅ Confirmer", callback_data: "wd_confirm" },
         { text: "❌ Annuler",   callback_data: "wd_cancel" }]
      ]) });
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

    // Pour canal/groupe UNIQUEMENT : vérifier que le bot est admin
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
    // Bot et Mini App : pas de vérification admin (impossible)

    // Tout OK — STOCKER le lien complet original (sans le couper)
    setState(uid, "ct_title", { ...data, link: text.trim(), chatId: "@" + verif.username });
    return bot.sendMessage(cid,
      `✅ <b>Lien vérifié !</b>\n\n📝 Envoie maintenant le <b>titre</b> de ta campagne :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  if (s === "ct_title") {
    if (text.length < 3 || text.length > 100) {
      return bot.sendMessage(cid, "❌ Titre entre 3 et 100 caractères.");
    }
    const type = data.type;
    // Pour bot/miniapp : pas de durée, juste un temps d'attente fixe
    if (type === "bot" || type === "miniapp") {
      const seconds = parseInt(db.getSetting("bot_wait_seconds", "30"));
      const minPrice = parseFloat(db.getSetting("min_price_bot", "0.001"));
      const realMin = Math.max(minPrice, 0.001);
      const minTxt = realMin < 0.01 ? realMin.toFixed(4) : realMin.toFixed(2);
      setState(uid, "ct_reward", { ...data, title: text, durationSeconds: seconds });
      return bot.sendMessage(cid,
        `💰 <b>Récompense par personne ($)</b>\n\n` +
        `⏱ Temps d'attente : <b>${seconds}s</b>\n` +
        `Minimum : <b>${minTxt}$</b>\n\n` +
        `Envoie le montant :`,
        { parse_mode: "HTML", reply_markup: KB_CANCEL });
    }

    // Canal/Groupe : afficher les boutons de durée
    setState(uid, "ct_duration", { ...data, title: text });
    const durations = [1, 12, 24, 48];
    const rows = durations.map(h => {
      const price = parseFloat(db.getSetting(`min_price_${h}h`, "0.001"));
      const priceFmt = price < 0.01 ? price.toFixed(4) : price.toFixed(2);
      return [{ text: `⏱ ${h}h — min ${priceFmt}$/personne`, callback_data: `ct_dur_${h}` }];
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
    if (type === "bot" || type === "miniapp") minKey = "min_price_bot";
    else minKey = `min_price_${data.durationHours}h`;
    const minPrice = parseFloat(db.getSetting(minKey, "0.001"));
    // Minimum absolu = 0.001$
    const realMin = Math.max(minPrice, 0.001);
    if (isNaN(reward) || reward < realMin) {
      return bot.sendMessage(cid, `❌ Minimum : ${realMin.toFixed(4)}$ par personne.`);
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
    // Frais en POURCENTAGE (20% par défaut, configurable)
    const feePercent = parseFloat(db.getSetting("task_fee_percent", "20"));
    const feePerUser = data.reward * (feePercent / 100);
    const totalPerUser = data.reward + feePerUser;
    if (isNaN(budget) || budget < totalPerUser) {
      return bot.sendMessage(cid, `❌ Budget minimum : ${fmt(totalPerUser)} (1 personne).`);
    }
    const userTotal = (user.balance || 0) + (user.deposit_balance || 0);
    if (budget > userTotal) {
      return bot.sendMessage(cid, `❌ Solde insuffisant.\n💰 Gains : ${fmt(user.balance)}\n💳 Dépôt : ${fmt(user.deposit_balance || 0)}`, { parse_mode: "HTML" });
    }
    const maxC = Math.floor(budget / totalPerUser);
    const realBudget = Math.round(maxC * totalPerUser * 10000) / 10000;

    // Calculer expires_at
    let expiresAt = null;
    if (data.type === "channel" || data.type === "group") {
      // Durée de la tâche = 7 jours (l'utilisateur reste durationHours après chaque clic)
      expiresAt = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
    } else {
      expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    }

    // Débiter et insérer dans une transaction atomique (rollback automatique si l'INSERT échoue)
    const feePctInsert = parseFloat(db.getSetting("task_fee_percent", "20"));
    const platformFeeInsert = Math.round(data.reward * (feePctInsert / 100) * 10000) / 10000;
    const descText = (data.type === "bot" || data.type === "miniapp")
      ? `Temps d'attente : ${data.durationSeconds}s`
      : `Reste abonné ${data.durationHours}h minimum`;

    let taskId;
    try {
      db.db.transaction(() => {
        if (!debitSmart(uid, realBudget, "task_creation", `Campagne: ${data.title}`))
          throw new Error("debit_failed");
        const insertResult = db.db.prepare(`
          INSERT INTO tasks (creator_id, type, title, description, link, chat_id, proof_required, proof_instructions, reward, platform_fee, max_completions, budget, budget_remaining, countries, min_level, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?, ?, NULL, 1, ?)
        `).run(
          uid, data.type, data.title, descText,
          data.link, data.chatId || null,
          data.reward, platformFeeInsert, maxC, realBudget, realBudget, expiresAt
        );
        taskId = insertResult.lastInsertRowid;
        db.db.prepare("UPDATE users SET tasks_created = tasks_created + 1 WHERE user_id = ?").run(uid);
      })();
    } catch (e) {
      if (e.message === "debit_failed")
        return bot.sendMessage(cid, `❌ Solde insuffisant.\n💰 Gains : ${fmt(user.balance)}\n💳 Dépôt : ${fmt(user.deposit_balance || 0)}`, { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
      console.error("Task creation error:", e.message);
      return bot.sendMessage(cid, "❌ Erreur lors de la création.", { reply_markup: KB_MAIN(uid) });
    }

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
    bot.sendMessage(data.uid,
      `💰 <b>Solde ajusté</b>\n\n${amount > 0 ? `+${fmt(amount)} ajouté` : `${fmt(amount)} retiré`} par l'administration.`,
      { parse_mode: "HTML" }).catch(() => {});
    clearState(uid);
    return bot.sendMessage(cid, `✅ Modifié.`, { reply_markup: KB_ADMIN });
  }

  // Admin — ban/unban
  if (s === "adm_ban_uid" && isAdmin(uid)) {
    clearState(uid);
    if (text.startsWith("unban:")) {
      const tid = parseInt(text.replace("unban:",""));
      db.banUser(tid, false, "");
      bot.sendMessage(tid, "✅ <b>Ton compte a été réactivé.</b>\nTu peux maintenant utiliser le bot normalement.", { parse_mode: "HTML" }).catch(() => {});
      return bot.sendMessage(cid, `✅ ${tid} débanni.`, { reply_markup: KB_ADMIN });
    }
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(cid, "❌ Invalide.");
    db.banUser(tid, true, "Admin");
    bot.sendMessage(tid, "⛔ <b>Compte suspendu.</b>\nContacte le support si tu penses que c'est une erreur.", { parse_mode: "HTML" }).catch(() => {});
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

  // Admin — Réponse ticket
  if (s === "ticket_reply" && isAdmin(uid)) {
    clearState(uid);
    const { ticketId, userId, firstName } = data;
    db.respondToTicket(ticketId, text, uid);
    bot.sendMessage(userId,
      `💬 <b>Réponse du support</b>\n\n${esc(text)}\n\n━━━━━━━━━━━━━━━━━━━━━━\n📩 Pour répondre, utilise 💬 Support dans le menu.`,
      { parse_mode: "HTML" }).catch(() => {});
    return bot.sendMessage(cid, `✅ Réponse envoyée à ${esc(firstName || String(userId))} (ticket #${ticketId}).`, { reply_markup: KB_ADMIN });
  }

  // Support
  if (s === "support_msg") {
    clearState(uid);
    db.createTicket(uid, "Support", text);
    bot.sendMessage(cid,
      `✅ <b>Message envoyé !</b>\n\nNous te répondrons dans les plus brefs délais.\nTu recevras une notification ici dès qu'un admin répond.`,
      { parse_mode: "HTML", reply_markup: KB_MAIN(uid) });
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `🎫 <b>Nouveau ticket #support</b>\n\n👤 ${esc(user.first_name)} · ID : <code>${uid}</code>\n\n💬 ${esc(text)}`,
        { parse_mode: "HTML" }).catch(() => {});
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
    const corrected = db.updateBalance(deposit.user_id, -usdAmount, "deposit_correction", "Bascule vers deposit_balance");
    if (corrected) creditDeposit(deposit.user_id, usdAmount);
    else {
      // La balance a déjà été partiellement dépensée : créditer seulement le montant réellement déductible
      const uNow = db.getUser(deposit.user_id);
      const available = Math.min(uNow ? (uNow.balance || 0) : 0, usdAmount);
      if (available > 0) {
        db.updateBalance(deposit.user_id, -available, "deposit_correction", "Bascule partielle vers deposit_balance");
        creditDeposit(deposit.user_id, available);
      }
    }

    const uAfterDep = db.getUser(deposit.user_id);
    await bot.sendMessage(deposit.user_id,
      `✅ <b>Dépôt détecté et confirmé !</b>\n\n` +
      `💎 ${tx.amount} ${symbol} → <b>+${fmt(usdAmount)}</b>\n` +
      `🔗 TX : <code>${tx.txHash}</code>\n\n` +
      `💳 Balance dépôt : <b>${fmt(uAfterDep ? (uAfterDep.deposit_balance || 0) : 0)}</b>\n\n` +
      `Utilisable pour les mini-jeux et tes campagnes.`,
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

// ─── Init depuis variables d'environnement (Railway / GitHub vars) ───
if (!db.getSetting("payment_channel", "") && config.PAYMENT_CHANNEL) {
  db.setSetting("payment_channel", config.PAYMENT_CHANNEL);
}
if (!db.getSetting("official_channel", "") && config.CHANNEL_USERNAME) {
  const ch = config.CHANNEL_USERNAME.startsWith("@") ? config.CHANNEL_USERNAME : "@" + config.CHANNEL_USERNAME;
  db.setSetting("official_channel", ch);
}
if (!db.getSetting("support_username", "") && config.SUPPORT_USERNAME) {
  db.setSetting("support_username", config.SUPPORT_USERNAME);
}
if (!db.getSetting("bot_name", "") && config.BOT_NAME) {
  db.setSetting("bot_name", config.BOT_NAME);
}

// ─── Init defaults ───
const defaults = {
  "min_price_1h":  "0.001",
  "min_price_12h": "0.002",
  "min_price_24h": "0.003",
  "min_price_48h": "0.005",
  "min_price_bot": "0.001",
  "bot_wait_seconds": "30",
  "task_fee_percent":   "20",
  "xp_per_task":         String(config.XP_PER_TASK),
  "xp_per_referral":     String(config.XP_PER_REFERRAL),
  // VIP prices and perks
  "vip_1_price":          String(config.VIP_LEVELS[1]?.price || 5),
  "vip_1_task_bonus_pct": String(config.VIP_LEVELS[1]?.bonus_percent || 5),
  "vip_1_max_tasks":      String(config.VIP_LEVELS[1]?.max_tasks_day || 100),
  "vip_1_fee_discount":   String(config.VIP_LEVELS[1]?.withdrawal_fee_discount || 10),
  "vip_2_price":          String(config.VIP_LEVELS[2]?.price || 15),
  "vip_2_task_bonus_pct": String(config.VIP_LEVELS[2]?.bonus_percent || 10),
  "vip_2_max_tasks":      String(config.VIP_LEVELS[2]?.max_tasks_day || 200),
  "vip_2_fee_discount":   String(config.VIP_LEVELS[2]?.withdrawal_fee_discount || 25),
  "vip_3_price":          String(config.VIP_LEVELS[3]?.price || 50),
  "vip_3_task_bonus_pct": String(config.VIP_LEVELS[3]?.bonus_percent || 20),
  "vip_3_max_tasks":      String(config.VIP_LEVELS[3]?.max_tasks_day || 500),
  "vip_3_fee_discount":   String(config.VIP_LEVELS[3]?.withdrawal_fee_discount || 50),
  "vip_4_price":          String(config.VIP_LEVELS[4]?.price || 150),
  "vip_4_task_bonus_pct": String(config.VIP_LEVELS[4]?.bonus_percent || 30),
  "vip_4_max_tasks":      String(config.VIP_LEVELS[4]?.max_tasks_day || 999),
  "vip_4_fee_discount":   String(config.VIP_LEVELS[4]?.withdrawal_fee_discount || 75),
  // Level rewards (level 2–10)
  ...Object.fromEntries(
    config.LEVEL_REWARDS.slice(1).map((r, i) => [`level_reward_${i + 2}`, String(r)])
  ),
};
for (const [k, v] of Object.entries(defaults)) {
  if (db.getSetting(k, null) === null || db.getSetting(k, "") === "") {
    db.setSetting(k, v);
  }
}

// Reset min prices si trop élevés
["min_price_1h", "min_price_12h", "min_price_24h", "min_price_48h", "min_price_bot"].forEach(k => {
  const v = parseFloat(db.getSetting(k, "0.001"));
  if (v >= 0.01) db.setSetting(k, defaults[k]);
});

bot.on("polling_error", e => console.error("Polling:", e.message));
process.on("uncaughtException",  e => console.error("Exception:", e.message));
process.on("unhandledRejection", e => console.error("Rejection:", e));

console.log("🚀 ADCRYPTON Bot démarré !");

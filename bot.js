// ============================================
// 🤖 ADCRYPTON BOT — Version Finale
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

// ─────────────────────────────────────────────
//  UTILITAIRES
// ─────────────────────────────────────────────
function isAdmin(uid) { return config.ADMIN_IDS.includes(uid); }

function fmt(n) {
  const sym = db.getSetting("currency_symbol", "$");
  return `${Number(n || 0).toFixed(2)}${sym}`;
}

function esc(t) {
  return String(t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function fmtDate(d) {
  if (!d) return "N/A";
  return new Date(d).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

async function isMember(channel, uid) {
  try {
    const m = await bot.getChatMember(channel, uid);
    return ["member","administrator","creator"].includes(m.status);
  } catch { return false; }
}

function maintenance(uid) {
  if (db.getSetting("maintenance_mode","false") === "true" && !isAdmin(uid))
    return db.getSetting("maintenance_message","🔧 Maintenance en cours.");
  return null;
}

// Admin account — credit platform profits
const ADMIN_UID = config.ADMIN_IDS[0];

function creditAdmin(amount, source) {
  if (ADMIN_UID && amount > 0)
    db.updateBalance(ADMIN_UID, amount, "platform_profit", `Profit ${source}`);
}

// ─────────────────────────────────────────────
//  CLAVIERS (reply keyboard = en bas de l'écran)
// ─────────────────────────────────────────────

function KB(rows) {
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: false };
}

function KBI(rows) { // inline keyboard
  return { inline_keyboard: rows };
}

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

const KB_BALANCE = KB([["💳 Déposer","🏧 Retirer"],["📋 Historique"],["🏠 Accueil"]]);
const KB_TASKS   = KB([["📢 Canaux","👥 Groupes"],["🤖 Bots","📺 YouTube"],["🐦 Twitter","📷 Instagram"],["🎵 TikTok","🌐 Sites Web"],["📱 Apps","⚡ Flash Tasks"],["➕ Créer Campagne","🎁 Bonus Quotidien"],["🏠 Accueil"]]);
const KB_GAMES   = KB([["🎡 Roue Fortune"],["🎲 Dés","🪙 Pile/Face"],["🏆 Jackpot","🔢 Devinette"],["🏠 Accueil"]]);
const KB_PARRAIN = KB([["🔗 Mon Lien"],["🏠 Accueil"]]);
const KB_ADMIN   = KB([["📊 Stats","⚙️ Config Bot"],["🎮 Config Jeux","⚡ Flash Tasks"],["📋 Tâches Admin","📸 Preuves"],["🏧 Retraits","💳 Dépôts"],["👥 Users","🎫 Tickets"],["🏆 Concours Admin","📢 Broadcast"],["💰 Mod. Solde","⛔ Ban/Unban"],["🏠 Accueil"]]);
const KB_CANCEL  = KB([["❌ Annuler"]]);

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

  // Referral
  let refBy = null;
  const param = (match[1] || "").trim();
  if (param.startsWith("ref_")) {
    const ref = db.getUserByReferralCode(param.replace("ref_",""));
    if (ref && ref.user_id !== uid) refBy = ref.user_id;
  }

  let user   = db.getUser(uid);
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

  // Vérifier canaux
  if (!await checkRequiredChannels(uid)) {
    return bot.sendMessage(cid,
      `👋 <b>Bienvenue sur ${db.getSetting("bot_name","ADCRYPTON")} !</b>\n\n📢 Rejoins nos canaux pour continuer :`,
      { parse_mode: "HTML", reply_markup: channelJoinButtons() });
  }

  sendHome(cid, user);
});

bot.on("callback_query", async (q) => {
  const uid  = q.from.id;
  const cid  = q.message.chat.id;
  const mid  = q.message.message_id;
  const data = q.data;

  bot.answerCallbackQuery(q.id).catch(() => {});

  let user = db.getUser(uid);
  if (!user) user = db.createUser(uid, q.from.username, q.from.first_name, q.from.last_name);
  if (user.is_banned) return;

  // ─── Vérification canaux ───
  if (data === "check_join") {
    if (await checkRequiredChannels(uid)) {
      await bot.deleteMessage(cid, mid).catch(() => {});
      return sendHome(cid, user);
    }
    return bot.answerCallbackQuery(q.id, { text: "❌ Rejoins tous les canaux d'abord !", show_alert: true }).catch(() => {});
  }

  // ─── Tâches ───
  if (data.startsWith("start_task_")) {
    const taskId = parseInt(data.replace("start_task_",""));
    return handleStartTask(cid, uid, taskId, user);
  }
  if (data.startsWith("verify_task_")) {
    const taskId = parseInt(data.replace("verify_task_",""));
    return handleVerifyTask(cid, uid, taskId, user);
  }

  // ─── Jeux ───
  if (data === "spin_free")  return doSpin(cid, mid, uid, true,  user);
  if (data === "spin_paid")  return doSpin(cid, mid, uid, false, user);
  if (data.startsWith("dice_")) {
    const bet = parseFloat(data.replace("dice_",""));
    return playDice(cid, mid, uid, bet, user);
  }
  if (data.startsWith("cf_choice_")) {
    const [,, choice, bet] = data.split("_");
    return playCoinflip(cid, mid, uid, choice, parseFloat(bet), user);
  }
  if (data === "jackpot_play") return playJackpot(cid, mid, uid, user);
  if (data.startsWith("guess_")) {
    const n = parseInt(data.replace("guess_",""));
    return playGuess(cid, mid, uid, n, user);
  }
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
        ],[{ text: "◀️ Retour", callback_data: "back_games" }]])
      });
  }

  // ─── Concours ───
  if (data.startsWith("join_ga_")) {
    const gaId = parseInt(data.replace("join_ga_",""));
    const r = db.enterGiveaway(gaId, uid);
    if (r) return bot.sendMessage(cid, "✅ Inscrit au concours !");
    return bot.sendMessage(cid, "❌ Impossible (déjà inscrit ou terminé).");
  }

  // ─── Dépôts ───
  if (data.startsWith("dep_")) {
    const method = data.replace("dep_","");
    const m = config.DEPOSIT_METHODS[method];
    if (!m) return;
    setState(uid, "dep_amount", { method });
    return bot.sendMessage(cid,
      `💳 <b>Dépôt ${m.name}</b>\n\n📌 Minimum : <b>${m.minAmount} ${m.symbol}</b>\n\nEnvoie le montant :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // ─── Retraits ───
  if (data.startsWith("wd_")) {
    const method = data.replace("wd_","");
    setState(uid, "wd_wallet", { method });
    return bot.sendMessage(cid,
      `🏧 <b>Retrait ${config.WITHDRAWAL_METHODS[method]?.name}</b>\n\nEnvoie ton adresse wallet :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }

  // ─── Campagne ───
  if (data.startsWith("ct_type_")) {
    const type = data.replace("ct_type_","");
    setState(uid, "ct_title", { type });
    return bot.sendMessage(cid, `➕ Titre de ta campagne :`, { reply_markup: KB_CANCEL });
  }

  // ─── Navigation inline ───
  if (data === "back_games") {
    user = db.getUser(uid);
    return showGames(cid, user, mid);
  }

  // ─── ADMIN callbacks ───
  if (!isAdmin(uid)) return;

  if (data.startsWith("approve_task_")) {
    const tid = parseInt(data.replace("approve_task_",""));
    db.approveTask(tid, "OK");
    const t = db.getTask(tid);
    if (t) bot.sendMessage(t.creator_id, `✅ Ta campagne <b>${esc(t.title)}</b> est approuvée !`, { parse_mode: "HTML" }).catch(() => {});
    return bot.editMessageText(cb_msg(q) + "\n✅ Approuvé", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("reject_task_")) {
    const tid = parseInt(data.replace("reject_task_",""));
    db.rejectTask(tid, "Rejeté");
    const t = db.getTask(tid);
    if (t) bot.sendMessage(t.creator_id, `❌ Ta campagne a été rejetée.`).catch(() => {});
    return bot.editMessageText(cb_msg(q) + "\n❌ Rejeté", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("approve_proof_")) {
    const cid2 = parseInt(data.replace("approve_proof_",""));
    // verifyTaskCompletion by completionId
    const comp = db.db.prepare("SELECT * FROM task_completions WHERE completion_id=?").get(cid2);
    if (comp) {
      const r = db.verifyTaskCompletion(comp.task_id, comp.user_id, true);
      if (r.success) bot.sendMessage(comp.user_id, `✅ Preuve validée ! +${fmt(r.reward)} crédité.`).catch(() => {});
    }
    return bot.editMessageText(cb_msg(q) + "\n✅ Approuvé", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("reject_proof_")) {
    const cid2 = parseInt(data.replace("reject_proof_",""));
    db.rejectTaskCompletion(cid2, "Rejeté");
    return bot.editMessageText(cb_msg(q) + "\n❌ Rejeté", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("confirm_dep_")) {
    const depId = parseInt(data.replace("confirm_dep_",""));
    const dep   = db.confirmDeposit(depId, "", false);
    if (dep) {
      bot.sendMessage(dep.user_id,
        `✅ <b>Dépôt confirmé !</b>\n💰 +${fmt(dep.amount)} crédité !`,
        { parse_mode: "HTML" }).catch(() => {});
    }
    return bot.editMessageText(cb_msg(q) + "\n✅ Confirmé", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("reject_dep_")) {
    const depId = parseInt(data.replace("reject_dep_",""));
    db.rejectDeposit(depId);
    return bot.editMessageText(cb_msg(q) + "\n❌ Rejeté", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("pay_wd_")) {
    const wdId = parseInt(data.replace("pay_wd_",""));
    const wd   = db.approveWithdrawal(wdId);
    if (wd) {
      // Notif user
      bot.sendMessage(wd.user_id,
        `✅ <b>Retrait envoyé !</b>\n💵 ${fmt(wd.net_amount)}\n👛 <code>${wd.wallet_address}</code>`,
        { parse_mode: "HTML" }).catch(() => {});
      // Notif canal paiements
      const payChannel = db.getSetting("payment_channel","");
      if (payChannel) {
        bot.sendMessage(payChannel,
          `✅ <b>Retrait effectué</b>\n💵 ${fmt(wd.net_amount)} envoyé avec succès !`,
          { parse_mode: "HTML" }).catch(() => {});
      }
    }
    return bot.editMessageText(cb_msg(q) + "\n✅ Payé", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("reject_wd_")) {
    const wdId = parseInt(data.replace("reject_wd_",""));
    const wd   = db.rejectWithdrawal(wdId);
    if (wd) bot.sendMessage(wd.user_id,
      `❌ Retrait rejeté.\n💰 ${fmt(wd.amount)} remboursé.`).catch(() => {});
    return bot.editMessageText(cb_msg(q) + "\n❌ Rejeté", { chat_id: cid, message_id: mid });
  }
  if (data.startsWith("draw_ga_")) {
    const gaId = parseInt(data.replace("draw_ga_",""));
    const r = db.drawGiveaway(gaId);
    if (r && r.winners) {
      r.winners.forEach(w => {
        bot.sendMessage(w.user_id,
          `🎉 <b>Tu as gagné le concours !</b>\n💰 +${fmt(r.prizePerWinner)} crédité !`,
          { parse_mode: "HTML" }).catch(() => {});
      });
    }
    return bot.sendMessage(cid, `✅ Tirage effectué !`);
  }
  if (data.startsWith("adm_set_")) {
    const key = data.replace("adm_set_","");
    setState(uid, `set_${key}`, { key });
    const cur = db.getSetting(key,"—");
    return bot.sendMessage(cid,
      `⚙️ <b>${key}</b>\nValeur actuelle : <b>${cur}</b>\n\nEnvoie la nouvelle valeur :`,
      { parse_mode: "HTML", reply_markup: KB_CANCEL });
  }
  if (data === "new_giveaway") {
    setState(uid, "ga_title");
    return bot.sendMessage(cid, "🏆 Titre du concours :", { reply_markup: KB_CANCEL });
  }
  if (data === "new_flash") {
    setState(uid, "flash_title");
    return bot.sendMessage(cid, "⚡ Titre de la Flash Task :", { reply_markup: KB_CANCEL });
  }
});

function cb_msg(q) { return q.message.text || ""; }

// ─────────────────────────────────────────────
//  MENU PRINCIPAL
// ─────────────────────────────────────────────

function sendHome(cid, user) {
  user = db.getUser(user.user_id);
  const botName = db.getSetting("bot_name", "ADCRYPTON");
  const maxT    = db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY);
  const jackpot = parseFloat(db.getSetting("jackpot_pool","0"));

  bot.sendMessage(cid,
    `🏠 <b>${esc(botName)}</b>\n\n` +
    `👋 Salut <b>${esc(user.first_name)}</b> !\n\n` +
    `💵 Balance : <b>${fmt(user.balance)}</b>\n` +
    `✅ Tâches : <b>${user.tasks_completed}</b> | 👥 Filleuls : <b>${user.referral_count}</b>\n` +
    `📅 Aujourd'hui : <b>${user.daily_tasks_done}/${maxT}</b>${jackpot > 0 ? ` | 🎰 Jackpot : <b>${fmt(jackpot)}</b>` : ""}`,
    { parse_mode: "HTML", reply_markup: KB_MAIN(user.user_id) });
}

// ─────────────────────────────────────────────
//  TÂCHES
// ─────────────────────────────────────────────

function showTasksMenu(cid, user) {
  const maxT  = db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY);
  const flash = db.db.prepare(
    "SELECT COUNT(*) as n FROM tasks WHERE is_flash=1 AND status='active' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)"
  ).get();

  bot.sendMessage(cid,
    `📋 <b>TÂCHES</b>\n\n` +
    `📅 Aujourd'hui : <b>${user.daily_tasks_done || 0}/${maxT}</b>\n` +
    `${flash && flash.n > 0 ? `⚡ <b>${flash.n} Flash Task(s) disponible(s) !</b>\n` : ""}` +
    `\nChoisis une catégorie :`,
    { parse_mode: "HTML", reply_markup: KB_TASKS });
}

async function showTasksByType(cid, uid, type, user) {
  const maxT = parseInt(db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY));
  if ((user.daily_tasks_done || 0) >= maxT) {
    return bot.sendMessage(cid, `❌ Limite quotidienne atteinte (${maxT}). Reviens demain !`);
  }

  const tasks = db.getActiveTasks(type, uid);
  if (!tasks || tasks.length === 0) {
    return bot.sendMessage(cid, `📋 Aucune tâche ${type} disponible.\nReviens plus tard !`);
  }

  for (const task of tasks.slice(0, 3)) {
    const rows = [];
    if (task.link) rows.push([{ text: "🔗 Ouvrir le lien", url: task.link }]);
    rows.push([{ text: "▶️ Démarrer la tâche", callback_data: `start_task_${task.task_id}` }]);

    await bot.sendMessage(cid,
      `📋 <b>${esc(task.title)}</b>\n\n` +
      `💰 Récompense : <b>${fmt(task.reward)}</b>\n` +
      `${task.description ? esc(task.description) + "\n" : ""}`,
      { parse_mode: "HTML", reply_markup: KBI(rows) });
  }
}

async function handleStartTask(cid, uid, taskId, user) {
  const task = db.getTask(taskId);
  if (!task) return bot.sendMessage(cid, "❌ Tâche introuvable.");

  const r = db.startTaskCompletion(taskId, uid);
  if (!r) return bot.sendMessage(cid, "❌ Déjà commencée ou tâche indisponible.");

  const rows = [];
  if (task.link) rows.push([{ text: "🔗 Ouvrir le lien", url: task.link }]);

  let verifyText = "✅ Valider ma participation";
  if (r.mustStayUntil) {
    const seconds = Math.ceil((new Date(r.mustStayUntil) - Date.now()) / 1000);
    verifyText = `✅ Valider (attendre ${seconds}s)`;
  }
  rows.push([{ text: verifyText, callback_data: `verify_task_${taskId}` }]);

  bot.sendMessage(cid,
    `▶️ <b>Tâche démarrée !</b>\n\n📌 ${esc(task.title)}\n💰 ${fmt(task.reward)}\n\n${r.mustStayUntil ? `⏳ Reste ${Math.ceil((new Date(r.mustStayUntil) - Date.now()) / 1000)}s puis valide.` : "Effectue l'action puis valide."}`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

async function handleVerifyTask(cid, uid, taskId, user) {
  const task = db.getTask(taskId);
  if (!task) return bot.sendMessage(cid, "❌ Tâche introuvable.");

  // Vérif abonnement si canal/groupe
  if ((task.type === "channel" || task.type === "group") && task.chat_id) {
    const ok = await isMember(task.chat_id, uid);
    if (!ok) return bot.sendMessage(cid, "❌ Rejoins d'abord le canal/groupe !",
      { reply_markup: KBI([[{ text: "🔗 Rejoindre", url: task.link }]]) });
  }

  const r = db.verifyTaskCompletion(taskId, uid);
  if (r.success) {
    bot.sendMessage(cid,
      `✅ <b>Tâche validée !</b>\n💰 +${fmt(r.reward)} crédité !`,
      { parse_mode: "HTML" });
  } else if (r.reason === "too_early") {
    bot.sendMessage(cid, `⏳ Attends encore ${r.remaining}s !`);
  } else if (r.reason === "not_found") {
    bot.sendMessage(cid, "❌ Démarre d'abord la tâche.");
  } else {
    bot.sendMessage(cid, "❌ Validation impossible.");
  }
}

function showFlashTasks(cid, uid, user) {
  const tasks = db.db.prepare(
    "SELECT * FROM tasks WHERE is_flash=1 AND status='active' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)"
  ).all();

  if (!tasks.length) return bot.sendMessage(cid, "⚡ Aucune Flash Task active. Reviens plus tard !");

  const rows = tasks.map(t => [{
    text: `⚡ ${esc(t.title)} — ${fmt(t.reward)}`,
    callback_data: `start_task_${t.task_id}`
  }]);

  bot.sendMessage(cid, `⚡ <b>FLASH TASKS</b>\n\n🔥 Récompense doublée !\n⏰ Durée limitée !`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

// ─────────────────────────────────────────────
//  BALANCE — DÉPÔT / RETRAIT
// ─────────────────────────────────────────────

function showBalance(cid, user) {
  bot.sendMessage(cid,
    `💳 <b>MA BALANCE</b>\n\n` +
    `💵 Disponible : <b>${fmt(user.balance)}</b>\n` +
    `📥 Total déposé : ${fmt(user.total_deposited)}\n` +
    `📤 Total retiré : ${fmt(user.total_withdrawn)}`,
    { parse_mode: "HTML", reply_markup: KB_BALANCE });
}

function showDeposit(cid) {
  const methods = config.DEPOSIT_METHODS;
  const rows = Object.entries(methods)
    .filter(([,m]) => m.enabled)
    .map(([key, m]) => [{ text: `${m.name} — min ${m.minAmount} ${m.symbol}`, callback_data: `dep_${key}` }]);

  bot.sendMessage(cid,
    `💳 <b>DÉPOSER</b>\n\n` +
    `⚡ Dépôt automatique — Prix en temps réel\n` +
    `📊 Converti instantanément en USD\n\n` +
    `⚠️ Tu devras mettre ton ID dans le mémo de la transaction.\n\n` +
    `Choisis ta crypto :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showWithdraw(cid, user) {
  const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
  if (user.balance < minW) {
    return bot.sendMessage(cid,
      `🏧 <b>RETRAIT</b>\n\n❌ Solde insuffisant.\n💵 Ton solde : ${fmt(user.balance)}\n📌 Minimum : ${fmt(minW)}`,
      { parse_mode: "HTML" });
  }

  const feeP = parseFloat(db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT));
  const rows  = Object.entries(config.WITHDRAWAL_METHODS)
    .filter(([,m]) => m.enabled)
    .map(([key,m]) => [{ text: m.name, callback_data: `wd_${key}` }]);

  bot.sendMessage(cid,
    `🏧 <b>RETRAIT</b>\n\n` +
    `💵 Solde : ${fmt(user.balance)}\n` +
    `📌 Min : ${fmt(minW)}\n` +
    `💸 Frais : ${feeP}%\n\n` +
    `Choisis la méthode :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showHistory(cid, uid) {
  const deps = db.getUserDeposits(uid, 5);
  const wds  = db.getUserWithdrawals(uid, 5);

  let txt = `📋 <b>HISTORIQUE</b>\n\n`;
  txt += `<b>Derniers dépôts :</b>\n`;
  if (!deps.length) txt += "Aucun.\n";
  else deps.forEach(d => { txt += `• ${fmt(d.amount)} ${d.method} — ${d.status} — ${fmtDate(d.created_at)}\n`; });

  txt += `\n<b>Derniers retraits :</b>\n`;
  if (!wds.length) txt += "Aucun.\n";
  else wds.forEach(w => { txt += `• ${fmt(w.net_amount)} — ${w.status} — ${fmtDate(w.created_at)}\n`; });

  bot.sendMessage(cid, txt, { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  JEUX
// ─────────────────────────────────────────────

function showGames(cid, user, mid = null) {
  const jackpot = parseFloat(db.getSetting("jackpot_pool","0"));
  const text =
    `🎮 <b>MINI-JEUX</b>\n\n` +
    `💵 Balance : <b>${fmt(user.balance)}</b>\n` +
    `🎟️ Spins gratuits : <b>${user.free_spins || 0}</b>\n` +
    `🏆 Jackpot : <b>${fmt(jackpot)}</b>`;

  const opts = { parse_mode: "HTML", reply_markup: KB_GAMES };
  if (mid) bot.editMessageText(text, { chat_id: cid, message_id: mid, ...opts }).catch(() => {});
  else bot.sendMessage(cid, text, opts);
}

// Roue
async function doSpin(cid, mid, uid, free, user) {
  user = db.getUser(uid);
  const cost = parseFloat(db.getSetting("spin_cost", config.SPIN_WHEEL.cost));

  if (free && (user.free_spins || 0) <= 0)
    return bot.sendMessage(cid, "❌ Plus de spins gratuits !");
  if (!free && user.balance < cost)
    return bot.sendMessage(cid, `❌ Solde insuffisant. Besoin : ${fmt(cost)}`);

  const result = db.spinWheel(uid, free);
  if (!result || !result.prize) return bot.sendMessage(cid, "❌ Erreur spin.");

  const prize = result.prize;
  const won   = prize.value || 0;

  if (!free && won < cost) {
    const loss = cost - won;
    creditAdmin(loss * 0.90, "roue");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + loss * 0.10) * 100) / 100));
  }

  const newUser = db.getUser(uid);
  bot.sendMessage(cid,
    `🎡 <b>ROUE DE FORTUNE</b>\n\n` +
    `🎰 ${prize.label}\n\n` +
    `${won > 0 ? `🎉 Tu gagnes <b>${fmt(won)}</b> !` : "😢 Pas de chance !"}\n\n` +
    `💵 Balance : ${fmt(newUser.balance)}`,
    { parse_mode: "HTML" });
}

// Dés
async function playDice(cid, mid, uid, bet, user) {
  user = db.getUser(uid);
  const mult = parseFloat(db.getSetting("dice_multiplier", config.DICE_GAME.multiplier_win));
  if (user.balance < bet) return bot.sendMessage(cid, "❌ Solde insuffisant !");

  db.updateBalance(uid, -bet, "dice_bet", `Dés mise ${fmt(bet)}`);

  const diceMsg = await bot.sendDice(cid, { emoji: "🎲" });
  const val     = diceMsg.dice.value;

  await new Promise(r => setTimeout(r, 3500));

  let win = 0;
  if (val >= 4) {
    win = Math.round(bet * mult * 100) / 100;
    db.updateBalance(uid, win, "dice_win", `Dés gain ${fmt(win)}`);
  } else {
    creditAdmin(bet * 0.90, "dés");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + bet * 0.10) * 100) / 100));
  }

  db.recordGame(uid, "dice", bet, win, String(val));
  const nu = db.getUser(uid);

  bot.sendMessage(cid,
    `🎲 <b>Résultat : ${val}</b>\n\n` +
    `${win > 0 ? `🎉 Gagné ! +${fmt(win)}` : `😢 Perdu ! -${fmt(bet)}`}\n\n` +
    `💵 Balance : ${fmt(nu.balance)}`,
    { parse_mode: "HTML" });
}

// Pile ou Face
async function playCoinflip(cid, mid, uid, choice, bet, user) {
  user = db.getUser(uid);
  const mult   = parseFloat(db.getSetting("coinflip_multiplier", config.COINFLIP.multiplier_win));
  if (user.balance < bet) return bot.sendMessage(cid, "❌ Solde insuffisant !");

  db.updateBalance(uid, -bet, "cf_bet", `Pile/Face mise ${fmt(bet)}`);

  const result = Math.random() > 0.5 ? "pile" : "face";
  const won    = result === choice;

  let win = 0;
  if (won) {
    win = Math.round(bet * mult * 100) / 100;
    db.updateBalance(uid, win, "cf_win", `Pile/Face gain ${fmt(win)}`);
  } else {
    creditAdmin(bet * 0.90, "pile/face");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + bet * 0.10) * 100) / 100));
  }

  db.recordGame(uid, "coinflip", bet, win, result);
  const nu = db.getUser(uid);

  bot.sendMessage(cid,
    `🪙 <b>${result.toUpperCase()}</b>\n\n` +
    `Tu avais choisi : <b>${choice.toUpperCase()}</b>\n\n` +
    `${won ? `🎉 Gagné ! +${fmt(win)}` : `😢 Perdu ! -${fmt(bet)}`}\n\n` +
    `💵 Balance : ${fmt(nu.balance)}`,
    { parse_mode: "HTML" });
}

// Jackpot
async function playJackpot(cid, mid, uid, user) {
  user    = db.getUser(uid);
  const cost   = parseFloat(db.getSetting("jackpot_cost","0.10"));
  const chance = parseFloat(db.getSetting("jackpot_chance","5"));
  const pool   = parseFloat(db.getSetting("jackpot_pool","0"));

  if (user.balance < cost) return bot.sendMessage(cid, "❌ Solde insuffisant !");

  db.updateBalance(uid, -cost, "jackpot_bet", `Jackpot ticket ${fmt(cost)}`);
  const newPool = Math.round((pool + cost * 0.50) * 100) / 100;

  const isWin = pool > 0 && Math.random() * 100 < chance;

  await new Promise(r => setTimeout(r, 2000));

  if (isWin) {
    db.updateBalance(uid, pool, "jackpot_win", `Jackpot gagné ${fmt(pool)}`);
    db.setSetting("jackpot_pool","0");
    for (const aid of config.ADMIN_IDS)
      bot.sendMessage(aid, `🏆 Jackpot gagné par ${uid} : ${fmt(pool)}`).catch(() => {});
    bot.sendMessage(cid,
      `🎉🎉 <b>JACKPOT !</b> 🎉🎉\n\nTu as gagné <b>${fmt(pool)}</b> !\n💵 Balance : ${fmt((db.getUser(uid)).balance)}`,
      { parse_mode: "HTML" });
  } else {
    db.setSetting("jackpot_pool", String(newPool));
    const nu = db.getUser(uid);
    bot.sendMessage(cid,
      `😢 <b>Pas de chance !</b>\n\nJackpot monte à <b>${fmt(newPool)}</b>\n💵 Balance : ${fmt(nu.balance)}`,
      { parse_mode: "HTML" });
  }
}

// Devinette
async function playGuess(cid, mid, uid, guess, user) {
  user       = db.getUser(uid);
  const cost  = parseFloat(db.getSetting("guess_cost", config.GUESS_NUMBER.cost));
  const prize = parseFloat(db.getSetting("guess_prize", config.GUESS_NUMBER.prize));
  const range = config.GUESS_NUMBER.range;

  if (user.balance < cost) return bot.sendMessage(cid, "❌ Solde insuffisant !");

  db.updateBalance(uid, -cost, "guess_bet", `Devinette mise ${fmt(cost)}`);
  const secret = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

  let win = 0;
  if (guess === secret) {
    win = prize;
    db.updateBalance(uid, win, "guess_win", `Devinette gain ${fmt(win)}`);
  } else {
    creditAdmin(cost * 0.90, "devinette");
    const jp = parseFloat(db.getSetting("jackpot_pool","0"));
    db.setSetting("jackpot_pool", String(Math.round((jp + cost * 0.10) * 100) / 100));
  }

  db.recordGame(uid, "guess", cost, win, String(secret));
  const nu = db.getUser(uid);

  bot.sendMessage(cid,
    `🔢 <b>Résultat</b>\n\n` +
    `Tu as dit : <b>${guess}</b>\n` +
    `Réponse : <b>${secret}</b>\n\n` +
    `${win > 0 ? `🎉 Gagné ! +${fmt(win)}` : `😢 Perdu ! -${fmt(cost)}`}\n\n` +
    `💵 Balance : ${fmt(nu.balance)}`,
    { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  CONCOURS
// ─────────────────────────────────────────────

function showGiveaways(cid) {
  const list = db.getActiveGiveaways();
  let txt = `🏆 <b>CONCOURS ACTIFS</b>\n\n`;
  if (!list.length) txt += "Aucun concours actif. Reviens plus tard !";
  else list.forEach(g => {
    txt += `🎁 <b>${esc(g.title)}</b>\n💰 ${fmt(g.prize_amount)} | 👥 ${g.current_participants || 0} participants\n⏰ Fin : ${fmtDate(g.ends_at)}\n\n`;
  });

  const rows = list.map(g => [{ text: `🎟️ Participer — ${esc(g.title)}`, callback_data: `join_ga_${g.giveaway_id}` }]);

  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: rows.length ? KBI(rows) : undefined });
}

// ─────────────────────────────────────────────
//  PARRAINAGE
// ─────────────────────────────────────────────

async function showReferral(cid, user) {
  const info    = await bot.getMe();
  const link    = `https://t.me/${info.username}?start=ref_${user.referral_code}`;
  const bonus   = db.getSetting("referral_bonus", config.REFERRAL_BONUS);
  const pct     = db.getSetting("referral_percent", config.REFERRAL_PERCENT);

  bot.sendMessage(cid,
    `👥 <b>PARRAINAGE</b>\n\n` +
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
  if (!r) {
    return bot.sendMessage(cid,
      `🎁 Déjà réclamé !\nProchain : <b>${fmtDate(new Date(Date.now() + 86400000))}</b>`,
      { parse_mode: "HTML" });
  }
  const nu = db.getUser(uid);
  bot.sendMessage(cid,
    `🎁 <b>Bonus réclamé !</b>\n\n💰 +${fmt(r.amount)}\n💵 Balance : ${fmt(nu.balance)}`,
    { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  CRÉER CAMPAGNE
// ─────────────────────────────────────────────

function showCreateCampaign(cid, user) {
  const types = Object.entries(config.TASK_TYPES).filter(([,v]) => v.enabled);
  const rows  = types.map(([key,t]) => [{ text: t.name, callback_data: `ct_type_${key}` }]);

  bot.sendMessage(cid,
    `➕ <b>CRÉER UNE CAMPAGNE</b>\n\n` +
    `💵 Balance : <b>${fmt(user.balance)}</b>\n\n` +
    `Choisis le type :`,
    { parse_mode: "HTML", reply_markup: KBI(rows) });
}

// ─────────────────────────────────────────────
//  SUPPORT
// ─────────────────────────────────────────────

function showSupport(cid, uid) {
  const su = db.getSetting("support_username","");
  bot.sendMessage(cid,
    `🎫 <b>SUPPORT</b>\n\n${su ? `📩 Contact : @${su}\n\n` : ""}Envoie ton message ici et l'admin te répondra.`,
    { parse_mode: "HTML" });
  setState(uid, "support_msg");
}

// ─────────────────────────────────────────────
//  PARAMÈTRES
// ─────────────────────────────────────────────

function showSettings(cid, user) {
  bot.sendMessage(cid,
    `⚙️ <b>PARAMÈTRES</b>\n\n👤 ${esc(user.first_name)}\n🆔 <code>${user.user_id}</code>`,
    { parse_mode: "HTML" });
}

// ─────────────────────────────────────────────
//  ADMIN
// ─────────────────────────────────────────────

function showAdmin(cid) {
  const s   = db.getStats();
  const jp  = parseFloat(db.getSetting("jackpot_pool","0"));

  bot.sendMessage(cid,
    `👑 <b>ADMIN</b>\n\n` +
    `👤 ${s.users} users (${s.activeUsers24h} actifs)\n` +
    `📋 ${s.pendingTasks} tâches | 📸 ${s.pendingProofs} preuves\n` +
    `🏧 ${s.pendingWithdrawals} retraits | 💳 ${s.pendingDeposits} dépôts\n` +
    `🎫 ${s.openTickets} tickets\n\n` +
    `💵 Déposé: ${fmt(s.totalDeposited)} | Retiré: ${fmt(s.totalWithdrawn)}\n` +
    `📈 Profit: ${fmt(s.profit || 0)} | 🎰 Jackpot: ${fmt(jp)}`,
    { parse_mode: "HTML", reply_markup: KB_ADMIN });
}

function showAdminStats(cid) {
  const s = db.getStats();
  bot.sendMessage(cid,
    `📊 <b>STATISTIQUES</b>\n\n` +
    `👤 ${s.users} users | ${s.bannedUsers} bannis\n` +
    `👥 Actifs 24h: ${s.activeUsers24h}\n\n` +
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
    { key: "official_channel",      label: "📢 Canal officiel (@nom)" },
    { key: "payment_channel",       label: "💸 Canal paiements (@nom)" },
    { key: "support_username",      label: "🎫 Username support" },
    { key: "daily_bonus_min",       label: "📅 Bonus quotidien min ($)" },
    { key: "daily_bonus_max",       label: "📅 Bonus quotidien max ($)" },
    { key: "referral_bonus",        label: "👥 Bonus parrainage ($)" },
    { key: "referral_percent",      label: "👥 Commission parrainage (%)" },
    { key: "min_withdrawal",        label: "🏧 Min retrait ($)" },
    { key: "max_withdrawal",        label: "🏧 Max retrait ($)" },
    { key: "withdrawal_fee_percent",label: "💸 Frais retrait (%)" },
    { key: "max_tasks_day",         label: "📋 Max tâches/jour" },
    { key: "maintenance_mode",      label: "🔧 Maintenance (true/false)" },
  ];
}

function gameSettings() {
  return [
    { key: "spin_cost",          label: "🎡 Coût spin ($)" },
    { key: "dice_multiplier",    label: "🎲 Dés multiplicateur" },
    { key: "coinflip_multiplier",label: "🪙 Pile/Face multiplicateur" },
    { key: "jackpot_cost",       label: "🏆 Jackpot ticket ($)" },
    { key: "jackpot_chance",     label: "🏆 Jackpot chance (%)" },
    { key: "jackpot_pool",       label: "🏆 Jackpot pool ($)" },
    { key: "guess_cost",         label: "🔢 Devinette coût ($)" },
    { key: "guess_prize",        label: "🔢 Devinette gain ($)" },
  ];
}

function showConfigBot(cid) {
  const settings = botSettings();
  let txt = `⚙️ <b>CONFIG BOT</b>\n\n`;
  settings.forEach(s => { txt += `${s.label}: <b>${db.getSetting(s.key,"—")}</b>\n`; });
  const rows = settings.map(s => [{ text: `✏️ ${s.label}`, callback_data: `adm_set_${s.key}` }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showConfigGames(cid) {
  const settings = gameSettings();
  let txt = `🎮 <b>CONFIG JEUX</b>\n\n`;
  settings.forEach(s => { txt += `${s.label}: <b>${db.getSetting(s.key,"—")}</b>\n`; });
  const rows = settings.map(s => [{ text: `✏️ ${s.label}`, callback_data: `adm_set_${s.key}` }]);
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showAdminTasks(cid) {
  const tasks = db.getPendingTasks();
  if (!tasks.length) return bot.sendMessage(cid, "✅ Aucune tâche en attente.");
  tasks.slice(0,5).forEach(t => {
    bot.sendMessage(cid,
      `📋 #${t.task_id} <b>${esc(t.title)}</b>\n👤 ${esc(t.first_name)}\n💰 ${fmt(t.reward)}`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "✅ Approuver", callback_data: `approve_task_${t.task_id}` },
        { text: "❌ Rejeter",  callback_data: `reject_task_${t.task_id}` }
      ]]) });
  });
}

function showAdminProofs(cid) {
  const proofs = db.getPendingProofs();
  if (!proofs.length) return bot.sendMessage(cid, "✅ Aucune preuve en attente.");
  proofs.slice(0,5).forEach(p => {
    bot.sendMessage(cid,
      `📸 #${p.completion_id} | 👤 ${p.user_id}\n📌 ${esc(p.title || "")}`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "✅ Valider",  callback_data: `approve_proof_${p.completion_id}` },
        { text: "❌ Rejeter", callback_data: `reject_proof_${p.completion_id}` }
      ]]) });
  });
}

function showAdminWithdrawals(cid) {
  const wds = db.getPendingWithdrawals();
  if (!wds.length) return bot.sendMessage(cid, "✅ Aucun retrait en attente.");
  wds.slice(0,5).forEach(w => {
    bot.sendMessage(cid,
      `🏧 #${w.withdrawal_id}\n👤 ${esc(w.first_name)} (${w.user_id})\n💵 ${fmt(w.net_amount)} (frais: ${fmt(w.fee)})\n👛 <code>${w.wallet_address}</code>`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "✅ Payé",    callback_data: `pay_wd_${w.withdrawal_id}` },
        { text: "❌ Rejeter", callback_data: `reject_wd_${w.withdrawal_id}` }
      ]]) });
  });
}

function showAdminDeposits(cid) {
  const deps = db.getPendingDeposits();
  if (!deps.length) return bot.sendMessage(cid, "✅ Aucun dépôt en attente.");
  deps.slice(0,5).forEach(d => {
    bot.sendMessage(cid,
      `💳 #${d.deposit_id}\n👤 ${esc(d.first_name)} (${d.user_id})\n💰 ${fmt(d.amount)} ${d.method}`,
      { parse_mode: "HTML", reply_markup: KBI([[
        { text: "✅ Confirmer", callback_data: `confirm_dep_${d.deposit_id}` },
        { text: "❌ Rejeter",   callback_data: `reject_dep_${d.deposit_id}` }
      ]]) });
  });
}

function showAdminTickets(cid) {
  const tickets = db.getOpenTickets();
  if (!tickets.length) return bot.sendMessage(cid, "✅ Aucun ticket ouvert.");
  let txt = `🎫 <b>TICKETS (${tickets.length})</b>\n\n`;
  tickets.slice(0,5).forEach(t => {
    txt += `#${t.ticket_id} | ${esc(t.first_name)} : ${esc(t.subject)}\n`;
  });
  bot.sendMessage(cid, txt, { parse_mode: "HTML" });
}

function showAdminGiveaways(cid) {
  const list = db.getActiveGiveaways();
  let txt = `🏆 <b>CONCOURS</b>\n\n`;
  if (!list.length) txt += "Aucun concours actif.";
  else list.forEach(g => { txt += `#${g.giveaway_id} ${esc(g.title)} — ${fmt(g.prize_amount)}\n`; });
  const rows = [
    [{ text: "➕ Nouveau Concours", callback_data: "new_giveaway" }],
    ...list.map(g => [{ text: `🎲 Tirer #${g.giveaway_id}`, callback_data: `draw_ga_${g.giveaway_id}` }])
  ];
  bot.sendMessage(cid, txt, { parse_mode: "HTML", reply_markup: KBI(rows) });
}

function showAdminFlash(cid) {
  bot.sendMessage(cid,
    `⚡ <b>FLASH TASKS</b>\n\nTâches spéciales à durée limitée.`,
    { parse_mode: "HTML", reply_markup: KBI([[{ text: "➕ Créer Flash Task", callback_data: "new_flash" }]]) });
}

// ─────────────────────────────────────────────
//  HANDLER MESSAGES TEXTE
// ─────────────────────────────────────────────

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const uid  = msg.from.id;
  const cid  = msg.chat.id;
  const text = msg.text.trim();

  const maint = maintenance(uid);
  if (maint) return bot.sendMessage(cid, maint);

  let user = db.getUser(uid);
  if (!user) return;
  if (user.is_banned) return bot.sendMessage(cid, "⛔ Compte banni.");

  const st = getState(uid);

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
  if (text === "💳 Balance")     { clearState(uid); return showBalance(cid, user); }
  if (text === "📋 Tâches")      { clearState(uid); return showTasksMenu(cid, user); }
  if (text === "🎮 Jeux")        { clearState(uid); return showGames(cid, user); }
  if (text === "🏆 Concours")    { clearState(uid); return showGiveaways(cid); }
  if (text === "👥 Parrainage")  { clearState(uid); return showReferral(cid, user); }
  if (text === "🎫 Support")     { clearState(uid); return showSupport(cid, uid); }
  if (text === "⚙️ Paramètres") { clearState(uid); return showSettings(cid, user); }
  if (text === "👑 Admin" && isAdmin(uid)) { clearState(uid); return showAdmin(cid); }

  // ─── Balance ───
  if (text === "💳 Déposer")    { clearState(uid); return showDeposit(cid); }
  if (text === "🏧 Retirer")    { clearState(uid); return showWithdraw(cid, user); }
  if (text === "📋 Historique") { clearState(uid); return showHistory(cid, uid); }

  // ─── Tâches par type ───
  const typeMap = {
    "📢 Canaux":     "channel",
    "👥 Groupes":    "group",
    "🤖 Bots":       "bot",
    "📺 YouTube":    "youtube",
    "🐦 Twitter":    "twitter",
    "📷 Instagram":  "instagram",
    "🎵 TikTok":     "tiktok",
    "🌐 Sites Web":  "website",
    "📱 Apps":       "app",
  };
  if (typeMap[text]) { clearState(uid); return showTasksByType(cid, uid, typeMap[text], user); }
  if (text === "⚡ Flash Tasks")      { clearState(uid); return showFlashTasks(cid, uid, user); }
  if (text === "➕ Créer Campagne")   { clearState(uid); return showCreateCampaign(cid, user); }
  if (text === "🎁 Bonus Quotidien")  { clearState(uid); return claimBonus(cid, uid, user); }

  // ─── Jeux ───
  if (text === "🎡 Roue Fortune") {
    clearState(uid);
    const cost = parseFloat(db.getSetting("spin_cost", config.SPIN_WHEEL.cost));
    const rows = [];
    if ((user.free_spins || 0) > 0) rows.push([{ text: `🎟️ Spin gratuit (${user.free_spins})`, callback_data: "spin_free" }]);
    if (user.balance >= cost) rows.push([{ text: `🎡 Spin — ${fmt(cost)}`, callback_data: "spin_paid" }]);
    if (!rows.length) return bot.sendMessage(cid, `❌ Solde insuffisant (besoin ${fmt(cost)}) et pas de spin gratuit.`);
    return bot.sendMessage(cid,
      `🎡 <b>ROUE DE FORTUNE</b>\n\n${config.SPIN_WHEEL.prizes.map(p=>`${p.label} — ${p.chance}%`).join("\n")}\n\n💵 Balance : ${fmt(user.balance)}`,
      { parse_mode: "HTML", reply_markup: KBI(rows) });
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
    return bot.sendMessage(cid,
      `🎲 <b>DÉS</b>\n\n4,5,6 → x${mult} | 1,2,3 → Perdu\n💵 Balance : ${fmt(user.balance)}`,
      { parse_mode: "HTML", reply_markup: KBI(rows) });
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
    return bot.sendMessage(cid,
      `🪙 <b>PILE / FACE</b>\n\nGagne x${mult} si tu devines !\n💵 Balance : ${fmt(user.balance)}`,
      { parse_mode: "HTML", reply_markup: KBI(rows) });
  }

  if (text === "🏆 Jackpot") {
    clearState(uid);
    const cost   = parseFloat(db.getSetting("jackpot_cost","0.10"));
    const chance = parseFloat(db.getSetting("jackpot_chance","5"));
    const pool   = parseFloat(db.getSetting("jackpot_pool","0"));
    const rows   = user.balance >= cost
      ? [[{ text: `🎟️ Jouer — ${fmt(cost)}`, callback_data: "jackpot_play" }]]
      : [];
    return bot.sendMessage(cid,
      `🏆 <b>JACKPOT PROGRESSIF</b>\n\n💰 Pool : <b>${fmt(pool)}</b>\n🎟️ Ticket : ${fmt(cost)}\n🎯 Chance : ${chance}%\n\n💵 Balance : ${fmt(user.balance)}`,
      { parse_mode: "HTML", reply_markup: KBI(rows) });
  }

  if (text === "🔢 Devinette") {
    clearState(uid);
    const cost  = parseFloat(db.getSetting("guess_cost", config.GUESS_NUMBER.cost));
    const prize = parseFloat(db.getSetting("guess_prize", config.GUESS_NUMBER.prize));
    const range = config.GUESS_NUMBER.range;
    const nums  = [...Array(range[1]-range[0]+1)].map((_,i)=>i+range[0]);
    const rows  = nums.reduce((acc,n,i)=>{ if(i%5===0) acc.push([]); acc[acc.length-1].push({ text:`${n}`, callback_data:`guess_${n}` }); return acc; },[]);
    return bot.sendMessage(cid,
      `🔢 <b>DEVINETTE</b>\n\nDevine entre ${range[0]} et ${range[1]}\n🎟️ Coût : ${fmt(cost)} | 🏆 Gain : ${fmt(prize)}\n💵 Balance : ${fmt(user.balance)}`,
      { parse_mode: "HTML", reply_markup: KBI(rows) });
  }

  // ─── Parrainage ───
  if (text === "🔗 Mon Lien") {
    const info = await bot.getMe();
    const link = `https://t.me/${info.username}?start=ref_${user.referral_code}`;
    return bot.sendMessage(cid, `<code>${link}</code>`, { parse_mode: "HTML" });
  }

  // ─── Admin navigation ───
  if (isAdmin(uid)) {
    if (text === "📊 Stats")          return showAdminStats(cid);
    if (text === "⚙️ Config Bot")     return showConfigBot(cid);
    if (text === "🎮 Config Jeux")    return showConfigGames(cid);
    if (text === "⚡ Flash Tasks")    return showAdminFlash(cid);
    if (text === "📋 Tâches Admin")   return showAdminTasks(cid);
    if (text === "📸 Preuves")        return showAdminProofs(cid);
    if (text === "🏧 Retraits")       return showAdminWithdrawals(cid);
    if (text === "💳 Dépôts")         return showAdminDeposits(cid);
    if (text === "👥 Users")          { setState(uid, "adm_find_user"); return bot.sendMessage(cid, "👥 Envoie l'ID user :", { reply_markup: KB_CANCEL }); }
    if (text === "🎫 Tickets")        return showAdminTickets(cid);
    if (text === "🏆 Concours Admin") return showAdminGiveaways(cid);
    if (text === "📢 Broadcast")      { setState(uid, "broadcast"); return bot.sendMessage(cid, "📢 Envoie le message :", { reply_markup: KB_CANCEL }); }
    if (text === "💰 Mod. Solde")     { setState(uid, "adm_bal_uid"); return bot.sendMessage(cid, "💰 ID de l'user :", { reply_markup: KB_CANCEL }); }
    if (text === "⛔ Ban/Unban")      { setState(uid, "adm_ban_uid"); return bot.sendMessage(cid, "⛔ ID à ban/unban (préfixe 'unban:' pour débannir) :", { reply_markup: KB_CANCEL }); }
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
    bot.sendMessage(cid, depMsg, { parse_mode: "HTML" });
    // Notif admin
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `💳 <b>Nouveau dépôt #${depId}</b>\n👤 ${esc(user.first_name)} (${uid})\n💰 ${amount} ${m.symbol}`,
        { parse_mode: "HTML", reply_markup: KBI([[
          { text: "✅ Confirmer", callback_data: `confirm_dep_${depId}` },
          { text: "❌ Rejeter",   callback_data: `reject_dep_${depId}` }
        ]]) }).catch(() => {});
    }
    return;
  }

  // Retrait — wallet
  if (s === "wd_wallet") {
    setState(uid, "wd_amount", { ...data, wallet: text });
    const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    return bot.sendMessage(cid,
      `👛 Adresse enregistrée.\n\n💵 Balance : ${fmt(user.balance)}\nMin : ${fmt(minW)} | Max : ${fmt(maxW)}\n\nEnvoie le montant :`,
      { reply_markup: KB_CANCEL });
  }

  // Retrait — montant
  if (s === "wd_amount") {
    const amount = parseFloat(text);
    const minW   = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW   = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    user          = db.getUser(uid);
    if (isNaN(amount) || amount < minW || amount > maxW || amount > user.balance) {
      return bot.sendMessage(cid, `❌ Montant invalide.\nMin: ${fmt(minW)} | Max: ${fmt(maxW)} | Balance: ${fmt(user.balance)}`);
    }
    clearState(uid);
    const wdId = db.createWithdrawal(uid, data.method, amount, data.wallet);
    if (!wdId) return bot.sendMessage(cid, "❌ Erreur. Vérifie ton solde.");

    const wd  = db.db.prepare("SELECT * FROM withdrawals WHERE withdrawal_id=?").get(wdId);
    bot.sendMessage(cid,
      `✅ <b>Retrait demandé !</b>\n\n💵 ${fmt(wd.net_amount)} (frais: ${fmt(wd.fee)})\n👛 <code>${data.wallet}</code>\n\n⏳ Traitement sous 24h.`,
      { parse_mode: "HTML" });

    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `🏧 <b>Retrait #${wdId}</b>\n👤 ${esc(user.first_name)} (${uid})\n💵 ${fmt(wd.net_amount)} (frais: ${fmt(wd.fee)})\n👛 <code>${data.wallet}</code>`,
        { parse_mode: "HTML", reply_markup: KBI([[
          { text: "✅ Payé",    callback_data: `pay_wd_${wdId}` },
          { text: "❌ Rejeter", callback_data: `reject_wd_${wdId}` }
        ]]) }).catch(() => {});
    }
    return;
  }

  // Créer campagne — FSM
  if (s === "ct_title") {
    setState(uid, "ct_url", { ...data, title: text });
    return bot.sendMessage(cid, "🔗 URL de la campagne :", { reply_markup: KB_CANCEL });
  }
  if (s === "ct_url") {
    setState(uid, "ct_reward", { ...data, url: text });
    return bot.sendMessage(cid, "💰 Récompense par complétion ($) :", { reply_markup: KB_CANCEL });
  }
  if (s === "ct_reward") {
    const reward = parseFloat(text);
    if (isNaN(reward) || reward < 0.01) return bot.sendMessage(cid, "❌ Min 0.01$");
    setState(uid, "ct_budget", { ...data, reward });
    return bot.sendMessage(cid, `💵 Budget total ($) — (Balance: ${fmt(user.balance)}) :`, { reply_markup: KB_CANCEL });
  }
  if (s === "ct_budget") {
    const budget = parseFloat(text);
    user = db.getUser(uid);
    if (isNaN(budget) || budget < data.reward || budget > user.balance) {
      return bot.sendMessage(cid, `❌ Budget invalide. Min: ${fmt(data.reward)} | Balance: ${fmt(user.balance)}`);
    }
    const taskType = config.TASK_TYPES[data.type];
    const fee      = taskType ? taskType.platform_fee || 0 : 0;
    const task = db.createTask({
      creator_id: uid,
      type: data.type,
      title: data.title,
      link: data.url,
      reward: data.reward,
      platform_fee: fee,
      budget: budget,
      budget_remaining: budget,
      max_completions: Math.floor(budget / (data.reward + fee)),
    });
    if (!task) return bot.sendMessage(cid, "❌ Erreur création campagne.");
    db.updateBalance(uid, -budget, "task_budget", `Campagne: ${data.title}`);
    clearState(uid);
    bot.sendMessage(cid, `✅ Campagne soumise !\n"${esc(data.title)}"\nBudget: ${fmt(budget)} | Récompense: ${fmt(data.reward)}/complétion\n\nEn attente de validation.`);
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `📋 <b>Nouvelle campagne #${task}</b>\n👤 ${esc(user.first_name)}\n📌 ${esc(data.title)}\n💰 ${fmt(data.reward)} | Budget: ${fmt(budget)}`,
        { parse_mode: "HTML", reply_markup: KBI([[
          { text: `✅ Approuver`, callback_data: `approve_task_${task}` },
          { text: `❌ Rejeter`,   callback_data: `reject_task_${task}` }
        ]]) }).catch(() => {});
    }
    return;
  }

  // Admin — broadcast
  if (s === "broadcast" && isAdmin(uid)) {
    clearState(uid);
    const all  = db.getAllUsers();
    let sent   = 0;
    for (const u of all) {
      try { await bot.sendMessage(u.user_id, `📢 <b>Annonce</b>\n\n${text}`, { parse_mode: "HTML" }); sent++; await new Promise(r=>setTimeout(r,50)); } catch {}
    }
    return bot.sendMessage(cid, `✅ Envoyé à ${sent} users.`, { reply_markup: KB_ADMIN });
  }

  // Admin — modifier solde
  if (s === "adm_bal_uid" && isAdmin(uid)) {
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(cid, "❌ ID invalide.");
    setState(uid, "adm_bal_amount", { uid: tid });
    return bot.sendMessage(cid, `Solde actuel de ${tid}: ${fmt((db.getUser(tid)||{}).balance||0)}\n\nMontant (+ ou -) :`, { reply_markup: KB_CANCEL });
  }
  if (s === "adm_bal_amount" && isAdmin(uid)) {
    const amount = parseFloat(text);
    if (isNaN(amount)) return bot.sendMessage(cid, "❌ Invalide.");
    db.updateBalance(data.uid, amount, "admin_edit", `Admin modif: ${fmt(amount)}`);
    bot.sendMessage(data.uid, `💰 Solde modifié par admin : <b>${amount>0?"+":""}${fmt(amount)}</b>`, { parse_mode: "HTML" }).catch(() => {});
    clearState(uid);
    return bot.sendMessage(cid, `✅ +${fmt(amount)} pour ${data.uid}.`, { reply_markup: KB_ADMIN });
  }

  // Admin — ban/unban
  if (s === "adm_ban_uid" && isAdmin(uid)) {
    clearState(uid);
    if (text.startsWith("unban:")) {
      const tid = parseInt(text.replace("unban:",""));
      db.updateUser(tid, { is_banned: 0, ban_reason: "" });
      bot.sendMessage(tid, "✅ Compte débanni !").catch(() => {});
      return bot.sendMessage(cid, `✅ ${tid} débanni.`, { reply_markup: KB_ADMIN });
    }
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(cid, "❌ ID invalide.");
    db.banUser(tid, true, "Admin ban");
    bot.sendMessage(tid, "⛔ Compte banni.").catch(() => {});
    return bot.sendMessage(cid, `✅ ${tid} banni.`, { reply_markup: KB_ADMIN });
  }

  // Admin — paramètre
  if (s.startsWith("set_") && isAdmin(uid)) {
    const key = data.key;
    clearState(uid);
    db.setSetting(key, text);
    return bot.sendMessage(cid, `✅ <b>${key}</b> = <b>${esc(text)}</b>`, { parse_mode: "HTML", reply_markup: KB_ADMIN });
  }

  // Admin — find user
  if (s === "adm_find_user" && isAdmin(uid)) {
    clearState(uid);
    const tid   = parseInt(text);
    const tuser = isNaN(tid) ? null : db.getUser(tid);
    if (!tuser) return bot.sendMessage(cid, "❌ User introuvable.");
    return bot.sendMessage(cid,
      `👤 <b>${esc(tuser.first_name)}</b> (${tuser.user_id})\n💵 ${fmt(tuser.balance)}\n✅ ${tuser.tasks_completed} tâches\n👥 ${tuser.referral_count} filleuls\n${tuser.is_banned ? "⛔ BANNI" : "✅ Actif"}`,
      { parse_mode: "HTML" });
  }

  // Giveaway — création admin
  if (s === "ga_title" && isAdmin(uid)) {
    setState(uid, "ga_prize", { title: text });
    return bot.sendMessage(cid, "💰 Montant du prix ($) :");
  }
  if (s === "ga_prize" && isAdmin(uid)) {
    const prize = parseFloat(text);
    if (isNaN(prize)) return bot.sendMessage(cid, "❌ Invalide.");
    setState(uid, "ga_duration", { ...data, prize });
    return bot.sendMessage(cid, "⏰ Durée en heures :");
  }
  if (s === "ga_duration" && isAdmin(uid)) {
    const hours = parseInt(text);
    if (isNaN(hours)) return bot.sendMessage(cid, "❌ Invalide.");
    clearState(uid);
    const endsAt = new Date(Date.now() + hours * 3600000).toISOString();
    db.createGiveaway({ title: data.title, prize_amount: data.prize, ends_at: endsAt, winners_count: 1, entry_fee: 0, creator_id: uid });
    return bot.sendMessage(cid, `✅ Concours "${esc(data.title)}" créé !\nPrix: ${fmt(data.prize)} | Durée: ${hours}h`, { reply_markup: KB_ADMIN });
  }

  // Flash task — création admin
  if (s === "flash_title" && isAdmin(uid)) {
    setState(uid, "flash_reward", { title: text });
    return bot.sendMessage(cid, "💰 Récompense ($) :");
  }
  if (s === "flash_reward" && isAdmin(uid)) {
    const reward = parseFloat(text);
    if (isNaN(reward)) return bot.sendMessage(cid, "❌ Invalide.");
    setState(uid, "flash_url", { ...data, reward });
    return bot.sendMessage(cid, "🔗 URL de la tâche :");
  }
  if (s === "flash_url" && isAdmin(uid)) {
    clearState(uid);
    const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
    db.db.prepare(
      "INSERT INTO tasks (title,type,link,reward,platform_fee,budget,budget_remaining,max_completions,status,is_flash,expires_at,creator_id) VALUES (?,?,?,?,0,9999,9999,9999,'active',1,?,?)"
    ).run(data.title, "website", text, data.reward, expiresAt, uid);
    return bot.sendMessage(cid, `✅ Flash Task créée ! "${esc(data.title)}" — ${fmt(data.reward)} pendant 30min.`, { reply_markup: KB_ADMIN });
  }

  // Support — message
  if (s === "support_msg") {
    clearState(uid);
    db.createTicket(uid, "Support", text);
    bot.sendMessage(cid, "✅ Message envoyé ! L'admin te répondra bientôt.");
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `🎫 <b>Ticket</b>\n👤 ${esc(user.first_name)} (${uid})\n💬 ${esc(text)}`,
        { parse_mode: "HTML" }).catch(() => {});
    }
    return;
  }
});

// ─────────────────────────────────────────────
//  VÉRIFICATION AUTO DÉPÔTS
// ─────────────────────────────────────────────

payments.startAutoDepositChecker(db, config, async (deposit, usdAmount, tx) => {
  try {
    const symbols = { ton:"TON", bnb:"BNB", usdt_bep20:"USDT", usdt_ton:"USDT" };
    const symbol  = symbols[deposit.method] || "CRYPTO";
    const user    = db.getUser(deposit.user_id);
    if (!user) return;

    await bot.sendMessage(deposit.user_id,
      `✅ <b>Dépôt confirmé automatiquement !</b>\n\n` +
      `💰 ${tx.amount} ${symbol} → <b>+${fmt(usdAmount)}</b>\n` +
      `🔗 TX : <code>${tx.txHash}</code>\n\n` +
      `💵 Nouvelle balance : <b>${fmt((db.getUser(deposit.user_id)).balance)}</b>`,
      { parse_mode: "HTML" });
  } catch (e) { console.error("Auto deposit notif:", e.message); }
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

bot.on("polling_error", e => console.error("Polling:", e.message));
process.on("uncaughtException",  e => console.error("Exception:", e));
process.on("unhandledRejection", e => console.error("Rejection:", e));

console.log("🚀 ADCRYPTON Bot démarré !");

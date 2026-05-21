// ============================================
// 🤖 CRYPTOTASKBOT - BOT TELEGRAM COMPLET
// ============================================
// Version 2.0 - Toutes fonctionnalités incluses

const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");
const db = require("./database");

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

// États de conversation
const userStates = {};
let botInfo = null;

// ============================================
// 🛠️ UTILITAIRES
// ============================================

function isAdmin(userId) {
  return config.ADMIN_IDS.includes(userId);
}

function fmt(amount) {
  const symbol = db.getSetting("currency_symbol", config.CURRENCY_SYMBOL);
  return `${Number(amount).toFixed(2)}${symbol}`;
}

function esc(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d) {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function setState(userId, state, data = {}) {
  userStates[userId] = { state, data, ts: Date.now() };
}

function getState(userId) {
  return userStates[userId] || null;
}

function clearState(userId) {
  delete userStates[userId];
}

// Nettoyer états anciens toutes les 30 min
setInterval(() => {
  const now = Date.now();
  for (const uid in userStates) {
    if (now - userStates[uid].ts > 30 * 60 * 1000) delete userStates[uid];
  }
}, 30 * 60 * 1000);

// ============================================
// 🔍 VÉRIFICATIONS
// ============================================

async function checkMembership(chatId, userId) {
  try {
    const m = await bot.getChatMember(chatId, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch { return false; }
}

function checkMaintenance(userId) {
  if (db.getSetting("maintenance_mode", false) && !isAdmin(userId)) {
    return db.getSetting("maintenance_message", config.MAINTENANCE_MESSAGE);
  }
  return null;
}

function resetDailyTasks(user) {
  const today = new Date().toISOString().split("T")[0];
  if (user.daily_tasks_reset !== today) {
    db.updateUser(user.user_id, { daily_tasks_done: 0, daily_tasks_reset: today });
    return 0;
  }
  return user.daily_tasks_done || 0;
}

// ============================================
// /start
// ============================================

bot.onText(/\/start(.*)/, async (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  const maint = checkMaintenance(userId);
  if (maint) return bot.sendMessage(chatId, maint);

  let referredBy = null;
  const param = (match[1] || "").trim();
  if (param.startsWith("ref_")) {
    const ref = db.getUserByReferralCode(param.replace("ref_", ""));
    if (ref && ref.user_id !== userId) referredBy = ref.user_id;
  }

  let user = db.getUser(userId);
  const isNew = !user;
  
  if (!user) {
    user = db.createUser(userId, msg.from.username, msg.from.first_name, msg.from.last_name, referredBy);
    if (referredBy) {
      const referrer = db.getUser(referredBy);
      bot.sendMessage(referredBy, `🎉 Nouveau filleul : <b>${esc(msg.from.first_name)}</b> !\nBonus : +${fmt(db.getSetting("referral_bonus", config.REFERRAL_BONUS))}`, { parse_mode: "HTML" }).catch(() => {});
    }
  } else {
    db.updateUser(userId, { username: msg.from.username || "", first_name: msg.from.first_name || "" });
  }

  if (user.is_banned) return bot.sendMessage(chatId, `⛔ Compte banni.\nRaison : ${user.ban_reason || "Non spécifiée"}`);

  clearState(userId);
  
  if (isNew && db.getSetting("welcome_bonus", config.WELCOME_BONUS) > 0) {
    await bot.sendMessage(chatId, `🎁 <b>Bienvenue ${esc(user.first_name)} !</b>\n\nTu as reçu un bonus de bienvenue de <b>${fmt(db.getSetting("welcome_bonus", config.WELCOME_BONUS))}</b> !`, { parse_mode: "HTML" });
  }

  sendMainMenu(chatId, user);
});

// ============================================
// 🏠 MENU PRINCIPAL
// ============================================

async function sendMainMenu(chatId, user, msgId = null) {
  if (!botInfo) botInfo = await bot.getMe();
  
  resetDailyTasks(user);
  user = db.getUser(user.user_id); // Refresh

  const vipName = config.VIP_LEVELS[user.vip_level]?.name || "🆓 Gratuit";
  const botName = db.getSetting("bot_name", config.BOT_NAME);

  const text = `
🏠 <b>${botName}</b>

👋 Salut <b>${esc(user.first_name)}</b> !

💰 Solde : <b>${fmt(user.balance)}</b>
⭐ Niveau : ${user.level} (${user.xp} XP)
💎 Statut : ${vipName}
✅ Tâches : ${user.tasks_completed}
👥 Filleuls : ${user.referral_count}

📅 Tâches aujourd'hui : ${user.daily_tasks_done}/${db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY)}`;

  const kb = {
    inline_keyboard: [
      [{ text: "📋 Tâches", callback_data: "tasks" }, { text: "💰 Portefeuille", callback_data: "wallet" }],
      [{ text: "🎰 Jeux", callback_data: "games" }, { text: "🏆 Concours", callback_data: "giveaways" }],
      [{ text: "➕ Promouvoir", callback_data: "create_task" }, { text: "👥 Parrainage", callback_data: "referral" }],
      [{ text: "🎁 Bonus Quotidien", callback_data: "daily_bonus" }, { text: "💎 VIP", callback_data: "vip" }],
      [{ text: "📊 Stats", callback_data: "stats" }, { text: "🎫 Support", callback_data: "support" }],
      [{ text: "⚙️ Paramètres", callback_data: "settings" }],
    ]
  };

  if (isAdmin(user.user_id)) {
    kb.inline_keyboard.push([{ text: "👑 ADMIN", callback_data: "admin" }]);
  }

  if (msgId) {
    bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  } else {
    bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb });
  }
}

// ============================================
// 📲 CALLBACKS
// ============================================

bot.on("callback_query", async (q) => {
  const userId = q.from.id;
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;

  const maint = checkMaintenance(userId);
  if (maint) return bot.answerCallbackQuery(q.id, { text: "🔧 Maintenance", show_alert: true });

  let user = db.getUser(userId);
  if (!user) user = db.createUser(userId, q.from.username, q.from.first_name, q.from.last_name);
  if (user.is_banned) return bot.answerCallbackQuery(q.id, { text: "⛔ Banni", show_alert: true });

  bot.answerCallbackQuery(q.id);

  // Navigation principale
  if (data === "main") return sendMainMenu(chatId, user, msgId);
  if (data === "back_main") { clearState(userId); return sendMainMenu(chatId, user, msgId); }

  // ════════════════════════════════════════════
  // 💰 PORTEFEUILLE
  // ════════════════════════════════════════════
  if (data === "wallet") return showWallet(chatId, msgId, user);
  if (data === "deposit") return showDeposit(chatId, msgId, user);
  if (data.startsWith("dep_method_")) return selectDepositMethod(chatId, msgId, userId, data.replace("dep_method_", ""));
  if (data === "withdraw") return showWithdraw(chatId, msgId, user);
  if (data.startsWith("wd_method_")) return selectWithdrawMethod(chatId, msgId, userId, data.replace("wd_method_", ""), user);
  if (data === "history") return showHistory(chatId, msgId, userId);

  // ════════════════════════════════════════════
  // 📋 TÂCHES
  // ════════════════════════════════════════════
  if (data === "tasks") return showTasks(chatId, msgId, userId);
  if (data.startsWith("tasks_type_")) return showTasksByType(chatId, msgId, userId, data.replace("tasks_type_", ""));
  if (data.startsWith("task_do_")) return doTask(chatId, msgId, userId, parseInt(data.replace("task_do_", "")));
  if (data.startsWith("task_verify_")) return verifyTask(chatId, msgId, userId, parseInt(data.replace("task_verify_", "")));
  if (data.startsWith("task_proof_")) { setState(userId, "submit_proof", { taskId: parseInt(data.replace("task_proof_", "")) }); return bot.editMessageText("📸 <b>Envoie ta preuve :</b>\n\nEnvoie une capture d'écran ou un lien prouvant que tu as complété la tâche.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data === "my_tasks") return showMyTasks(chatId, msgId, userId);

  // ════════════════════════════════════════════
  // ➕ CRÉER TÂCHE
  // ════════════════════════════════════════════
  if (data === "create_task") return showCreateTask(chatId, msgId, userId);
  if (data.startsWith("ct_type_")) { setState(userId, "ct_title", { type: data.replace("ct_type_", "") }); return bot.editMessageText("📝 <b>Titre de la tâche :</b>\n\nEnvoie un titre court et clair.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data === "ct_confirm") return confirmCreateTask(chatId, msgId, userId);

  // ════════════════════════════════════════════
  // 🎰 JEUX
  // ════════════════════════════════════════════
  if (data === "games") return showGames(chatId, msgId, user);
  if (data === "spin_wheel") return showSpinWheel(chatId, msgId, user);
  if (data === "spin_free") return doSpin(chatId, msgId, userId, true);
  if (data === "spin_paid") return doSpin(chatId, msgId, userId, false);
  if (data === "dice_game") return showDice(chatId, msgId, user);
  if (data.startsWith("dice_")) return playDice(chatId, msgId, userId, data.replace("dice_", ""), user);
  if (data === "coinflip") return showCoinflip(chatId, msgId, user);
  if (data.startsWith("flip_")) return playCoinflip(chatId, msgId, userId, data.replace("flip_", ""), user);

  // ════════════════════════════════════════════
  // 🏆 CONCOURS
  // ════════════════════════════════════════════
  if (data === "giveaways") return showGiveaways(chatId, msgId, userId);
  if (data.startsWith("giveaway_")) return showGiveawayDetails(chatId, msgId, userId, parseInt(data.replace("giveaway_", "")));
  if (data.startsWith("enter_giveaway_")) return enterGiveaway(chatId, msgId, userId, parseInt(data.replace("enter_giveaway_", "")));

  // ════════════════════════════════════════════
  // 👥 PARRAINAGE
  // ════════════════════════════════════════════
  if (data === "referral") return showReferral(chatId, msgId, user);

  // ════════════════════════════════════════════
  // 🎁 BONUS QUOTIDIEN
  // ════════════════════════════════════════════
  if (data === "daily_bonus") return claimDailyBonus(chatId, msgId, userId);

  // ════════════════════════════════════════════
  // 💎 VIP
  // ════════════════════════════════════════════
  if (data === "vip") return showVIP(chatId, msgId, user);
  if (data.startsWith("buy_vip_")) return buyVIP(chatId, msgId, userId, parseInt(data.replace("buy_vip_", "")));

  // ════════════════════════════════════════════
  // 📊 STATS & CLASSEMENT
  // ════════════════════════════════════════════
  if (data === "stats") return showUserStats(chatId, msgId, user);
  if (data === "leaderboard") return showLeaderboard(chatId, msgId);
  if (data.startsWith("top_")) return showLeaderboard(chatId, msgId, data.replace("top_", ""));

  // ════════════════════════════════════════════
  // 🎫 SUPPORT
  // ════════════════════════════════════════════
  if (data === "support") return showSupport(chatId, msgId, userId);
  if (data === "new_ticket") { setState(userId, "ticket_subject"); return bot.editMessageText("🎫 <b>Nouveau Ticket</b>\n\nEnvoie le sujet de ta demande.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data === "my_tickets") return showMyTickets(chatId, msgId, userId);

  // ════════════════════════════════════════════
  // ⚙️ PARAMÈTRES UTILISATEUR
  // ════════════════════════════════════════════
  if (data === "settings") return showUserSettings(chatId, msgId, user);
  if (data.startsWith("set_lang_")) { db.updateUser(userId, { language: data.replace("set_lang_", "") }); return showUserSettings(chatId, msgId, db.getUser(userId)); }

  // ════════════════════════════════════════════
  // 👑 ADMIN
  // ════════════════════════════════════════════
  if (data === "admin" && isAdmin(userId)) return showAdmin(chatId, msgId);
  if (data === "admin_stats" && isAdmin(userId)) return showAdminStats(chatId, msgId);
  if (data === "admin_tasks" && isAdmin(userId)) return showAdminTasks(chatId, msgId);
  if (data === "admin_proofs" && isAdmin(userId)) return showAdminProofs(chatId, msgId);
  if (data === "admin_withdrawals" && isAdmin(userId)) return showAdminWithdrawals(chatId, msgId);
  if (data === "admin_deposits" && isAdmin(userId)) return showAdminDeposits(chatId, msgId);
  if (data === "admin_users" && isAdmin(userId)) return showAdminUsers(chatId, msgId);
  if (data === "admin_giveaways" && isAdmin(userId)) return showAdminGiveaways(chatId, msgId);
  if (data === "admin_tickets" && isAdmin(userId)) return showAdminTickets(chatId, msgId);
  if (data === "admin_broadcast" && isAdmin(userId)) { setState(userId, "broadcast"); return bot.editMessageText("📢 <b>Broadcast</b>\n\nEnvoie le message à diffuser à tous les utilisateurs.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data === "admin_settings" && isAdmin(userId)) return showAdminSettings(chatId, msgId);

  // Admin actions tâches
  if (data.startsWith("adm_approve_task_") && isAdmin(userId)) return adminApproveTask(chatId, msgId, parseInt(data.replace("adm_approve_task_", "")));
  if (data.startsWith("adm_reject_task_") && isAdmin(userId)) return adminRejectTask(chatId, msgId, parseInt(data.replace("adm_reject_task_", "")));

  // Admin actions preuves
  if (data.startsWith("adm_approve_proof_") && isAdmin(userId)) return adminApproveProof(chatId, msgId, data.replace("adm_approve_proof_", ""));
  if (data.startsWith("adm_reject_proof_") && isAdmin(userId)) return adminRejectProof(chatId, msgId, data.replace("adm_reject_proof_", ""));

  // Admin actions retraits
  if (data.startsWith("adm_pay_wd_") && isAdmin(userId)) return adminPayWithdrawal(chatId, msgId, parseInt(data.replace("adm_pay_wd_", "")));
  if (data.startsWith("adm_reject_wd_") && isAdmin(userId)) return adminRejectWithdrawal(chatId, msgId, parseInt(data.replace("adm_reject_wd_", "")));

  // Admin actions dépôts
  if (data.startsWith("adm_confirm_dep_") && isAdmin(userId)) return adminConfirmDeposit(chatId, msgId, parseInt(data.replace("adm_confirm_dep_", "")));
  if (data.startsWith("adm_reject_dep_") && isAdmin(userId)) return adminRejectDeposit(chatId, msgId, parseInt(data.replace("adm_reject_dep_", "")));

  // Admin actions concours
  if (data === "admin_new_giveaway" && isAdmin(userId)) { setState(userId, "ga_title"); return bot.editMessageText("🏆 <b>Nouveau Concours</b>\n\nEnvoie le titre du concours.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data.startsWith("adm_draw_ga_") && isAdmin(userId)) return adminDrawGiveaway(chatId, msgId, parseInt(data.replace("adm_draw_ga_", "")));

  // Admin actions tickets
  if (data.startsWith("adm_ticket_") && isAdmin(userId)) return adminViewTicket(chatId, msgId, parseInt(data.replace("adm_ticket_", "")));
  if (data.startsWith("adm_reply_ticket_") && isAdmin(userId)) { setState(userId, "ticket_reply", { ticketId: parseInt(data.replace("adm_reply_ticket_", "")) }); return bot.editMessageText("💬 <b>Répondre au ticket</b>\n\nEnvoie ta réponse.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data.startsWith("adm_close_ticket_") && isAdmin(userId)) return adminCloseTicket(chatId, msgId, parseInt(data.replace("adm_close_ticket_", "")));

  // Admin actions utilisateurs
  if (data === "admin_add_balance" && isAdmin(userId)) { setState(userId, "adm_balance_uid"); return bot.editMessageText("💰 <b>Modifier solde</b>\n\nEnvoie l'ID Telegram de l'utilisateur.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data === "admin_ban" && isAdmin(userId)) { setState(userId, "adm_ban_uid"); return bot.editMessageText("⛔ <b>Bannir</b>\n\nEnvoie l'ID Telegram à bannir.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }
  if (data === "admin_unban" && isAdmin(userId)) { setState(userId, "adm_unban_uid"); return bot.editMessageText("✅ <b>Débannir</b>\n\nEnvoie l'ID Telegram à débannir.", { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }); }

  // Admin paramètres
  if (data.startsWith("adm_set_") && isAdmin(userId)) return handleAdminSetting(chatId, msgId, userId, data.replace("adm_set_", ""));
});

// ============================================
// 💬 MESSAGES
// ============================================

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const state = getState(userId);
  if (!state) return;

  const user = db.getUser(userId);
  if (!user) return;

  const back = { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] };

  // ════════════ CRÉATION TÂCHE ════════════
  if (state.state === "ct_title") {
    setState(userId, "ct_desc", { ...state.data, title: text });
    return bot.sendMessage(chatId, "📝 <b>Description :</b>\n\nDécris ce que l'utilisateur doit faire.", { parse_mode: "HTML" });
  }
  if (state.state === "ct_desc") {
    setState(userId, "ct_link", { ...state.data, description: text });
    return bot.sendMessage(chatId, "🔗 <b>Lien :</b>\n\nEnvoie le lien (URL ou @username).", { parse_mode: "HTML" });
  }
  if (state.state === "ct_link") {
    setState(userId, "ct_reward", { ...state.data, link: text });
    const t = config.TASK_TYPES[state.data.type];
    return bot.sendMessage(chatId, `💰 <b>Récompense par complétion :</b>\n\nMin: ${fmt(t.reward_min)} | Max: ${fmt(t.reward_max)}\nDéfaut: ${fmt(t.reward_default)}`, { parse_mode: "HTML" });
  }
  if (state.state === "ct_reward") {
    const reward = parseFloat(text);
    const t = config.TASK_TYPES[state.data.type];
    if (isNaN(reward) || reward < t.reward_min || reward > t.reward_max) {
      return bot.sendMessage(chatId, `❌ Entre ${fmt(t.reward_min)} et ${fmt(t.reward_max)}`);
    }
    setState(userId, "ct_max", { ...state.data, reward });
    return bot.sendMessage(chatId, "🔢 <b>Nombre de complétions :</b>\n\nCombien d'utilisateurs max ? (ex: 100)", { parse_mode: "HTML" });
  }
  if (state.state === "ct_max") {
    const max = parseInt(text);
    if (isNaN(max) || max < 1 || max > 10000) return bot.sendMessage(chatId, "❌ Entre 1 et 10000");
    
    const d = { ...state.data, maxCompletions: max };
    const t = config.TASK_TYPES[d.type];
    const budget = (d.reward + t.platform_fee) * max;

    setState(userId, "ct_confirm", d);

    const summary = `
📋 <b>Résumé :</b>

Type : ${t.name}
Titre : <b>${esc(d.title)}</b>
Description : ${esc(d.description)}
Lien : ${esc(d.link)}
Récompense : ${fmt(d.reward)}
Max : ${max} complétions
Frais : ${fmt(t.platform_fee)}/complétion

💵 <b>Budget total : ${fmt(budget)}</b>
💰 Ton solde : ${fmt(user.balance)}

${user.balance >= budget ? "✅ Prêt à créer !" : "⚠️ Solde insuffisant !"}`;

    const kb = user.balance >= budget ? {
      inline_keyboard: [[{ text: "✅ Confirmer", callback_data: "ct_confirm" }, { text: "❌ Annuler", callback_data: "back_main" }]]
    } : {
      inline_keyboard: [[{ text: "💳 Déposer", callback_data: "deposit" }, { text: "❌ Annuler", callback_data: "back_main" }]]
    };

    return bot.sendMessage(chatId, summary, { parse_mode: "HTML", reply_markup: kb });
  }

  // ════════════ DÉPÔT ════════════
  if (state.state === "deposit_amount") {
    const amount = parseFloat(text);
    const method = config.DEPOSIT_METHODS[state.data.method];
    if (isNaN(amount) || amount < method.minAmount) {
      return bot.sendMessage(chatId, `❌ Minimum : ${method.minAmount} ${method.symbol}`);
    }
    
    const depId = db.createDeposit(userId, state.data.method, amount);
    clearState(userId);

    const msg2 = `
💳 <b>Dépôt #${depId}</b>

Montant : <b>${amount} ${method.symbol}</b>
Réseau : <b>${method.network}</b>

📋 Envoie exactement <b>${amount} ${method.symbol}</b> à :
<code>${method.wallet}</code>

⚠️ Envoie UNIQUEMENT sur le réseau ${method.network} !

Le dépôt sera confirmé automatiquement ou par l'admin.`;

    // Notifier admins
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid, `💳 <b>Nouveau dépôt</b>\n\n${esc(user.first_name)} (@${user.username || "N/A"})\nID: <code>${userId}</code>\nMontant: ${amount} ${method.symbol}\n#${depId}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "✅ Confirmer", callback_data: `adm_confirm_dep_${depId}` }, { text: "❌ Rejeter", callback_data: `adm_reject_dep_${depId}` }]] }
      }).catch(() => {});
    }

    return bot.sendMessage(chatId, msg2, { parse_mode: "HTML", reply_markup: back });
  }

  // ════════════ RETRAIT ════════════
  if (state.state === "withdraw_amount") {
    const amount = parseFloat(text);
    const minWd = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxWd = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    if (isNaN(amount) || amount < minWd || amount > maxWd) {
      return bot.sendMessage(chatId, `❌ Min: ${fmt(minWd)} | Max: ${fmt(maxWd)}`);
    }
    if (amount > user.balance) return bot.sendMessage(chatId, `❌ Solde insuffisant : ${fmt(user.balance)}`);
    
    setState(userId, "withdraw_wallet", { ...state.data, amount });
    return bot.sendMessage(chatId, `📋 <b>Adresse wallet ${state.data.method} :</b>\n\nEnvoie ton adresse de réception.`, { parse_mode: "HTML" });
  }
  if (state.state === "withdraw_wallet") {
    const wallet = text;
    const wdId = db.createWithdrawal(userId, state.data.method, state.data.amount, wallet);
    clearState(userId);

    if (!wdId) return bot.sendMessage(chatId, "❌ Erreur, solde insuffisant.", { reply_markup: back });

    const wd = db.db.prepare("SELECT * FROM withdrawals WHERE withdrawal_id = ?").get(wdId);

    bot.sendMessage(chatId, `🏧 <b>Retrait #${wdId}</b>\n\nMontant : ${fmt(wd.amount)}\nFrais : ${fmt(wd.fee)}\nNet : <b>${fmt(wd.net_amount)}</b>\n\n⏳ En attente de validation.`, { parse_mode: "HTML", reply_markup: back });

    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid, `🏧 <b>Nouveau retrait</b>\n\n${esc(user.first_name)} (@${user.username || "N/A"})\nMontant: ${fmt(wd.amount)} → ${fmt(wd.net_amount)}\nWallet: <code>${esc(wallet)}</code>\n#${wdId}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "✅ Payer", callback_data: `adm_pay_wd_${wdId}` }, { text: "❌ Rejeter", callback_data: `adm_reject_wd_${wdId}` }]] }
      }).catch(() => {});
    }
    return;
  }

  // ════════════ PREUVE TÂCHE ════════════
  if (state.state === "submit_proof") {
    db.submitTaskProof(state.data.taskId, userId, text, text);
    clearState(userId);
    
    bot.sendMessage(chatId, "✅ <b>Preuve soumise !</b>\n\nElle sera vérifiée par un admin.", { parse_mode: "HTML", reply_markup: back });

    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid, `📸 <b>Nouvelle preuve</b>\n\nTâche #${state.data.taskId}\nUser: ${esc(user.first_name)} (${userId})\nPreuve: ${esc(text)}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "✅", callback_data: `adm_approve_proof_${state.data.taskId}_${userId}` }, { text: "❌", callback_data: `adm_reject_proof_${state.data.taskId}_${userId}` }]] }
      }).catch(() => {});
    }
    return;
  }

  // ════════════ TICKET ════════════
  if (state.state === "ticket_subject") {
    setState(userId, "ticket_message", { subject: text });
    return bot.sendMessage(chatId, "💬 <b>Message :</b>\n\nDécris ton problème en détail.", { parse_mode: "HTML" });
  }
  if (state.state === "ticket_message") {
    const ticketId = db.createTicket(userId, state.data.subject, text);
    clearState(userId);
    
    bot.sendMessage(chatId, `✅ <b>Ticket #${ticketId} créé !</b>\n\nNous te répondrons bientôt.`, { parse_mode: "HTML", reply_markup: back });

    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid, `🎫 <b>Nouveau ticket #${ticketId}</b>\n\n${esc(user.first_name)} (@${user.username || "N/A"})\nSujet: ${esc(state.data.subject)}\n\n${esc(text)}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "💬 Répondre", callback_data: `adm_reply_ticket_${ticketId}` }, { text: "✖️ Fermer", callback_data: `adm_close_ticket_${ticketId}` }]] }
      }).catch(() => {});
    }
    return;
  }

  // ════════════ ADMIN STATES ════════════
  if (state.state === "broadcast" && isAdmin(userId)) {
    clearState(userId);
    const users = db.getAllUsers();
    let sent = 0, fail = 0;
    bot.sendMessage(chatId, `📢 Envoi à ${users.length} utilisateurs...`);
    for (const u of users) {
      try {
        await bot.sendMessage(u.user_id, `📢 <b>Annonce</b>\n\n${text}`, { parse_mode: "HTML" });
        sent++;
      } catch { fail++; }
      await new Promise(r => setTimeout(r, 35));
    }
    return bot.sendMessage(chatId, `✅ Envoyé: ${sent} | Échec: ${fail}`, { reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
  }

  if (state.state === "adm_balance_uid" && isAdmin(userId)) {
    const target = db.getUser(parseInt(text));
    if (!target) return bot.sendMessage(chatId, "❌ Utilisateur non trouvé");
    setState(userId, "adm_balance_amount", { targetId: target.user_id });
    return bot.sendMessage(chatId, `Utilisateur: <b>${esc(target.first_name)}</b>\nSolde: ${fmt(target.balance)}\n\n💰 Montant à ajouter (négatif pour retirer):`, { parse_mode: "HTML" });
  }
  if (state.state === "adm_balance_amount" && isAdmin(userId)) {
    const amount = parseFloat(text);
    if (isNaN(amount)) return bot.sendMessage(chatId, "❌ Montant invalide");
    db.updateBalance(state.data.targetId, amount, "admin_adjust", `Admin: ${amount > 0 ? "+" : ""}${fmt(amount)}`);
    clearState(userId);
    const target = db.getUser(state.data.targetId);
    bot.sendMessage(state.data.targetId, `💰 Solde modifié par admin: <b>${amount > 0 ? "+" : ""}${fmt(amount)}</b>\nNouveau solde: ${fmt(target.balance)}`, { parse_mode: "HTML" }).catch(() => {});
    return bot.sendMessage(chatId, `✅ ${esc(target.first_name)}: ${fmt(target.balance)}`, { reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
  }

  if (state.state === "adm_ban_uid" && isAdmin(userId)) {
    const target = db.getUser(parseInt(text));
    if (!target) return bot.sendMessage(chatId, "❌ Non trouvé");
    db.banUser(target.user_id, true, "Banni par admin");
    clearState(userId);
    return bot.sendMessage(chatId, `⛔ ${esc(target.first_name)} banni.`, { reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
  }
  if (state.state === "adm_unban_uid" && isAdmin(userId)) {
    const target = db.getUser(parseInt(text));
    if (!target) return bot.sendMessage(chatId, "❌ Non trouvé");
    db.banUser(target.user_id, false);
    clearState(userId);
    return bot.sendMessage(chatId, `✅ ${esc(target.first_name)} débanni.`, { reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
  }

  if (state.state === "ticket_reply" && isAdmin(userId)) {
    db.respondToTicket(state.data.ticketId, text, userId);
    const ticket = db.getTicket(state.data.ticketId);
    clearState(userId);
    if (ticket) {
      bot.sendMessage(ticket.user_id, `💬 <b>Réponse à ton ticket #${ticket.ticket_id}</b>\n\nSujet: ${esc(ticket.subject)}\n\n${esc(text)}`, { parse_mode: "HTML" }).catch(() => {});
    }
    return bot.sendMessage(chatId, "✅ Réponse envoyée", { reply_markup: { inline_keyboard: [[{ text: "◀️ Tickets", callback_data: "admin_tickets" }]] } });
  }

  // ════════════ CONCOURS ADMIN ════════════
  if (state.state === "ga_title" && isAdmin(userId)) {
    setState(userId, "ga_desc", { title: text });
    return bot.sendMessage(chatId, "📝 Description du concours:");
  }
  if (state.state === "ga_desc" && isAdmin(userId)) {
    setState(userId, "ga_prize", { ...state.data, description: text });
    return bot.sendMessage(chatId, "💰 Prix total (en devise):");
  }
  if (state.state === "ga_prize" && isAdmin(userId)) {
    const prize = parseFloat(text);
    if (isNaN(prize) || prize <= 0) return bot.sendMessage(chatId, "❌ Montant invalide");
    setState(userId, "ga_winners", { ...state.data, prizeAmount: prize });
    return bot.sendMessage(chatId, "🏆 Nombre de gagnants:");
  }
  if (state.state === "ga_winners" && isAdmin(userId)) {
    const winners = parseInt(text);
    if (isNaN(winners) || winners < 1) return bot.sendMessage(chatId, "❌ Nombre invalide");
    setState(userId, "ga_duration", { ...state.data, winnerCount: winners });
    return bot.sendMessage(chatId, "⏰ Durée en heures:");
  }
  if (state.state === "ga_duration" && isAdmin(userId)) {
    const hours = parseInt(text);
    if (isNaN(hours) || hours < 1) return bot.sendMessage(chatId, "❌ Durée invalide");
    const d = state.data;
    const endsAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const gaId = db.createGiveaway({ ...d, endsAt, createdBy: userId });
    clearState(userId);
    return bot.sendMessage(chatId, `✅ <b>Concours #${gaId} créé !</b>\n\n${esc(d.title)}\nPrix: ${fmt(d.prizeAmount)}\nGagnants: ${d.winnerCount}\nFin dans: ${hours}h`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] }
    });
  }

  // ════════════ ADMIN SETTINGS ════════════
  if (state.state && state.state.startsWith("setting_") && isAdmin(userId)) {
    const key = state.state.replace("setting_", "");
    const type = state.data.type || "string";
    let value = text;
    if (type === "number") value = parseFloat(text);
    if (type === "boolean") value = text.toLowerCase() === "true" || text === "1";
    db.setSetting(key, value, type);
    clearState(userId);
    return bot.sendMessage(chatId, `✅ ${key} = ${value}`, { reply_markup: { inline_keyboard: [[{ text: "◀️ Paramètres", callback_data: "admin_settings" }]] } });
  }
});

// ============================================
// 📋 FONCTIONS D'AFFICHAGE
// ============================================

function showWallet(chatId, msgId, user) {
  const text = `
💰 <b>Mon Portefeuille</b>

💵 Solde : <b>${fmt(user.balance)}</b>
📈 Gagné : ${fmt(user.total_earned)}
💳 Déposé : ${fmt(user.total_deposited)}
🏧 Retiré : ${fmt(user.total_withdrawn)}
💸 Dépensé : ${fmt(user.total_spent)}`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💳 Déposer", callback_data: "deposit" }, { text: "🏧 Retirer", callback_data: "withdraw" }],
        [{ text: "📜 Historique", callback_data: "history" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

function showDeposit(chatId, msgId, user) {
  let text = `💳 <b>Déposer</b>\n\nChoisis ta méthode de dépôt :\n`;
  const buttons = [];

  for (const [key, method] of Object.entries(config.DEPOSIT_METHODS)) {
    if (method.enabled) {
      text += `\n• ${method.name} (min: ${method.minAmount} ${method.symbol})`;
      buttons.push([{ text: method.name, callback_data: `dep_method_${key}` }]);
    }
  }

  buttons.push([{ text: "◀️ Retour", callback_data: "wallet" }]);
  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function selectDepositMethod(chatId, msgId, userId, method) {
  const m = config.DEPOSIT_METHODS[method];
  if (!m || !m.enabled) return;
  setState(userId, "deposit_amount", { method });
  bot.editMessageText(`💳 <b>${m.name}</b>\n\n📋 Adresse:\n<code>${m.wallet}</code>\n\n⚠️ Réseau: ${m.network}\nMin: ${m.minAmount} ${m.symbol}\n\n💰 Envoie le montant à déposer:`, { chat_id: chatId, message_id: msgId, parse_mode: "HTML" });
}

function showWithdraw(chatId, msgId, user) {
  const minWd = db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL);
  const feeP = db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT);

  let text = `🏧 <b>Retirer</b>\n\n💰 Solde: ${fmt(user.balance)}\n📉 Min: ${fmt(minWd)}\n💸 Frais: ${feeP}%\n\nChoisis la méthode:`;
  const buttons = [];

  for (const [key, m] of Object.entries(config.WITHDRAWAL_METHODS)) {
    if (m.enabled) {
      buttons.push([{ text: m.name, callback_data: `wd_method_${key}` }]);
    }
  }

  buttons.push([{ text: "◀️ Retour", callback_data: "wallet" }]);
  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function selectWithdrawMethod(chatId, msgId, userId, method, user) {
  const minWd = db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL);
  if (user.balance < minWd) {
    return bot.editMessageText(`❌ Solde insuffisant.\n\nMin: ${fmt(minWd)}\nTon solde: ${fmt(user.balance)}`, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "wallet" }]] }
    });
  }
  setState(userId, "withdraw_amount", { method });
  bot.editMessageText(`🏧 <b>${method}</b>\n\n💰 Montant à retirer:`, { chat_id: chatId, message_id: msgId, parse_mode: "HTML" });
}

function showHistory(chatId, msgId, userId) {
  const txs = db.getUserTransactions(userId, 15);
  let text = `📜 <b>Historique</b>\n\n`;
  if (txs.length === 0) {
    text += "Aucune transaction.";
  } else {
    txs.forEach(t => {
      const e = t.amount > 0 ? "🟢" : "🔴";
      text += `${e} ${t.amount > 0 ? "+" : ""}${fmt(t.amount)} — ${esc(t.description).slice(0, 30)}\n`;
    });
  }
  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "wallet" }]] } });
}

function showTasks(chatId, msgId, userId) {
  let text = `📋 <b>Tâches Disponibles</b>\n\nChoisis une catégorie:\n`;
  const buttons = [];

  for (const [key, t] of Object.entries(config.TASK_TYPES)) {
    if (t.enabled) {
      const count = db.getActiveTasks(key, userId).length;
      buttons.push([{ text: `${t.name} (${count})`, callback_data: `tasks_type_${key}` }]);
    }
  }

  buttons.push([{ text: "📊 Mes Tâches", callback_data: "my_tasks" }]);
  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function showTasksByType(chatId, msgId, userId, type) {
  const tasks = db.getActiveTasks(type, userId);
  const t = config.TASK_TYPES[type];
  let text = `${t.name}\n\n`;

  if (tasks.length === 0) {
    text += "Aucune tâche disponible.";
  } else {
    tasks.slice(0, 8).forEach(task => {
      text += `🔹 <b>${esc(task.title)}</b>\n   💰 ${fmt(task.reward)}\n\n`;
    });
  }

  const buttons = tasks.slice(0, 8).map(task => [{ text: `✅ ${task.title.slice(0, 20)} (${fmt(task.reward)})`, callback_data: `task_do_${task.task_id}` }]);
  buttons.push([{ text: "◀️ Retour", callback_data: "tasks" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

async function doTask(chatId, msgId, userId, taskId) {
  const task = db.getTask(taskId);
  if (!task || task.status !== "active") {
    return bot.editMessageText("❌ Tâche non disponible.", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "tasks" }]] } });
  }

  const result = db.startTaskCompletion(taskId, userId);
  if (!result) {
    return bot.editMessageText("❌ Tu as déjà fait cette tâche.", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "tasks" }]] } });
  }

  const t = config.TASK_TYPES[task.type];
  const stayInfo = t.min_stay_hours ? `⏱ Reste abonné ${t.min_stay_hours}h` : t.min_stay_seconds ? `⏱ Reste ${t.min_stay_seconds}s` : "";

  const text = `
📋 <b>${esc(task.title)}</b>

${esc(task.description || "Aucune description")}

🔗 ${esc(task.link)}
💰 Récompense: <b>${fmt(task.reward)}</b>
${stayInfo}

${task.proof_required ? "📸 Une preuve sera demandée." : ""}

1️⃣ Clique sur le lien
2️⃣ ${task.type === "bot" ? "Démarre le bot" : "Rejoins"}
3️⃣ Reviens cliquer Vérifier`;

  const url = task.link.startsWith("http") ? task.link : `https://t.me/${task.link.replace("@", "")}`;
  const buttons = [[{ text: "🔗 Ouvrir", url }]];
  
  if (task.proof_required) {
    buttons.push([{ text: "📸 Soumettre Preuve", callback_data: `task_proof_${taskId}` }]);
  } else {
    buttons.push([{ text: "✅ Vérifier", callback_data: `task_verify_${taskId}` }]);
  }
  buttons.push([{ text: "◀️ Retour", callback_data: "tasks" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

async function verifyTask(chatId, msgId, userId, taskId) {
  const task = db.getTask(taskId);
  if (!task) return;

  // Vérifier abonnement si possible
  if ((task.type === "channel" || task.type === "group") && task.chat_id) {
    const isMember = await checkMembership(task.chat_id, userId);
    if (!isMember) {
      return bot.editMessageText("❌ Tu n'es pas membre ! Rejoins d'abord.", {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: "✅ Revérifier", callback_data: `task_verify_${taskId}` }], [{ text: "◀️ Retour", callback_data: "tasks" }]] }
      });
    }
  }

  const result = db.verifyTaskCompletion(taskId, userId);

  if (result.success) {
    bot.editMessageText(`✅ <b>Tâche complétée !</b>\n\n💰 +${fmt(result.reward)}`, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "📋 Plus de tâches", callback_data: "tasks" }, { text: "🏠 Menu", callback_data: "back_main" }]] }
    });
  } else if (result.reason === "too_early") {
    const m = Math.floor(result.remaining / 60);
    const s = result.remaining % 60;
    bot.editMessageText(`⏳ Attends encore <b>${m}m ${s}s</b>`, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "✅ Revérifier", callback_data: `task_verify_${taskId}` }], [{ text: "◀️ Retour", callback_data: "tasks" }]] }
    });
  } else {
    bot.editMessageText("❌ Erreur de vérification.", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "tasks" }]] } });
  }
}

function showMyTasks(chatId, msgId, userId) {
  const created = db.getUserTasks(userId);
  const completed = db.getUserCompletions(userId);

  let text = `📊 <b>Mes Tâches</b>\n\n<b>Créées (${created.length}):</b>\n`;
  created.slice(0, 5).forEach(t => {
    const s = { pending: "⏳", active: "✅", completed: "🏁", rejected: "❌" }[t.status] || "❓";
    text += `${s} ${esc(t.title)} — ${t.current_completions}/${t.max_completions}\n`;
  });

  text += `\n<b>Complétées (${completed.length}):</b>\n`;
  completed.slice(0, 5).forEach(c => {
    const s = c.status === "verified" ? "✅" : "⏳";
    text += `${s} ${esc(c.title)} — ${fmt(c.reward)}\n`;
  });

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "tasks" }]] } });
}

function showCreateTask(chatId, msgId, userId) {
  let text = `➕ <b>Créer une Tâche</b>\n\nChoisis le type:\n`;
  const buttons = [];

  for (const [key, t] of Object.entries(config.TASK_TYPES)) {
    if (t.enabled) {
      text += `\n${t.name} — ${fmt(t.reward_default)}/complétion`;
      buttons.push([{ text: t.name, callback_data: `ct_type_${key}` }]);
    }
  }

  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);
  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function confirmCreateTask(chatId, msgId, userId) {
  const state = getState(userId);
  if (!state || state.state !== "ct_confirm") return;

  const d = state.data;
  const t = config.TASK_TYPES[d.type];
  
  let chatIdTarget = null;
  if (d.link.includes("t.me/")) {
    const m = d.link.match(/t\.me\/([a-zA-Z0-9_]+)/);
    if (m) chatIdTarget = "@" + m[1];
  } else if (d.link.startsWith("@")) {
    chatIdTarget = d.link;
  }

  const taskId = db.createTask({
    creatorId: userId,
    type: d.type,
    title: d.title,
    description: d.description,
    link: d.link,
    chatId: chatIdTarget,
    reward: d.reward,
    maxCompletions: d.maxCompletions,
    proofRequired: t.verification === "manual",
  });

  clearState(userId);

  if (!taskId) {
    return bot.editMessageText("❌ Erreur, solde insuffisant.", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] } });
  }

  const user = db.getUser(userId);
  for (const aid of config.ADMIN_IDS) {
    bot.sendMessage(aid, `📋 <b>Nouvelle tâche #${taskId}</b>\n\n${t.name}\n${esc(d.title)}\n${esc(d.link)}\n${fmt(d.reward)} × ${d.maxCompletions}\n\nPar: ${esc(user.first_name)}`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "✅ Approuver", callback_data: `adm_approve_task_${taskId}` }, { text: "❌ Rejeter", callback_data: `adm_reject_task_${taskId}` }]] }
    }).catch(() => {});
  }

  bot.editMessageText(`✅ <b>Tâche #${taskId} créée !</b>\n\nEn attente de validation.`, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] } });
}

// ============================================
// 🎰 JEUX
// ============================================

function showGames(chatId, msgId, user) {
  const text = `
🎰 <b>Mini-Jeux</b>

💰 Solde: ${fmt(user.balance)}
🎟️ Spins gratuits: ${user.free_spins}

Choisis un jeu:`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎡 Roue de la Fortune", callback_data: "spin_wheel" }],
        [{ text: "🎲 Dés", callback_data: "dice_game" }, { text: "🪙 Pile ou Face", callback_data: "coinflip" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

function showSpinWheel(chatId, msgId, user) {
  const cost = db.getSetting("spin_cost", config.SPIN_WHEEL.cost);
  const text = `
🎡 <b>Roue de la Fortune</b>

💰 Coût: ${fmt(cost)}
🎟️ Spins gratuits: ${user.free_spins}

Gains possibles:
${config.SPIN_WHEEL.prizes.map(p => `• ${p.label} (${p.chance}%)`).join("\n")}`;

  const buttons = [];
  if (user.free_spins > 0) buttons.push([{ text: "🎟️ Spin Gratuit", callback_data: "spin_free" }]);
  if (user.balance >= cost) buttons.push([{ text: `🎡 Spin (${fmt(cost)})`, callback_data: "spin_paid" }]);
  buttons.push([{ text: "◀️ Retour", callback_data: "games" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function doSpin(chatId, msgId, userId, free) {
  const result = db.spinWheel(userId, free);
  if (!result.success) {
    return bot.editMessageText(`❌ ${result.reason === "no_free_spins" ? "Plus de spins gratuits" : "Solde insuffisant"}`, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "games" }]] }
    });
  }

  const text = `🎡 <b>La roue tourne...</b>\n\n🎯 Résultat: <b>${result.prize.label}</b>${result.prize.value > 0 ? `\n\n💰 +${fmt(result.prize.value)}` : ""}`;
  
  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "🔄 Rejouer", callback_data: "spin_wheel" }, { text: "◀️ Jeux", callback_data: "games" }]] }
  });
}

function showDice(chatId, msgId, user) {
  const minBet = config.DICE_GAME.min_bet;
  const maxBet = config.DICE_GAME.max_bet;
  const text = `
🎲 <b>Jeu de Dés</b>

Règles: Lance les dés. Si tu obtiens 4, 5 ou 6, tu gagnes x${config.DICE_GAME.multiplier_win} !

💰 Mise: ${fmt(minBet)} - ${fmt(maxBet)}
💵 Solde: ${fmt(user.balance)}`;

  const buttons = [
    [{ text: `${fmt(0.1)}`, callback_data: "dice_0.1" }, { text: `${fmt(0.5)}`, callback_data: "dice_0.5" }, { text: `${fmt(1)}`, callback_data: "dice_1" }],
    [{ text: `${fmt(2)}`, callback_data: "dice_2" }, { text: `${fmt(5)}`, callback_data: "dice_5" }],
    [{ text: "◀️ Retour", callback_data: "games" }]
  ];

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

async function playDice(chatId, msgId, userId, betStr, user) {
  const bet = parseFloat(betStr);
  if (user.balance < bet) return bot.editMessageText("❌ Solde insuffisant", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "games" }]] } });

  db.updateBalance(userId, -bet, "dice_bet", `Dés: mise ${fmt(bet)}`);

  const diceMsg = await bot.sendDice(chatId, { emoji: "🎲" });
  const value = diceMsg.dice.value;

  await new Promise(r => setTimeout(r, 3500));

  let win = 0;
  let text = `🎲 Résultat: <b>${value}</b>\n\n`;
  if (value >= 4) {
    win = Math.round(bet * config.DICE_GAME.multiplier_win * 100) / 100;
    db.updateBalance(userId, win, "dice_win", `Dés: gain ${fmt(win)}`);
    text += `🎉 Tu gagnes <b>${fmt(win)}</b> !`;
  } else {
    text += `😢 Perdu !`;
  }

  db.recordGame(userId, "dice", bet, win, `${value}`);

  bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔄 Rejouer", callback_data: "dice_game" }, { text: "◀️ Jeux", callback_data: "games" }]] } });
}

function showCoinflip(chatId, msgId, user) {
  const text = `
🪙 <b>Pile ou Face</b>

Choisis ta mise:

💵 Solde: ${fmt(user.balance)}`;

  const buttons = [
    [{ text: `${fmt(0.1)}`, callback_data: "flip_0.1" }, { text: `${fmt(0.5)}`, callback_data: "flip_0.5" }, { text: `${fmt(1)}`, callback_data: "flip_1" }],
    [{ text: `${fmt(2)}`, callback_data: "flip_2" }, { text: `${fmt(5)}`, callback_data: "flip_5" }],
    [{ text: "◀️ Retour", callback_data: "games" }]
  ];

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function playCoinflip(chatId, msgId, userId, betStr, user) {
  const bet = parseFloat(betStr);
  if (user.balance < bet) return bot.editMessageText("❌ Solde insuffisant", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "games" }]] } });

  db.updateBalance(userId, -bet, "coinflip_bet", `Pile/Face: mise ${fmt(bet)}`);

  const result = Math.random() > 0.5 ? "pile" : "face";
  const won = Math.random() > 0.5;

  let text = `🪙 La pièce tourne...\n\n`;
  let win = 0;

  if (won) {
    win = Math.round(bet * config.COINFLIP.multiplier_win * 100) / 100;
    db.updateBalance(userId, win, "coinflip_win", `Pile/Face: gain ${fmt(win)}`);
    text += `🎉 <b>${result.toUpperCase()}</b> — Tu gagnes <b>${fmt(win)}</b> !`;
  } else {
    text += `😢 <b>${result.toUpperCase()}</b> — Perdu !`;
  }

  db.recordGame(userId, "coinflip", bet, win, result);

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "🔄 Rejouer", callback_data: "coinflip" }, { text: "◀️ Jeux", callback_data: "games" }]] }
  });
}

// ============================================
// 🏆 CONCOURS
// ============================================

function showGiveaways(chatId, msgId, userId) {
  const giveaways = db.getActiveGiveaways();
  let text = `🏆 <b>Concours Actifs</b>\n\n`;

  if (giveaways.length === 0) {
    text += "Aucun concours actif.";
  } else {
    giveaways.forEach(g => {
      text += `🎁 <b>${esc(g.title)}</b>\n   💰 ${fmt(g.prize_amount)} | 👥 ${g.current_participants} participants\n   ⏰ Fin: ${fmtDate(g.ends_at)}\n\n`;
    });
  }

  const buttons = giveaways.map(g => [{ text: `🎁 ${g.title}`, callback_data: `giveaway_${g.giveaway_id}` }]);
  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function showGiveawayDetails(chatId, msgId, userId, giveawayId) {
  const g = db.getGiveaway(giveawayId);
  if (!g) return;

  const entries = db.getGiveawayEntries(giveawayId);
  const hasEntered = entries.some(e => e.user_id === userId);

  const text = `
🏆 <b>${esc(g.title)}</b>

${esc(g.description || "")}

💰 Prix: <b>${fmt(g.prize_amount)}</b>
🏅 Gagnants: ${g.winner_count}
👥 Participants: ${g.current_participants}${g.max_participants ? `/${g.max_participants}` : ""}
⏰ Fin: ${fmtDate(g.ends_at)}

${g.entry_type === "paid" ? `🎟️ Coût: ${fmt(g.entry_cost)}` : "🆓 Participation gratuite"}

${hasEntered ? "✅ Tu participes déjà !" : ""}`;

  const buttons = [];
  if (!hasEntered && g.status === "active") {
    buttons.push([{ text: "🎟️ Participer", callback_data: `enter_giveaway_${giveawayId}` }]);
  }
  buttons.push([{ text: "◀️ Retour", callback_data: "giveaways" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function enterGiveaway(chatId, msgId, userId, giveawayId) {
  const result = db.enterGiveaway(giveawayId, userId);
  
  if (result.success) {
    bot.editMessageText("✅ <b>Tu participes au concours !</b>\n\nBonne chance ! 🍀", {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Concours", callback_data: "giveaways" }]] }
    });
  } else {
    const reasons = {
      already_entered: "Tu participes déjà !",
      insufficient_balance: "Solde insuffisant",
      full: "Concours complet",
      ended: "Concours terminé",
    };
    bot.editMessageText(`❌ ${reasons[result.reason] || "Erreur"}`, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: "◀️ Concours", callback_data: "giveaways" }]] }
    });
  }
}

// ============================================
// 👥 PARRAINAGE
// ============================================

async function showReferral(chatId, msgId, user) {
  if (!botInfo) botInfo = await bot.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${user.referral_code}`;

  const text = `
👥 <b>Parrainage</b>

🔗 Ton lien:
<code>${link}</code>

💰 Bonus/filleul: ${fmt(db.getSetting("referral_bonus", config.REFERRAL_BONUS))}
📊 Commission: ${db.getSetting("referral_percent", config.REFERRAL_PERCENT)}%

👤 Filleuls: <b>${user.referral_count}</b>
💵 Gains: <b>${fmt(user.referral_earnings)}</b>`;

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] } });
}

// ============================================
// 🎁 BONUS QUOTIDIEN
// ============================================

function claimDailyBonus(chatId, msgId, userId) {
  const result = db.claimDailyBonus(userId);
  
  if (result.success) {
    bot.editMessageText(`🎁 <b>Bonus quotidien !</b>\n\n💰 +${fmt(result.amount)}`, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] }
    });
  } else {
    bot.editMessageText("❌ Tu as déjà réclamé ton bonus aujourd'hui !\n\nReviens demain ! 🌅", {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] }
    });
  }
}

// ============================================
// 💎 VIP
// ============================================

function showVIP(chatId, msgId, user) {
  const currentVip = config.VIP_LEVELS[user.vip_level];
  let text = `
💎 <b>Statuts VIP</b>

Ton statut: <b>${currentVip.name}</b>
${user.vip_expires_at ? `Expire: ${fmtDate(user.vip_expires_at)}` : ""}

<b>Avantages:</b>
`;

  const buttons = [];
  for (const [level, vip] of Object.entries(config.VIP_LEVELS)) {
    if (parseInt(level) > 0 && vip.price) {
      const isCurrent = parseInt(level) === user.vip_level;
      text += `\n${vip.name} — ${fmt(vip.price)}/mois\n   +${vip.bonus_percent}% bonus, -${vip.withdrawal_fee_discount}% frais\n`;
      if (!isCurrent) {
        buttons.push([{ text: `Acheter ${vip.name} (${fmt(vip.price)})`, callback_data: `buy_vip_${level}` }]);
      }
    }
  }

  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);
  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function buyVIP(chatId, msgId, userId, level) {
  const result = db.purchaseVIP(userId, level);
  
  if (result.success) {
    bot.editMessageText(`✅ <b>Félicitations !</b>\n\nTu es maintenant <b>${result.level.name}</b> ! 🎉`, {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] }
    });
  } else {
    bot.editMessageText(`❌ ${result.reason === "insufficient_balance" ? "Solde insuffisant" : "Erreur"}`, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: "◀️ Menu", callback_data: "back_main" }]] }
    });
  }
}

// ============================================
// 📊 STATS & CLASSEMENT
// ============================================

function showUserStats(chatId, msgId, user) {
  const text = `
📊 <b>Mes Statistiques</b>

💰 Solde: ${fmt(user.balance)}
📈 Total gagné: ${fmt(user.total_earned)}
✅ Tâches: ${user.tasks_completed}
➕ Tâches créées: ${user.tasks_created}
👥 Filleuls: ${user.referral_count}
⭐ Niveau: ${user.level}
🏆 XP: ${user.xp}

📅 Inscrit: ${fmtDate(user.created_at)}`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🏆 Classement Gains", callback_data: "top_earned" }],
        [{ text: "✅ Classement Tâches", callback_data: "top_tasks" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

function showLeaderboard(chatId, msgId, type = "earned") {
  const top = db.getTopUsers(type, 10);
  const medals = ["🥇", "🥈", "🥉"];
  const titles = { earned: "💰 Top Gains", tasks: "✅ Top Tâches", referrals: "👥 Top Parrainages" };

  let text = `<b>${titles[type] || "🏆 Classement"}</b>\n\n`;
  top.forEach((u, i) => {
    const m = medals[i] || `${i + 1}.`;
    const val = type === "tasks" ? u.tasks_completed : type === "referrals" ? u.referral_count : fmt(u.total_earned);
    text += `${m} ${esc(u.first_name)} — ${val}\n`;
  });

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "stats" }]] }
  });
}

// ============================================
// 🎫 SUPPORT
// ============================================

function showSupport(chatId, msgId, userId) {
  const tickets = db.getUserTickets(userId);
  const openCount = tickets.filter(t => t.status !== "closed").length;

  const text = `
🎫 <b>Support</b>

Tu as ${openCount} ticket(s) ouvert(s).

Besoin d'aide ? Crée un ticket !`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📝 Nouveau Ticket", callback_data: "new_ticket" }],
        [{ text: "📋 Mes Tickets", callback_data: "my_tickets" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

function showMyTickets(chatId, msgId, userId) {
  const tickets = db.getUserTickets(userId);
  let text = `📋 <b>Mes Tickets</b>\n\n`;

  if (tickets.length === 0) {
    text += "Aucun ticket.";
  } else {
    tickets.slice(0, 10).forEach(t => {
      const s = { open: "🟡", answered: "🟢", closed: "⚫" }[t.status] || "❓";
      text += `${s} #${t.ticket_id} — ${esc(t.subject.slice(0, 30))}\n`;
      if (t.admin_response) text += `   💬 Réponse: ${esc(t.admin_response.slice(0, 50))}...\n`;
    });
  }

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Retour", callback_data: "support" }]] } });
}

// ============================================
// ⚙️ PARAMÈTRES UTILISATEUR
// ============================================

function showUserSettings(chatId, msgId, user) {
  const text = `
⚙️ <b>Paramètres</b>

🌍 Langue: ${user.language === "fr" ? "🇫🇷 Français" : "🇬🇧 English"}`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🇫🇷 Français", callback_data: "set_lang_fr" }, { text: "🇬🇧 English", callback_data: "set_lang_en" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

// ============================================
// 👑 ADMIN
// ============================================

function showAdmin(chatId, msgId) {
  const s = db.getStats();

  const text = `
👑 <b>ADMIN PANEL</b>

👤 Users: ${s.users} (${s.activeUsers24h} actifs)
📋 Tâches: ${s.activeTasks} actives | ${s.pendingTasks} en attente
📸 Preuves: ${s.pendingProofs} en attente
🏧 Retraits: ${s.pendingWithdrawals} (${fmt(s.pendingWithdrawalsAmount)})
💳 Dépôts: ${s.pendingDeposits} en attente
🎫 Tickets: ${s.openTickets} ouverts
🏆 Concours: ${s.activeGiveaways} actifs

💰 Déposé: ${fmt(s.totalDeposited)}
💸 Retiré: ${fmt(s.totalWithdrawn)}
📈 Profit: ${fmt(s.profit)}`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: `📋 Tâches (${s.pendingTasks})`, callback_data: "admin_tasks" }, { text: `📸 Preuves (${s.pendingProofs})`, callback_data: "admin_proofs" }],
        [{ text: `🏧 Retraits (${s.pendingWithdrawals})`, callback_data: "admin_withdrawals" }, { text: `💳 Dépôts (${s.pendingDeposits})`, callback_data: "admin_deposits" }],
        [{ text: "👥 Users", callback_data: "admin_users" }, { text: `🎫 Tickets (${s.openTickets})`, callback_data: "admin_tickets" }],
        [{ text: "🏆 Concours", callback_data: "admin_giveaways" }, { text: "📊 Stats", callback_data: "admin_stats" }],
        [{ text: "📢 Broadcast", callback_data: "admin_broadcast" }, { text: "⚙️ Paramètres", callback_data: "admin_settings" }],
        [{ text: "💰 Solde", callback_data: "admin_add_balance" }, { text: "⛔ Ban", callback_data: "admin_ban" }, { text: "✅ Unban", callback_data: "admin_unban" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

function showAdminStats(chatId, msgId) {
  const s = db.getStats();
  const daily = db.getDailyStats(7);

  let text = `📊 <b>Statistiques détaillées</b>\n\n`;
  text += `👤 Total users: ${s.users}\n`;
  text += `👥 Actifs 24h: ${s.activeUsers24h}\n`;
  text += `👥 Actifs 7j: ${s.activeUsers7d}\n`;
  text += `⛔ Bannis: ${s.bannedUsers}\n`;
  text += `💎 VIP: ${s.vipUsers}\n\n`;
  text += `💰 En circulation: ${fmt(s.totalBalance)}\n`;
  text += `💵 Déposé: ${fmt(s.totalDeposited)}\n`;
  text += `💸 Retiré: ${fmt(s.totalWithdrawn)}\n`;
  text += `🏦 Frais: ${fmt(s.totalFees)}\n`;
  text += `📈 Profit: ${fmt(s.profit)}\n`;

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
}

function showAdminTasks(chatId, msgId) {
  const tasks = db.getPendingTasks();
  let text = `📋 <b>Tâches en attente (${tasks.length})</b>\n\n`;

  const buttons = [];
  tasks.slice(0, 8).forEach(t => {
    text += `#${t.task_id} — ${esc(t.title)}\n${esc(t.link)}\n${fmt(t.reward)} × ${t.max_completions}\n\n`;
    buttons.push([{ text: `✅ #${t.task_id}`, callback_data: `adm_approve_task_${t.task_id}` }, { text: `❌ #${t.task_id}`, callback_data: `adm_reject_task_${t.task_id}` }]);
  });

  if (tasks.length === 0) text += "✅ Aucune tâche en attente";
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function adminApproveTask(chatId, msgId, taskId) {
  db.approveTask(taskId);
  const task = db.getTask(taskId);
  if (task) bot.sendMessage(task.creator_id, `✅ Ta tâche "<b>${esc(task.title)}</b>" est approuvée !`, { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText(`✅ Tâche #${taskId} approuvée`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Tâches", callback_data: "admin_tasks" }]] } });
}

function adminRejectTask(chatId, msgId, taskId) {
  db.rejectTask(taskId);
  const task = db.getTask(taskId);
  if (task) bot.sendMessage(task.creator_id, `❌ Ta tâche "<b>${esc(task.title)}</b>" a été rejetée. Budget remboursé.`, { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText(`❌ Tâche #${taskId} rejetée`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Tâches", callback_data: "admin_tasks" }]] } });
}

function showAdminProofs(chatId, msgId) {
  const proofs = db.getPendingProofs();
  let text = `📸 <b>Preuves en attente (${proofs.length})</b>\n\n`;

  const buttons = [];
  proofs.slice(0, 8).forEach(p => {
    text += `#${p.task_id} — ${esc(p.first_name)}\n${esc(p.proof_url || p.proof_message || "N/A").slice(0, 50)}\n\n`;
    buttons.push([{ text: `✅`, callback_data: `adm_approve_proof_${p.task_id}_${p.user_id}` }, { text: `❌`, callback_data: `adm_reject_proof_${p.task_id}_${p.user_id}` }]);
  });

  if (proofs.length === 0) text += "✅ Aucune preuve";
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function adminApproveProof(chatId, msgId, data) {
  const [taskId, usrId] = data.split("_").map(Number);
  db.verifyTaskCompletion(taskId, usrId, true);
  bot.sendMessage(usrId, "✅ Ta preuve a été validée ! Récompense créditée.", { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText("✅ Preuve validée", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Preuves", callback_data: "admin_proofs" }]] } });
}

function adminRejectProof(chatId, msgId, data) {
  const [taskId, usrId] = data.split("_").map(Number);
  const completion = db.db.prepare("SELECT completion_id FROM task_completions WHERE task_id = ? AND user_id = ?").get(taskId, usrId);
  if (completion) db.rejectTaskCompletion(completion.completion_id);
  bot.sendMessage(usrId, "❌ Ta preuve a été rejetée.", { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText("❌ Preuve rejetée", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Preuves", callback_data: "admin_proofs" }]] } });
}

function showAdminWithdrawals(chatId, msgId) {
  const wds = db.getPendingWithdrawals();
  let text = `🏧 <b>Retraits en attente (${wds.length})</b>\n\n`;

  const buttons = [];
  wds.slice(0, 8).forEach(w => {
    text += `#${w.withdrawal_id} | ${esc(w.first_name)}\n${fmt(w.amount)} → ${fmt(w.net_amount)}\n<code>${esc(w.wallet_address)}</code>\n\n`;
    buttons.push([{ text: `✅ Payer #${w.withdrawal_id}`, callback_data: `adm_pay_wd_${w.withdrawal_id}` }, { text: `❌`, callback_data: `adm_reject_wd_${w.withdrawal_id}` }]);
  });

  if (wds.length === 0) text += "✅ Aucun retrait";
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function adminPayWithdrawal(chatId, msgId, wdId) {
  db.markWithdrawalPaid(wdId);
  const wd = db.db.prepare("SELECT * FROM withdrawals WHERE withdrawal_id = ?").get(wdId);
  if (wd) bot.sendMessage(wd.user_id, `✅ Ton retrait de <b>${fmt(wd.net_amount)}</b> a été envoyé !`, { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText(`✅ Retrait #${wdId} payé`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Retraits", callback_data: "admin_withdrawals" }]] } });
}

function adminRejectWithdrawal(chatId, msgId, wdId) {
  const wd = db.rejectWithdrawal(wdId);
  if (wd) bot.sendMessage(wd.user_id, `❌ Ton retrait a été rejeté. Montant remboursé.`, { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText(`❌ Retrait #${wdId} rejeté`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Retraits", callback_data: "admin_withdrawals" }]] } });
}

function showAdminDeposits(chatId, msgId) {
  const deps = db.getPendingDeposits();
  let text = `💳 <b>Dépôts en attente (${deps.length})</b>\n\n`;

  const buttons = [];
  deps.slice(0, 8).forEach(d => {
    text += `#${d.deposit_id} | ${esc(d.first_name)}\n${d.amount} ${d.method}\n\n`;
    buttons.push([{ text: `✅ #${d.deposit_id}`, callback_data: `adm_confirm_dep_${d.deposit_id}` }, { text: `❌`, callback_data: `adm_reject_dep_${d.deposit_id}` }]);
  });

  if (deps.length === 0) text += "✅ Aucun dépôt";
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function adminConfirmDeposit(chatId, msgId, depId) {
  const dep = db.confirmDeposit(depId);
  if (dep) bot.sendMessage(dep.user_id, `✅ Ton dépôt de <b>${fmt(dep.amount)}</b> est confirmé !`, { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText(`✅ Dépôt #${depId} confirmé`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Dépôts", callback_data: "admin_deposits" }]] } });
}

function adminRejectDeposit(chatId, msgId, depId) {
  db.rejectDeposit(depId);
  bot.editMessageText(`❌ Dépôt #${depId} rejeté`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Dépôts", callback_data: "admin_deposits" }]] } });
}

function showAdminUsers(chatId, msgId) {
  const users = db.getAllUsers({ limit: 20 });
  let text = `👥 <b>Utilisateurs (${db.getUserCount()})</b>\n\n`;

  users.forEach(u => {
    const s = u.is_banned ? "⛔" : "✅";
    text += `${s} ${esc(u.first_name)} | <code>${u.user_id}</code> | ${fmt(u.balance)}\n`;
  });

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
}

function showAdminGiveaways(chatId, msgId) {
  const giveaways = db.getActiveGiveaways();
  let text = `🏆 <b>Concours (${giveaways.length} actifs)</b>\n\n`;

  const buttons = [[{ text: "➕ Nouveau Concours", callback_data: "admin_new_giveaway" }]];

  giveaways.forEach(g => {
    text += `#${g.giveaway_id} — ${esc(g.title)}\n${fmt(g.prize_amount)} | ${g.current_participants} participants\n\n`;
    buttons.push([{ text: `🎲 Tirer #${g.giveaway_id}`, callback_data: `adm_draw_ga_${g.giveaway_id}` }]);
  });

  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

async function adminDrawGiveaway(chatId, msgId, giveawayId) {
  const result = db.drawGiveaway(giveawayId);
  const g = db.getGiveaway(giveawayId);

  if (result.cancelled) {
    return bot.editMessageText("⚠️ Concours annulé (aucun participant)", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
  }

  let text = `🎉 <b>Concours terminé !</b>\n\n${esc(g.title)}\n\n<b>Gagnants:</b>\n`;
  for (const winnerId of result.winners) {
    const w = db.getUser(winnerId);
    text += `🏆 ${esc(w.first_name)} — ${fmt(result.prizePerWinner)}\n`;
    bot.sendMessage(winnerId, `🎉 <b>Félicitations !</b>\n\nTu as gagné <b>${fmt(result.prizePerWinner)}</b> au concours "${esc(g.title)}" !`, { parse_mode: "HTML" }).catch(() => {});
  }

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "◀️ Admin", callback_data: "admin" }]] } });
}

function showAdminTickets(chatId, msgId) {
  const tickets = db.getOpenTickets();
  let text = `🎫 <b>Tickets ouverts (${tickets.length})</b>\n\n`;

  const buttons = [];
  tickets.slice(0, 8).forEach(t => {
    text += `#${t.ticket_id} | ${esc(t.first_name)}\n${esc(t.subject)}\n\n`;
    buttons.push([{ text: `💬 #${t.ticket_id}`, callback_data: `adm_ticket_${t.ticket_id}` }]);
  });

  if (tickets.length === 0) text += "✅ Aucun ticket ouvert";
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function adminViewTicket(chatId, msgId, ticketId) {
  const ticket = db.getTicket(ticketId);
  if (!ticket) return;

  const text = `
🎫 <b>Ticket #${ticketId}</b>

👤 ${esc(ticket.first_name)} (@${ticket.username || "N/A"})
📝 ${esc(ticket.subject)}

💬 ${esc(ticket.message)}

${ticket.admin_response ? `\n📩 Réponse:\n${esc(ticket.admin_response)}` : ""}`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💬 Répondre", callback_data: `adm_reply_ticket_${ticketId}` }, { text: "✖️ Fermer", callback_data: `adm_close_ticket_${ticketId}` }],
        [{ text: "◀️ Tickets", callback_data: "admin_tickets" }]
      ]
    }
  });
}

function adminCloseTicket(chatId, msgId, ticketId) {
  db.closeTicket(ticketId);
  const ticket = db.getTicket(ticketId);
  if (ticket) bot.sendMessage(ticket.user_id, `🎫 Ton ticket #${ticketId} a été fermé.`).catch(() => {});
  bot.editMessageText(`✅ Ticket #${ticketId} fermé`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: "◀️ Tickets", callback_data: "admin_tickets" }]] } });
}

function showAdminSettings(chatId, msgId) {
  const settings = [
    { key: "welcome_bonus", label: "🎁 Bonus bienvenue", value: db.getSetting("welcome_bonus", config.WELCOME_BONUS) },
    { key: "daily_bonus_min", label: "📅 Bonus quotidien min", value: db.getSetting("daily_bonus_min", config.DAILY_BONUS_MIN) },
    { key: "daily_bonus_max", label: "📅 Bonus quotidien max", value: db.getSetting("daily_bonus_max", config.DAILY_BONUS_MAX) },
    { key: "referral_bonus", label: "👥 Bonus parrainage", value: db.getSetting("referral_bonus", config.REFERRAL_BONUS) },
    { key: "referral_percent", label: "👥 Commission %", value: db.getSetting("referral_percent", config.REFERRAL_PERCENT) },
    { key: "min_withdrawal", label: "🏧 Min retrait", value: db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL) },
    { key: "withdrawal_fee_percent", label: "💸 Frais retrait %", value: db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT) },
    { key: "max_tasks_day", label: "📋 Max tâches/jour", value: db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY) },
    { key: "currency_symbol", label: "💱 Symbole devise", value: db.getSetting("currency_symbol", config.CURRENCY_SYMBOL) },
    { key: "maintenance_mode", label: "🔧 Maintenance", value: db.getSetting("maintenance_mode", false) },
  ];

  let text = `⚙️ <b>Paramètres</b>\n\n`;
  settings.forEach(s => {
    text += `${s.label}: <b>${s.value}</b>\n`;
  });

  const buttons = settings.map(s => [{ text: s.label, callback_data: `adm_set_${s.key}` }]);
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

function handleAdminSetting(chatId, msgId, userId, key) {
  const types = {
    welcome_bonus: "number", daily_bonus_min: "number", daily_bonus_max: "number",
    referral_bonus: "number", referral_percent: "number", min_withdrawal: "number",
    withdrawal_fee_percent: "number", max_tasks_day: "number",
    currency_symbol: "string", maintenance_mode: "boolean"
  };
  
  setState(userId, `setting_${key}`, { type: types[key] || "string" });
  bot.editMessageText(`⚙️ <b>${key}</b>\n\nEnvoie la nouvelle valeur:`, { chat_id: chatId, message_id: msgId, parse_mode: "HTML" });
}

// ============================================
// 🔄 VÉRIFICATION AUTOMATIQUE DES DÉPÔTS
// ============================================

// Vérification périodique des abonnements (1h)
setInterval(async () => {
  const completions = db.db.prepare(`
    SELECT tc.*, t.chat_id, t.type
    FROM task_completions tc
    JOIN tasks t ON tc.task_id = t.task_id
    WHERE tc.status = 'pending'
    AND tc.must_stay_until IS NOT NULL
    AND tc.must_stay_until <= CURRENT_TIMESTAMP
  `).all();

  for (const c of completions) {
    if ((c.type === "channel" || c.type === "group") && c.chat_id) {
      const isMember = await checkMembership(c.chat_id, c.user_id);
      if (!isMember) {
        db.db.prepare("UPDATE task_completions SET status = 'failed' WHERE completion_id = ?").run(c.completion_id);
        bot.sendMessage(c.user_id, "❌ Tu t'es désabonné trop tôt. Récompense annulée.").catch(() => {});
      }
    }
  }
}, 60 * 60 * 1000);

// ============================================
// 🚀 DÉMARRAGE
// ============================================

bot.on("polling_error", (e) => console.error("Polling error:", e.message));
process.on("uncaughtException", (e) => console.error("Uncaught:", e));
process.on("unhandledRejection", (e) => console.error("Unhandled:", e));

console.log("🤖 CryptoTaskBot démarré !");
console.log(`👑 Admins: ${config.ADMIN_IDS.join(", ")}`);
console.log("📡 En attente...\n");

// ============================================
// 🌐 KEEP-ALIVE SERVER (Railway / Render)
// ============================================
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("✅ CryptoTaskBot is running!");
}).listen(PORT, () => {
  console.log(`✅ Keep-alive server on port ${PORT}`);
});

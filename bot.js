// ============================================
// 🤖 ADCRYPTON BOT - VERSION PRO
// ============================================
// Jeux améliorés, commissions admin, menu restructuré
// Flash Tasks, Streak Bonus, Leaderboard hebdo
// Dépôts automatiques avec prix temps réel

const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");
const db = require("./database");
const payments = require("./payments");

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

const userStates = {};
let botInfo = null;

// ─────────────────────────────────────────────
//  UTILITAIRES
// ─────────────────────────────────────────────

function isAdmin(userId) { return config.ADMIN_IDS.includes(userId); }

function fmt(amount) {
  const symbol = db.getSetting("currency_symbol", config.CURRENCY_SYMBOL);
  return `${Number(amount).toFixed(2)}${symbol}`;
}

function esc(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d) {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function setState(userId, state, data = {}) {
  userStates[userId] = { state, data, ts: Date.now() };
}
function getState(userId) { return userStates[userId] || null; }
function clearState(userId) { delete userStates[userId]; }

// Nettoyer états > 30min
setInterval(() => {
  const now = Date.now();
  for (const uid in userStates) {
    if (now - userStates[uid].ts > 30 * 60 * 1000) delete userStates[uid];
  }
}, 30 * 60 * 1000);

function back(cb) {
  return { inline_keyboard: [[{ text: "◀️ Retour", callback_data: cb }]] };
}

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

// ─────────────────────────────────────────────
//  COMMISSION ADMIN — toutes les pertes jeux
// ─────────────────────────────────────────────

function creditAdminProfit(amount, source) {
  const adminId = config.ADMIN_IDS[0];
  if (!adminId || amount <= 0) return;
  db.updateBalance(adminId, amount, "admin_profit", `Commission ${source}: ${fmt(amount)}`);
}

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────

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
      const bonus = parseFloat(db.getSetting("referral_bonus", config.REFERRAL_BONUS));
      bot.sendMessage(referredBy,
        `🎉 <b>Nouveau filleul !</b>\n\n👤 ${esc(msg.from.first_name)} vient de rejoindre !\n💰 +${fmt(bonus)} crédité !`,
        { parse_mode: "HTML" }).catch(() => {});
    }
  } else {
    db.updateUser(userId, { username: msg.from.username || "", first_name: msg.from.first_name || "" });
  }

  if (user.is_banned) return bot.sendMessage(chatId, `⛔ Compte banni.\nRaison : ${user.ban_reason || "Non spécifiée"}`);

  clearState(userId);

  if (isNew) {
    const welcomeBonus = parseFloat(db.getSetting("welcome_bonus", config.WELCOME_BONUS));
    if (welcomeBonus > 0) {
      await bot.sendMessage(chatId,
        `🎉 <b>Bienvenue sur ADCRYPTON !</b>\n\n` +
        `💰 Bonus de bienvenue : <b>${fmt(welcomeBonus)}</b>\n\n` +
        `📋 Complète des tâches pour gagner de la crypto !\n` +
        `👥 Invite tes amis et gagne des commissions !`,
        { parse_mode: "HTML" });
    }
  }

  sendMainMenu(chatId, user);
});

// ─────────────────────────────────────────────
//  MENU PRINCIPAL — Dashboard intégré
// ─────────────────────────────────────────────

async function sendMainMenu(chatId, user, msgId = null) {
  if (!botInfo) botInfo = await bot.getMe();
  resetDailyTasks(user);
  user = db.getUser(user.user_id);

  const vip     = config.VIP_LEVELS[user.vip_level] || config.VIP_LEVELS[0];
  const botName = db.getSetting("bot_name", config.BOT_NAME);
  const maxTask = db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY);
  const streak  = user.streak_days || 0;
  const streakEmoji = streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "📅";

  // Jackpot progressif
  const jackpot = parseFloat(db.getSetting("jackpot_pool", "0"));

  const text =
`╔══════════════════════════╗
     💰 ${botName}
╚══════════════════════════╝

👋 Salut <b>${esc(user.first_name)}</b> !

💵 <b>Solde :</b> <b>${fmt(user.balance)}</b>
⭐ <b>Niveau :</b> ${user.level} (${user.xp} XP)
💎 <b>Statut :</b> ${vip.name}
${streakEmoji} <b>Streak :</b> ${streak} jour${streak > 1 ? "s" : ""}
🎰 <b>Jackpot :</b> ${fmt(jackpot)}

✅ Tâches : ${user.tasks_completed} | 👥 Filleuls : ${user.referral_count}
📅 Aujourd'hui : ${user.daily_tasks_done}/${maxTask}`;

  const kb = {
    inline_keyboard: [
      [
        { text: "📋 Tâches", callback_data: "tasks" },
        { text: "💰 Portefeuille", callback_data: "wallet" }
      ],
      [
        { text: "🎮 Jeux", callback_data: "games" },
        { text: "🏆 Concours", callback_data: "giveaways" }
      ],
      [
        { text: "➕ Promouvoir", callback_data: "create_task" },
        { text: "👥 Parrainage", callback_data: "referral" }
      ],
      [
        { text: "🎁 Bonus", callback_data: "daily_bonus" },
        { text: "💎 VIP", callback_data: "vip" }
      ],
      [
        { text: "📊 Classement", callback_data: "leaderboard" },
        { text: "🎫 Support", callback_data: "support" }
      ],
      [
        { text: "⚙️ Paramètres", callback_data: "settings" },
        { text: "📈 Stats", callback_data: "stats" }
      ],
    ]
  };

  if (isAdmin(user.user_id)) {
    kb.inline_keyboard.push([{ text: "👑 PANNEAU ADMIN", callback_data: "admin" }]);
  }

  const opts = { parse_mode: "HTML", reply_markup: kb };
  if (msgId) {
    bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => {});
  } else {
    bot.sendMessage(chatId, text, opts);
  }
}

// ─────────────────────────────────────────────
//  CALLBACKS PRINCIPAL
// ─────────────────────────────────────────────

bot.on("callback_query", async (q) => {
  const userId = q.from.id;
  const chatId = q.message.chat.id;
  const msgId  = q.message.message_id;
  const data   = q.data;

  const maint = checkMaintenance(userId);
  if (maint) return bot.answerCallbackQuery(q.id, { text: "🔧 Maintenance", show_alert: true });

  let user = db.getUser(userId);
  if (!user) user = db.createUser(userId, q.from.username, q.from.first_name, q.from.last_name);
  if (user.is_banned) return bot.answerCallbackQuery(q.id, { text: "⛔ Banni", show_alert: true });

  bot.answerCallbackQuery(q.id);

  // Navigation
  if (data === "main" || data === "back_main") { clearState(userId); return sendMainMenu(chatId, user, msgId); }

  // ═══════════════════════════════════════
  // 💰 PORTEFEUILLE
  // ═══════════════════════════════════════
  if (data === "wallet")   return showWallet(chatId, msgId, user);
  if (data === "deposit")  return showDeposit(chatId, msgId, user);
  if (data === "withdraw") return showWithdraw(chatId, msgId, user);
  if (data === "history")  return showHistory(chatId, msgId, user);

  if (data.startsWith("dep_method_")) {
    const method = data.replace("dep_method_", "");
    setState(userId, "deposit_amount", { method });
    const m = config.DEPOSIT_METHODS[method];
    return bot.editMessageText(
      `💳 <b>Dépôt ${m.name}</b>\n\nMontant minimum : <b>${m.minAmount} ${m.symbol}</b>\n\n` +
      `⚠️ Tu devras mettre ton ID (<code>${userId}</code>) dans le mémo.\n\nEnvoie le montant :`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("deposit") });
  }

  if (data.startsWith("wd_method_")) {
    const method = data.replace("wd_method_", "");
    setState(userId, "withdraw_method", { method });
    return bot.editMessageText(
      `🏧 <b>Retrait ${config.WITHDRAWAL_METHODS[method]?.name}</b>\n\nEnvoie ton adresse wallet :`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("withdraw") });
  }

  // ═══════════════════════════════════════
  // 📋 TÂCHES
  // ═══════════════════════════════════════
  if (data === "tasks")        return showTasks(chatId, msgId, user);
  if (data === "flash_tasks")  return showFlashTasks(chatId, msgId, user);
  if (data.startsWith("do_task_")) return doTask(chatId, msgId, userId, parseInt(data.replace("do_task_", "")), user);
  if (data.startsWith("verify_task_")) return verifyTask(chatId, msgId, userId, parseInt(data.replace("verify_task_", "")), user);

  // ═══════════════════════════════════════
  // 🎮 JEUX
  // ═══════════════════════════════════════
  if (data === "games")        return showGames(chatId, msgId, user);
  if (data === "spin_wheel")   return showSpinWheel(chatId, msgId, user);
  if (data === "spin_free")    return doSpin(chatId, msgId, userId, true, user);
  if (data === "spin_paid")    return doSpin(chatId, msgId, userId, false, user);
  if (data === "dice_game")    return showDice(chatId, msgId, user);
  if (data.startsWith("dice_bet_")) return playDice(chatId, msgId, userId, parseFloat(data.replace("dice_bet_", "")), user);
  if (data === "coinflip")        return showCoinflip(chatId, msgId, user);
  if (data === "cf_pile")         return playCoinflip(chatId, msgId, userId, "pile", user);
  if (data === "cf_face")         return playCoinflip(chatId, msgId, userId, "face", user);
  if (data.startsWith("cf_bet_")) {
    const bet = parseFloat(data.replace("cf_bet_", ""));
    setState(userId, "coinflip_bet", { bet });
    return showCoinflipChoice(chatId, msgId, bet, user);
  }
  if (data === "jackpot")         return showJackpot(chatId, msgId, user);
  if (data === "jackpot_play")    return playJackpot(chatId, msgId, userId, user);
  if (data === "guess_game")      return showGuess(chatId, msgId, user);
  if (data.startsWith("guess_"))  return playGuess(chatId, msgId, userId, parseInt(data.replace("guess_", "")), user);

  // ═══════════════════════════════════════
  // 🏆 CONCOURS
  // ═══════════════════════════════════════
  if (data === "giveaways")              return showGiveaways(chatId, msgId, userId);
  if (data.startsWith("join_ga_"))       return joinGiveaway(chatId, msgId, userId, parseInt(data.replace("join_ga_", "")));

  // ═══════════════════════════════════════
  // 👥 PARRAINAGE
  // ═══════════════════════════════════════
  if (data === "referral")     return showReferral(chatId, msgId, user);
  if (data === "leaderboard")  return showLeaderboard(chatId, msgId, user);

  // ═══════════════════════════════════════
  // 🎁 BONUS
  // ═══════════════════════════════════════
  if (data === "daily_bonus")  return claimDailyBonus(chatId, msgId, userId, user);

  // ═══════════════════════════════════════
  // 💎 VIP
  // ═══════════════════════════════════════
  if (data === "vip")               return showVip(chatId, msgId, user);
  if (data.startsWith("buy_vip_"))  return buyVip(chatId, msgId, userId, parseInt(data.replace("buy_vip_", "")), user);

  // ═══════════════════════════════════════
  // 📋 PROMOUVOIR
  // ═══════════════════════════════════════
  if (data === "create_task") return showCreateTask(chatId, msgId, user);
  if (data.startsWith("create_task_type_")) {
    const type = data.replace("create_task_type_", "");
    setState(userId, "ct_title", { type });
    return bot.editMessageText(
      `➕ <b>Nouvelle tâche ${type}</b>\n\nEnvoie le titre de ta campagne :`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("create_task") });
  }

  // ═══════════════════════════════════════
  // 📊 STATS
  // ═══════════════════════════════════════
  if (data === "stats")    return showStats(chatId, msgId, user);

  // ═══════════════════════════════════════
  // 🎫 SUPPORT
  // ═══════════════════════════════════════
  if (data === "support") return showSupport(chatId, msgId, user);
  if (data === "new_ticket") {
    setState(userId, "ticket_subject");
    return bot.editMessageText("🎫 Envoie le sujet de ton ticket :",
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("support") });
  }

  // ═══════════════════════════════════════
  // ⚙️ PARAMÈTRES
  // ═══════════════════════════════════════
  if (data === "settings") return showUserSettings(chatId, msgId, user);

  // ═══════════════════════════════════════
  // 👑 ADMIN
  // ═══════════════════════════════════════
  if (!isAdmin(userId)) return;

  if (data === "admin")                return showAdmin(chatId, msgId);
  if (data === "admin_stats")          return showAdminStats(chatId, msgId);
  if (data === "admin_tasks")          return showAdminTasks(chatId, msgId);
  if (data === "admin_proofs")         return showAdminProofs(chatId, msgId);
  if (data === "admin_withdrawals")    return showAdminWithdrawals(chatId, msgId);
  if (data === "admin_deposits")       return showAdminDeposits(chatId, msgId);
  if (data === "admin_users")          return showAdminUsers(chatId, msgId);
  if (data === "admin_giveaways")      return showAdminGiveaways(chatId, msgId);
  if (data === "admin_tickets")        return showAdminTickets(chatId, msgId);
  if (data === "admin_settings")       return showAdminSettings(chatId, msgId);
  if (data === "admin_games_settings") return showAdminGamesSettings(chatId, msgId);
  if (data === "admin_flash_tasks")    return showAdminFlashTasks(chatId, msgId);

  if (data === "admin_broadcast") {
    setState(userId, "broadcast");
    return bot.editMessageText("📢 <b>Broadcast</b>\n\nEnvoie le message :", {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("admin")
    });
  }
  if (data === "admin_add_balance") {
    setState(userId, "adm_balance_uid");
    return bot.editMessageText("💰 <b>Modifier solde</b>\n\nEnvoie l'ID Telegram :", {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("admin")
    });
  }
  if (data === "admin_ban") {
    setState(userId, "adm_ban_uid");
    return bot.editMessageText("⛔ <b>Bannir</b>\n\nEnvoie l'ID à bannir :", {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("admin")
    });
  }
  if (data === "admin_unban") {
    setState(userId, "adm_unban_uid");
    return bot.editMessageText("✅ <b>Débannir</b>\n\nEnvoie l'ID à débannir :", {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("admin")
    });
  }
  if (data === "admin_new_giveaway") {
    setState(userId, "ga_title");
    return bot.editMessageText("🏆 <b>Nouveau Concours</b>\n\nEnvoie le titre :", {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML"
    });
  }
  if (data === "admin_new_flash") {
    setState(userId, "flash_title");
    return bot.editMessageText("⚡ <b>Nouvelle Flash Task</b>\n\nEnvoie le titre :", {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("admin_flash_tasks")
    });
  }

  if (data.startsWith("adm_set_")) return handleAdminSetting(chatId, msgId, userId, data.replace("adm_set_", ""));
  if (data.startsWith("adm_approve_task_")) return adminApproveTask(chatId, msgId, parseInt(data.replace("adm_approve_task_", "")));
  if (data.startsWith("adm_reject_task_")) return adminRejectTask(chatId, msgId, parseInt(data.replace("adm_reject_task_", "")));
  if (data.startsWith("adm_approve_proof_")) return adminApproveProof(chatId, msgId, data.replace("adm_approve_proof_", ""));
  if (data.startsWith("adm_reject_proof_")) return adminRejectProof(chatId, msgId, data.replace("adm_reject_proof_", ""));
  if (data.startsWith("adm_pay_wd_")) return adminPayWithdrawal(chatId, msgId, parseInt(data.replace("adm_pay_wd_", "")));
  if (data.startsWith("adm_reject_wd_")) return adminRejectWithdrawal(chatId, msgId, parseInt(data.replace("adm_reject_wd_", "")));
  if (data.startsWith("adm_confirm_dep_")) return adminConfirmDeposit(chatId, msgId, parseInt(data.replace("adm_confirm_dep_", "")));
  if (data.startsWith("adm_reject_dep_")) return adminRejectDeposit(chatId, msgId, parseInt(data.replace("adm_reject_dep_", "")));
  if (data.startsWith("adm_draw_ga_")) return adminDrawGiveaway(chatId, msgId, parseInt(data.replace("adm_draw_ga_", "")));
  if (data.startsWith("adm_ticket_")) return adminViewTicket(chatId, msgId, parseInt(data.replace("adm_ticket_", "")));
  if (data.startsWith("adm_close_ticket_")) return adminCloseTicket(chatId, msgId, parseInt(data.replace("adm_close_ticket_", "")));
});

// ═══════════════════════════════════════════
//  💰 PORTEFEUILLE
// ═══════════════════════════════════════════

function showWallet(chatId, msgId, user) {
  const text =
`💰 <b>MON PORTEFEUILLE</b>

💵 Solde disponible : <b>${fmt(user.balance)}</b>
📥 Total déposé : <b>${fmt(user.total_deposited)}</b>
📤 Total retiré : <b>${fmt(user.total_withdrawn)}</b>
💰 Gains totaux : <b>${fmt(user.lifetime_earnings || 0)}</b>`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💳 Déposer", callback_data: "deposit" }, { text: "🏧 Retirer", callback_data: "withdraw" }],
        [{ text: "📋 Historique", callback_data: "history" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

function showDeposit(chatId, msgId, user) {
  const methods = config.DEPOSIT_METHODS;
  const buttons = [];

  for (const [key, m] of Object.entries(methods)) {
    if (m.enabled) {
      buttons.push([{ text: `${m.name} (min ${m.minAmount} ${m.symbol})`, callback_data: `dep_method_${key}` }]);
    }
  }
  buttons.push([{ text: "◀️ Retour", callback_data: "wallet" }]);

  bot.editMessageText(
    `💳 <b>DÉPOSER</b>\n\n⚡ Dépôt automatique — Prix temps réel\n📊 Conversion instantanée en USD\n\nChoisis ta crypto :`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

function showWithdraw(chatId, msgId, user) {
  const minW = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
  if (user.balance < minW) {
    return bot.editMessageText(
      `🏧 <b>RETRAIT</b>\n\n❌ Solde insuffisant.\n💵 Ton solde : ${fmt(user.balance)}\n📌 Minimum : ${fmt(minW)}`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("wallet") }
    );
  }

  const feeP = parseFloat(db.getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT));
  const methods = config.WITHDRAWAL_METHODS;
  const buttons = [];

  for (const [key, m] of Object.entries(methods)) {
    if (m.enabled) {
      buttons.push([{ text: m.name, callback_data: `wd_method_${key}` }]);
    }
  }
  buttons.push([{ text: "◀️ Retour", callback_data: "wallet" }]);

  bot.editMessageText(
    `🏧 <b>RETRAIT</b>\n\n💵 Solde : ${fmt(user.balance)}\n📌 Min : ${fmt(minW)}\n💸 Frais : ${feeP}%\n\nChoisis la méthode :`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

function showHistory(chatId, msgId, user) {
  const deps = db.getUserDeposits(user.user_id, 5);
  let text = `📋 <b>HISTORIQUE</b>\n\n`;
  text += `<b>Derniers dépôts :</b>\n`;
  if (deps.length === 0) { text += "Aucun dépôt.\n"; }
  else { deps.forEach(d => { text += `• ${d.amount}$ — ${d.status} — ${fmtDate(d.created_at)}\n`; }); }

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("wallet")
  });
}

// ═══════════════════════════════════════════
//  📋 TÂCHES
// ═══════════════════════════════════════════

function showTasks(chatId, msgId, user) {
  const maxTask = parseInt(db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY));
  const done    = user.daily_tasks_done || 0;

  // Tâches disponibles
  const tasks = db.getAvailableTasks(user.user_id, 8);
  const flash = db.db ? db.db.prepare(
    "SELECT * FROM tasks WHERE is_flash=1 AND flash_expires_at > CURRENT_TIMESTAMP AND status='active' LIMIT 3"
  ).all() : [];

  let text = `📋 <b>TÂCHES DISPONIBLES</b>\n\n`;
  text += `📅 Aujourd'hui : ${done}/${maxTask}\n\n`;

  if (flash.length > 0) {
    text += `⚡ <b>FLASH TASKS (bonus x2) !</b>\n`;
    flash.forEach(t => { text += `• ${esc(t.title)} — ${fmt(t.reward_per_completion * 2)}\n`; });
    text += "\n";
  }

  const buttons = [];
  if (flash.length > 0) {
    buttons.push([{ text: `⚡ Flash Tasks (${flash.length})`, callback_data: "flash_tasks" }]);
  }

  const types = [
    { key: "channel",   label: "📢 Canaux Telegram" },
    { key: "group",     label: "👥 Groupes Telegram" },
    { key: "bot",       label: "🤖 Bots Telegram" },
    { key: "youtube",   label: "📺 YouTube" },
    { key: "twitter",   label: "🐦 Twitter/X" },
    { key: "instagram", label: "📷 Instagram" },
    { key: "tiktok",    label: "🎵 TikTok" },
    { key: "website",   label: "🌐 Sites Web" },
    { key: "app",       label: "📱 Apps" },
  ];

  for (let i = 0; i < types.length; i += 2) {
    const row = [{ text: types[i].label, callback_data: `do_task_${types[i].key}` }];
    if (types[i + 1]) row.push({ text: types[i + 1].label, callback_data: `do_task_${types[i + 1].key}` });
    buttons.push(row);
  }

  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

async function doTask(chatId, msgId, userId, taskTypeOrId, user) {
  const maxTask = parseInt(db.getSetting("max_tasks_day", config.MAX_TASKS_PER_DAY));
  if ((user.daily_tasks_done || 0) >= maxTask) {
    return bot.editMessageText("❌ Limite quotidienne atteinte. Reviens demain !", {
      chat_id: chatId, message_id: msgId, reply_markup: back("tasks")
    });
  }

  // Chercher tâches par type
  const tasks = db.getAvailableTasks(userId, 5, String(taskTypeOrId));

  if (!tasks || tasks.length === 0) {
    return bot.editMessageText("📋 Aucune tâche disponible dans cette catégorie.\nReviens plus tard !", {
      chat_id: chatId, message_id: msgId, reply_markup: back("tasks")
    });
  }

  for (const task of tasks) {
    const reward = parseFloat(task.reward_per_completion);
    const buttons = [];

    if (task.url) buttons.push([{ text: "🔗 Ouvrir le lien", url: task.url }]);
    buttons.push([{ text: "✅ Valider ma participation", callback_data: `verify_task_${task.task_id}` }]);
    buttons.push([{ text: "◀️ Retour", callback_data: "tasks" }]);

    await bot.sendMessage(chatId,
      `📋 <b>${esc(task.title)}</b>\n\n` +
      `💰 Récompense : <b>${fmt(reward)}</b>\n` +
      `📝 ${esc(task.description || "")}\n\n` +
      `1️⃣ Clique le lien\n2️⃣ Effectue l'action\n3️⃣ Clique Valider`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
    );
  }
}

async function verifyTask(chatId, msgId, userId, taskId, user) {
  const task = db.db ? db.db.prepare("SELECT * FROM tasks WHERE task_id=?").get(taskId) : null;
  if (!task) return bot.sendMessage(chatId, "❌ Tâche introuvable.");

  // Vérifier membership si canal/groupe
  if ((task.type === "channel" || task.type === "group") && task.chat_id) {
    const isMember = await checkMembership(task.chat_id, userId);
    if (!isMember) {
      return bot.sendMessage(chatId,
        "❌ Tu n'as pas encore rejoint !\nRejoins d'abord puis valide.",
        { reply_markup: { inline_keyboard: [[{ text: "🔗 Rejoindre", url: task.url }]] } }
      );
    }
  }

  const result = db.completeTask(userId, taskId);
  if (!result) return bot.sendMessage(chatId, "❌ Erreur ou déjà complété.");

  const reward = parseFloat(task.reward_per_completion);
  db.updateUser(userId, { daily_tasks_done: (user.daily_tasks_done || 0) + 1 });

  bot.sendMessage(chatId,
    `✅ <b>Tâche validée !</b>\n\n💰 +${fmt(reward)} crédité !`,
    { parse_mode: "HTML" }
  );
}

function showFlashTasks(chatId, msgId, user) {
  const flash = db.db ? db.db.prepare(
    "SELECT * FROM tasks WHERE is_flash=1 AND flash_expires_at > CURRENT_TIMESTAMP AND status='active'"
  ).all() : [];

  if (flash.length === 0) {
    return bot.editMessageText("⚡ Aucune Flash Task active en ce moment.\nReviens plus tard !",
      { chat_id: chatId, message_id: msgId, reply_markup: back("tasks") });
  }

  const buttons = flash.map(t => [{
    text: `⚡ ${esc(t.title)} — ${fmt(t.reward_per_completion * 2)}`,
    callback_data: `verify_task_${t.task_id}`
  }]);
  buttons.push([{ text: "◀️ Tâches", callback_data: "tasks" }]);

  bot.editMessageText(
    `⚡ <b>FLASH TASKS</b>\n\n🔥 Récompense x2 !\n⏰ Durée limitée !\n\nChoisis ta tâche :`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

// ═══════════════════════════════════════════
//  🎮 JEUX — Améliorés avec commission admin
// ═══════════════════════════════════════════

function showGames(chatId, msgId, user) {
  const jackpot = parseFloat(db.getSetting("jackpot_pool", "0"));

  const text =
`🎮 <b>MINI-JEUX</b>

💵 Ton solde : <b>${fmt(user.balance)}</b>
🎟️ Spins gratuits : <b>${user.free_spins || 0}</b>
🏆 Jackpot actuel : <b>${fmt(jackpot)}</b>

⚠️ Joue responsable — les pertes alimentent le jackpot !`;

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎡 Roue de Fortune", callback_data: "spin_wheel" }],
        [{ text: "🎲 Dés", callback_data: "dice_game" }, { text: "🪙 Pile ou Face", callback_data: "coinflip" }],
        [{ text: `🏆 Jackpot (${fmt(jackpot)})`, callback_data: "jackpot" }],
        [{ text: "🔢 Devine le Nombre", callback_data: "guess_game" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]
    }
  });
}

// ─── ROUE DE FORTUNE ───────────────────────

function showSpinWheel(chatId, msgId, user) {
  const cost    = parseFloat(db.getSetting("spin_cost", config.SPIN_WHEEL.cost));
  const prizes  = config.SPIN_WHEEL.prizes;
  const freeSpins = user.free_spins || 0;

  const prizeList = prizes.map(p => `${p.label} — ${p.chance}%`).join("\n");

  const buttons = [];
  if (freeSpins > 0) {
    buttons.push([{ text: `🎟️ Spin Gratuit (${freeSpins} restant${freeSpins > 1 ? "s" : ""})`, callback_data: "spin_free" }]);
  }
  if (user.balance >= cost) {
    buttons.push([{ text: `🎡 Spin payant — ${fmt(cost)}`, callback_data: "spin_paid" }]);
  }
  buttons.push([{ text: "◀️ Jeux", callback_data: "games" }]);

  bot.editMessageText(
    `🎡 <b>ROUE DE FORTUNE</b>\n\n${prizeList}\n\n💵 Solde : ${fmt(user.balance)}\n🎟️ Spins gratuits : ${freeSpins}`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

async function doSpin(chatId, msgId, userId, free, user) {
  const cost = parseFloat(db.getSetting("spin_cost", config.SPIN_WHEEL.cost));

  if (free && (user.free_spins || 0) <= 0) {
    return bot.editMessageText("❌ Plus de spins gratuits !",
      { chat_id: chatId, message_id: msgId, reply_markup: back("spin_wheel") });
  }
  if (!free && user.balance < cost) {
    return bot.editMessageText(`❌ Solde insuffisant. Besoin : ${fmt(cost)}`,
      { chat_id: chatId, message_id: msgId, reply_markup: back("spin_wheel") });
  }

  const result = db.spinWheel(userId, free);
  if (!result || !result.prize) {
    return bot.editMessageText("❌ Erreur spin.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("spin_wheel") });
  }

  const prize = result.prize;
  const won   = prize.value || 0;

  // Commission admin sur perte (si spin payant et pas de gain)
  if (!free && won < cost) {
    creditAdminProfit(cost - won, "roue");
    // Alimenter jackpot 10% de la perte
    const jackpotShare = Math.round((cost - won) * 0.10 * 100) / 100;
    const currentJackpot = parseFloat(db.getSetting("jackpot_pool", "0"));
    db.updateSetting("jackpot_pool", String(Math.round((currentJackpot + jackpotShare) * 100) / 100));
  }

  const emoji = won > 0 ? "🎉" : "😢";
  const resultText = won > 0
    ? `${emoji} Tu gagnes <b>${fmt(won)}</b> !`
    : `${emoji} Pas de chance cette fois !`;

  // Animation roue
  const frames = ["🎡 Tourne...", "🎡 Tourne..", "🎡 Tourne.", "🎡 Arrêt..."];
  const msg = await bot.editMessageText(frames[0], { chat_id: chatId, message_id: msgId });

  for (let i = 1; i < frames.length; i++) {
    await new Promise(r => setTimeout(r, 600));
    await bot.editMessageText(frames[i], { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
  }

  await new Promise(r => setTimeout(r, 500));

  bot.editMessageText(
    `🎡 <b>RÉSULTAT</b>\n\n🎰 ${prize.label}\n\n${resultText}\n\n💵 Solde : ${fmt((db.getUser(userId) || user).balance)}`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "🔄 Rejouer", callback_data: "spin_wheel" }],
        [{ text: "◀️ Jeux", callback_data: "games" }]
      ]}
    }
  );
}

// ─── DÉS ───────────────────────────────────

function showDice(chatId, msgId, user) {
  const minBet = parseFloat(db.getSetting("dice_min_bet", config.DICE_GAME.min_bet));
  const maxBet = parseFloat(db.getSetting("dice_max_bet", config.DICE_GAME.max_bet));
  const mult   = parseFloat(db.getSetting("dice_multiplier", config.DICE_GAME.multiplier_win));

  const bets = [0.05, 0.10, 0.25, 0.50, 1.00, 2.00, 5.00].filter(b => b >= minBet && b <= maxBet && b <= user.balance);

  const buttons = [];
  for (let i = 0; i < bets.length; i += 3) {
    buttons.push(bets.slice(i, i + 3).map(b => ({ text: fmt(b), callback_data: `dice_bet_${b}` })));
  }
  buttons.push([{ text: "◀️ Jeux", callback_data: "games" }]);

  bot.editMessageText(
    `🎲 <b>JEU DE DÉS</b>\n\n🎯 Règle : Lance les dés.\nSi tu obtiens <b>4, 5 ou 6</b> → tu gagnes x${mult} !\nSinon → tu perds ta mise.\n\n💵 Solde : ${fmt(user.balance)}\n📌 Min : ${fmt(minBet)} | Max : ${fmt(maxBet)}\n\nChoisis ta mise :`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

async function playDice(chatId, msgId, userId, bet, user) {
  const mult = parseFloat(db.getSetting("dice_multiplier", config.DICE_GAME.multiplier_win));

  if (user.balance < bet) {
    return bot.editMessageText("❌ Solde insuffisant !",
      { chat_id: chatId, message_id: msgId, reply_markup: back("dice_game") });
  }

  db.updateBalance(userId, -bet, "dice_bet", `Dés: mise ${fmt(bet)}`);

  const diceMsg = await bot.sendDice(chatId, { emoji: "🎲" });
  const value   = diceMsg.dice.value;

  await new Promise(r => setTimeout(r, 3500));

  let win  = 0;
  let text = `🎲 Résultat : <b>${value}</b>\n\n`;

  if (value >= 4) {
    win = Math.round(bet * mult * 100) / 100;
    db.updateBalance(userId, win, "dice_win", `Dés: gain ${fmt(win)}`);
    text += `🎉 <b>Gagné !</b> +${fmt(win)} !`;
  } else {
    text += `😢 <b>Perdu !</b> −${fmt(bet)}`;
    // Commission admin sur perte
    creditAdminProfit(bet, "dés");
    // 10% au jackpot
    const jackShare = Math.round(bet * 0.10 * 100) / 100;
    const jp = parseFloat(db.getSetting("jackpot_pool", "0"));
    db.updateSetting("jackpot_pool", String(Math.round((jp + jackShare) * 100) / 100));
  }

  db.recordGame(userId, "dice", bet, win, `${value}`);
  const newUser = db.getUser(userId);

  bot.sendMessage(chatId, text + `\n\n💵 Solde : ${fmt(newUser.balance)}`, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [
      [{ text: "🔄 Rejouer", callback_data: "dice_game" }],
      [{ text: "◀️ Jeux", callback_data: "games" }]
    ]}
  });
}

// ─── PILE OU FACE ──────────────────────────

function showCoinflip(chatId, msgId, user) {
  const minBet = parseFloat(db.getSetting("coinflip_min_bet", config.COINFLIP.min_bet));
  const maxBet = parseFloat(db.getSetting("coinflip_max_bet", config.COINFLIP.max_bet));
  const mult   = parseFloat(db.getSetting("coinflip_multiplier", config.COINFLIP.multiplier_win));

  const bets = [0.05, 0.10, 0.25, 0.50, 1.00, 2.00, 5.00].filter(b => b >= minBet && b <= maxBet && b <= user.balance);
  const buttons = [];
  for (let i = 0; i < bets.length; i += 3) {
    buttons.push(bets.slice(i, i + 3).map(b => ({ text: fmt(b), callback_data: `cf_bet_${b}` })));
  }
  buttons.push([{ text: "◀️ Jeux", callback_data: "games" }]);

  bot.editMessageText(
    `🪙 <b>PILE OU FACE</b>\n\n🎯 Choisis ta mise, puis Pile ou Face.\nSi tu gagnes → x${mult} !\n\n💵 Solde : ${fmt(user.balance)}\n📌 Min : ${fmt(minBet)} | Max : ${fmt(maxBet)}\n\nChoisis ta mise :`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

function showCoinflipChoice(chatId, msgId, bet, user) {
  bot.editMessageText(
    `🪙 <b>PILE OU FACE</b>\n\n💵 Mise : <b>${fmt(bet)}</b>\n\nChoisis maintenant :`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🟡 PILE", callback_data: "cf_pile" }, { text: "⚫ FACE", callback_data: "cf_face" }],
          [{ text: "◀️ Retour", callback_data: "coinflip" }]
        ]
      }
    }
  );
}

async function playCoinflip(chatId, msgId, userId, choice, user) {
  const state = getState(userId);
  const bet   = state?.data?.bet;

  if (!bet || user.balance < bet) {
    return bot.editMessageText("❌ Erreur ou solde insuffisant.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("coinflip") });
  }

  const mult   = parseFloat(db.getSetting("coinflip_multiplier", config.COINFLIP.multiplier_win));
  const result = Math.random() > 0.5 ? "pile" : "face";
  const won    = result === choice;

  db.updateBalance(userId, -bet, "coinflip_bet", `Pile/Face: mise ${fmt(bet)}`);
  clearState(userId);

  // Animation
  await bot.editMessageText("🪙 La pièce tourne...",
    { chat_id: chatId, message_id: msgId }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  let win  = 0;
  let text = `🪙 <b>Résultat : ${result.toUpperCase()}</b>\n\n`;
  text += `Tu avais choisi : <b>${choice.toUpperCase()}</b>\n\n`;

  if (won) {
    win = Math.round(bet * mult * 100) / 100;
    db.updateBalance(userId, win, "coinflip_win", `Pile/Face: gain ${fmt(win)}`);
    text += `🎉 <b>Gagné !</b> +${fmt(win)} !`;
  } else {
    text += `😢 <b>Perdu !</b> −${fmt(bet)}`;
    creditAdminProfit(bet, "pile/face");
    const jackShare = Math.round(bet * 0.10 * 100) / 100;
    const jp = parseFloat(db.getSetting("jackpot_pool", "0"));
    db.updateSetting("jackpot_pool", String(Math.round((jp + jackShare) * 100) / 100));
  }

  db.recordGame(userId, "coinflip", bet, win, result);
  const newUser = db.getUser(userId);

  bot.editMessageText(text + `\n\n💵 Solde : ${fmt(newUser.balance)}`, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: [
      [{ text: "🔄 Rejouer", callback_data: "coinflip" }],
      [{ text: "◀️ Jeux", callback_data: "games" }]
    ]}
  });
}

// ─── JACKPOT PROGRESSIF ────────────────────

function showJackpot(chatId, msgId, user) {
  const jackpot = parseFloat(db.getSetting("jackpot_pool", "0"));
  const cost    = parseFloat(db.getSetting("jackpot_cost", "0.10"));
  const chance  = parseFloat(db.getSetting("jackpot_chance", "5"));

  bot.editMessageText(
    `🏆 <b>JACKPOT PROGRESSIF</b>\n\n` +
    `💰 Jackpot actuel : <b>${fmt(jackpot)}</b>\n` +
    `🎟️ Coût d'un ticket : <b>${fmt(cost)}</b>\n` +
    `🎯 Chance de gagner : <b>${chance}%</b>\n\n` +
    `💵 Ton solde : ${fmt(user.balance)}\n\n` +
    `Le jackpot grossit à chaque perte aux autres jeux !\nTente ta chance !`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        user.balance >= cost
          ? [{ text: `🎟️ Jouer — ${fmt(cost)}`, callback_data: "jackpot_play" }]
          : [{ text: "❌ Solde insuffisant", callback_data: "jackpot" }],
        [{ text: "◀️ Jeux", callback_data: "games" }]
      ]}
    }
  );
}

async function playJackpot(chatId, msgId, userId, user) {
  const jackpot = parseFloat(db.getSetting("jackpot_pool", "0"));
  const cost    = parseFloat(db.getSetting("jackpot_cost", "0.10"));
  const chance  = parseFloat(db.getSetting("jackpot_chance", "5"));

  if (user.balance < cost) {
    return bot.editMessageText("❌ Solde insuffisant !",
      { chat_id: chatId, message_id: msgId, reply_markup: back("jackpot") });
  }

  db.updateBalance(userId, -cost, "jackpot_bet", `Jackpot: ticket ${fmt(cost)}`);

  // 5% au jackpot depuis ce ticket
  const newJP = Math.round((jackpot + cost * 0.50) * 100) / 100;

  // Tirage
  const win = Math.random() * 100 < chance;

  await bot.editMessageText("🎰 Tirage en cours...",
    { chat_id: chatId, message_id: msgId }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  let text;
  if (win && jackpot > 0) {
    db.updateBalance(userId, jackpot, "jackpot_win", `Jackpot gagné: ${fmt(jackpot)}`);
    db.updateSetting("jackpot_pool", "0");
    text = `🎉🎉🎉 <b>JACKPOT !</b> 🎉🎉🎉\n\nTu as gagné <b>${fmt(jackpot)}</b> !\nFélicitations !`;
    // Notifier admins
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid, `🏆 Jackpot gagné par ${userId} : ${fmt(jackpot)}`).catch(() => {});
    }
  } else {
    db.updateSetting("jackpot_pool", String(newJP));
    text = `😢 <b>Pas de chance !</b>\n\nLe jackpot monte à <b>${fmt(newJP)}</b>\nRéessaie !`;
  }

  const newUser = db.getUser(userId);
  bot.editMessageText(text + `\n\n💵 Solde : ${fmt(newUser.balance)}`, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: [
      [{ text: "🔄 Rejouer", callback_data: "jackpot" }],
      [{ text: "◀️ Jeux", callback_data: "games" }]
    ]}
  });
}

// ─── DEVINE LE NOMBRE ──────────────────────

function showGuess(chatId, msgId, user) {
  const cost   = parseFloat(db.getSetting("guess_cost", config.GUESS_NUMBER.cost));
  const prize  = parseFloat(db.getSetting("guess_prize", config.GUESS_NUMBER.prize));
  const range  = config.GUESS_NUMBER.range;
  const tries  = config.GUESS_NUMBER.attempts;

  bot.editMessageText(
    `🔢 <b>DEVINE LE NOMBRE</b>\n\n` +
    `🎯 Devine un nombre entre <b>${range[0]}</b> et <b>${range[1]}</b>\n` +
    `🎟️ Coût : <b>${fmt(cost)}</b>\n` +
    `🏆 Gain si trouvé : <b>${fmt(prize)}</b>\n` +
    `🔄 Tentatives : <b>${tries}</b>\n\n` +
    `💵 Ton solde : ${fmt(user.balance)}`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          ...[...Array(range[1] - range[0] + 1)].map((_, i) => i + range[0])
            .reduce((rows, n, i) => {
              if (i % 5 === 0) rows.push([]);
              rows[rows.length - 1].push({ text: `${n}`, callback_data: `guess_${n}` });
              return rows;
            }, []),
          [{ text: "◀️ Jeux", callback_data: "games" }]
        ]
      }
    }
  );
}

async function playGuess(chatId, msgId, userId, guess, user) {
  const cost    = parseFloat(db.getSetting("guess_cost", config.GUESS_NUMBER.cost));
  const prize   = parseFloat(db.getSetting("guess_prize", config.GUESS_NUMBER.prize));
  const range   = config.GUESS_NUMBER.range;
  const secret  = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

  if (user.balance < cost) {
    return bot.editMessageText("❌ Solde insuffisant !",
      { chat_id: chatId, message_id: msgId, reply_markup: back("guess_game") });
  }

  db.updateBalance(userId, -cost, "guess_bet", `Devinette: mise ${fmt(cost)}`);

  let text;
  if (guess === secret) {
    db.updateBalance(userId, prize, "guess_win", `Devinette: gain ${fmt(prize)}`);
    text = `🎉 <b>Bravo !</b>\n\n✅ Le nombre était bien <b>${secret}</b> !\n💰 Tu gagnes <b>${fmt(prize)}</b> !`;
  } else {
    creditAdminProfit(cost, "devinette");
    text = `😢 <b>Raté !</b>\n\n❌ Tu as dit <b>${guess}</b>\nLe nombre était <b>${secret}</b>\nPerdu ${fmt(cost)}`;
  }

  const newUser = db.getUser(userId);
  bot.editMessageText(text + `\n\n💵 Solde : ${fmt(newUser.balance)}`, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: [
      [{ text: "🔄 Rejouer", callback_data: "guess_game" }],
      [{ text: "◀️ Jeux", callback_data: "games" }]
    ]}
  });
}

// ═══════════════════════════════════════════
//  🏆 CONCOURS
// ═══════════════════════════════════════════

function showGiveaways(chatId, msgId, userId) {
  const giveaways = db.getActiveGiveaways();
  let text = `🏆 <b>CONCOURS ACTIFS</b>\n\n`;

  if (giveaways.length === 0) {
    text += "Aucun concours actif. Reviens plus tard !";
  } else {
    giveaways.forEach(g => {
      text += `🎁 <b>${esc(g.title)}</b>\n`;
      text += `   💰 ${fmt(g.prize_amount)} | 👥 ${g.current_participants} participants\n`;
      text += `   ⏰ Fin: ${fmtDate(g.ends_at)}\n\n`;
    });
  }

  const buttons = giveaways.map(g => [{
    text: `🎟️ Participer — ${esc(g.title)}`,
    callback_data: `join_ga_${g.giveaway_id}`
  }]);
  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function joinGiveaway(chatId, msgId, userId, gaId) {
  const result = db.joinGiveaway(gaId, userId);
  if (!result) {
    return bot.editMessageText("❌ Impossible de participer (déjà inscrit ou concours terminé).",
      { chat_id: chatId, message_id: msgId, reply_markup: back("giveaways") });
  }
  bot.editMessageText(
    `✅ <b>Inscrit au concours !</b>\n\nBonne chance ! Le tirage aura lieu à la fin du concours.`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("giveaways") }
  );
}

// ═══════════════════════════════════════════
//  👥 PARRAINAGE + LEADERBOARD
// ═══════════════════════════════════════════

async function showReferral(chatId, msgId, user) {
  if (!botInfo) botInfo = await bot.getMe();
  const refBonus  = parseFloat(db.getSetting("referral_bonus", config.REFERRAL_BONUS));
  const refPercent = parseFloat(db.getSetting("referral_percent", config.REFERRAL_PERCENT));
  const link      = `https://t.me/${botInfo.username}?start=ref_${user.referral_code}`;

  bot.editMessageText(
    `👥 <b>PROGRAMME DE PARRAINAGE</b>\n\n` +
    `🔗 Ton lien :\n<code>${link}</code>\n\n` +
    `👥 Filleuls : <b>${user.referral_count}</b>\n` +
    `💰 Bonus par filleul : <b>${fmt(refBonus)}</b>\n` +
    `📊 Commission : <b>${refPercent}%</b> des gains de tes filleuls\n\n` +
    `💡 Partage ton lien et gagne de la crypto automatiquement !`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "🏆 Classement", callback_data: "leaderboard" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]}
    }
  );
}

function showLeaderboard(chatId, msgId, user) {
  const weekly = db.db ? db.db.prepare(
    "SELECT u.first_name, u.referral_count, u.tasks_completed, u.balance FROM users u ORDER BY u.referral_count DESC LIMIT 10"
  ).all() : [];

  const medals = ["🥇", "🥈", "🥉"];
  let text = `🏆 <b>CLASSEMENT HEBDOMADAIRE</b>\n\n`;
  text += `🔄 Reset tous les lundis — Le top 3 gagne des bonus !\n\n`;

  if (weekly.length === 0) { text += "Aucun utilisateur encore."; }
  else {
    weekly.forEach((u, i) => {
      const m = medals[i] || `${i + 1}.`;
      text += `${m} <b>${esc(u.first_name)}</b> — ${u.referral_count} filleuls\n`;
    });
  }

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: back("back_main")
  });
}

// ═══════════════════════════════════════════
//  🎁 BONUS QUOTIDIEN + STREAK
// ═══════════════════════════════════════════

function claimDailyBonus(chatId, msgId, userId, user) {
  const result = db.claimDailyBonus(userId);

  if (!result) {
    const next = new Date(user.last_bonus_at);
    next.setHours(next.getHours() + 24);
    return bot.editMessageText(
      `🎁 <b>BONUS QUOTIDIEN</b>\n\n⏰ Déjà réclamé !\nProchain bonus : <b>${fmtDate(next)}</b>`,
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("back_main") }
    );
  }

  // Calcul streak
  const streak = (user.streak_days || 0) + 1;
  const streakBonus = streak >= 7 ? parseFloat(db.getSetting("daily_bonus_max", config.DAILY_BONUS_MAX)) * 2
    : streak >= 3 ? parseFloat(db.getSetting("daily_bonus_max", config.DAILY_BONUS_MAX)) * 1.5
    : result.amount;

  db.updateUser(userId, { streak_days: streak });

  const streakEmoji = streak >= 7 ? "🔥🔥🔥" : streak >= 3 ? "⚡⚡" : "📅";

  bot.editMessageText(
    `🎁 <b>BONUS QUOTIDIEN RÉCLAMÉ !</b>\n\n` +
    `💰 Bonus : <b>+${fmt(result.amount)}</b>\n` +
    `${streakEmoji} Streak : <b>${streak} jour${streak > 1 ? "s" : ""}</b>\n` +
    `${streak >= 3 ? `🔥 Bonus streak : x${streak >= 7 ? "2" : "1.5"} !\n` : ""}` +
    `\n💵 Solde : ${fmt((db.getUser(userId) || user).balance)}\n\n` +
    `⏰ Reviens demain pour continuer ton streak !`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: back("back_main")
    }
  );
}

// ═══════════════════════════════════════════
//  💎 VIP
// ═══════════════════════════════════════════

function showVip(chatId, msgId, user) {
  const vipLevels = config.VIP_LEVELS;
  const current   = user.vip_level || 0;
  let text        = `💎 <b>SYSTÈME VIP</b>\n\n`;
  text += `Ton statut actuel : <b>${vipLevels[current].name}</b>\n\n`;

  Object.entries(vipLevels).forEach(([lvl, v]) => {
    text += `${parseInt(lvl) === current ? "✅" : "  "} ${v.name}`;
    if (v.price) text += ` — ${fmt(v.price)}`;
    text += `\n   +${v.bonus_percent}% bonus | ${v.max_tasks_day} tâches/jour\n`;
  });

  const buttons = Object.entries(vipLevels)
    .filter(([lvl, v]) => parseInt(lvl) > current && v.price)
    .map(([lvl, v]) => [{ text: `⬆️ ${v.name} — ${fmt(v.price)}`, callback_data: `buy_vip_${lvl}` }]);
  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function buyVip(chatId, msgId, userId, level, user) {
  const vip = config.VIP_LEVELS[level];
  if (!vip || !vip.price || user.balance < vip.price) {
    return bot.editMessageText("❌ Solde insuffisant ou niveau invalide.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("vip") });
  }

  db.updateBalance(userId, -vip.price, "vip_purchase", `Achat VIP ${vip.name}`);
  db.updateUser(userId, { vip_level: level });
  creditAdminProfit(vip.price, "VIP");

  bot.editMessageText(
    `💎 <b>VIP ACTIVÉ !</b>\n\n✅ Statut : <b>${vip.name}</b>\n+${vip.bonus_percent}% sur tous tes gains !\n${vip.max_tasks_day} tâches par jour !`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("back_main") }
  );
}

// ═══════════════════════════════════════════
//  📊 STATS USER
// ═══════════════════════════════════════════

function showStats(chatId, msgId, user) {
  const games = db.getUserGameHistory(user.user_id, 5);
  let text = `📊 <b>MES STATISTIQUES</b>\n\n`;
  text += `💵 Solde : ${fmt(user.balance)}\n`;
  text += `📥 Déposé : ${fmt(user.total_deposited)}\n`;
  text += `📤 Retiré : ${fmt(user.total_withdrawn)}\n`;
  text += `✅ Tâches : ${user.tasks_completed}\n`;
  text += `👥 Filleuls : ${user.referral_count}\n`;
  text += `⭐ Niveau : ${user.level} (${user.xp} XP)\n`;
  text += `🔥 Streak : ${user.streak_days || 0} jours\n`;
  text += `💎 VIP : ${config.VIP_LEVELS[user.vip_level]?.name}\n\n`;
  text += `<b>Dernières parties :</b>\n`;
  if (games.length === 0) { text += "Aucune partie."; }
  else {
    games.forEach(g => {
      const net = g.win_amount - g.bet_amount;
      const emoji = net >= 0 ? "✅" : "❌";
      text += `${emoji} ${g.game_type} — ${net >= 0 ? "+" : ""}${fmt(net)}\n`;
    });
  }

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("back_main")
  });
}

// ═══════════════════════════════════════════
//  🎫 SUPPORT
// ═══════════════════════════════════════════

function showSupport(chatId, msgId, user) {
  const supportUser = db.getSetting("support_username", config.SUPPORT_USERNAME);
  bot.editMessageText(
    `🎫 <b>SUPPORT</b>\n\n` +
    `${supportUser ? `📩 Contact direct : @${supportUser}\n\n` : ""}` +
    `Ou ouvre un ticket ici :`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "➕ Nouveau Ticket", callback_data: "new_ticket" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]}
    }
  );
}

// ═══════════════════════════════════════════
//  ⚙️ PARAMÈTRES USER
// ═══════════════════════════════════════════

function showUserSettings(chatId, msgId, user) {
  bot.editMessageText(
    `⚙️ <b>PARAMÈTRES</b>\n\n🌍 Langue : ${user.language === "fr" ? "🇫🇷 Français" : "🇬🇧 English"}`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "🇫🇷 Français", callback_data: "set_lang_fr" }, { text: "🇬🇧 English", callback_data: "set_lang_en" }],
        [{ text: "◀️ Menu", callback_data: "back_main" }]
      ]}
    }
  );
}

// ═══════════════════════════════════════════
//  ➕ CRÉER TÂCHE (Promouvoir)
// ═══════════════════════════════════════════

function showCreateTask(chatId, msgId, user) {
  const types = Object.entries(config.TASK_TYPES).filter(([, v]) => v.enabled);
  const buttons = types.map(([key, t]) => [{
    text: `${t.name} — min ${fmt(t.reward_min)}`,
    callback_data: `create_task_type_${key}`
  }]);
  buttons.push([{ text: "◀️ Menu", callback_data: "back_main" }]);

  bot.editMessageText(
    `➕ <b>CRÉER UNE CAMPAGNE</b>\n\n💵 Solde : ${fmt(user.balance)}\n\nChoisis le type de ta campagne :`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

// ═══════════════════════════════════════════
//  👑 ADMIN PANEL COMPLET
// ═══════════════════════════════════════════

function showAdmin(chatId, msgId) {
  const s = db.getStats();

  bot.editMessageText(
    `👑 <b>PANNEAU ADMIN</b>\n\n` +
    `👤 Users : ${s.users} (${s.activeUsers24h} actifs)\n` +
    `📋 Tâches : ${s.activeTasks} actives | ${s.pendingTasks} en attente\n` +
    `📸 Preuves : ${s.pendingProofs} en attente\n` +
    `🏧 Retraits : ${s.pendingWithdrawals} (${fmt(s.pendingWithdrawalsAmount || 0)})\n` +
    `💳 Dépôts : ${s.pendingDeposits} en attente\n` +
    `🎫 Tickets : ${s.openTickets} ouverts\n` +
    `🏆 Concours : ${s.activeGiveaways} actifs\n\n` +
    `💰 Déposé : ${fmt(s.totalDeposited)}\n` +
    `💸 Retiré : ${fmt(s.totalWithdrawn)}\n` +
    `📈 Profit : ${fmt(s.profit || 0)}\n` +
    `🎰 Jackpot : ${fmt(parseFloat(db.getSetting("jackpot_pool", "0")))}`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: `📋 Tâches (${s.pendingTasks})`, callback_data: "admin_tasks" }, { text: `📸 Preuves (${s.pendingProofs})`, callback_data: "admin_proofs" }],
          [{ text: `🏧 Retraits (${s.pendingWithdrawals})`, callback_data: "admin_withdrawals" }, { text: `💳 Dépôts (${s.pendingDeposits})`, callback_data: "admin_deposits" }],
          [{ text: "👥 Users", callback_data: "admin_users" }, { text: `🎫 Tickets (${s.openTickets})`, callback_data: "admin_tickets" }],
          [{ text: "🏆 Concours", callback_data: "admin_giveaways" }, { text: "📊 Stats", callback_data: "admin_stats" }],
          [{ text: "⚙️ Paramètres", callback_data: "admin_settings" }, { text: "🎮 Jeux Config", callback_data: "admin_games_settings" }],
          [{ text: "⚡ Flash Tasks", callback_data: "admin_flash_tasks" }, { text: "📢 Broadcast", callback_data: "admin_broadcast" }],
          [{ text: "💰 Modifier Solde", callback_data: "admin_add_balance" }],
          [{ text: "⛔ Bannir", callback_data: "admin_ban" }, { text: "✅ Débannir", callback_data: "admin_unban" }],
          [{ text: "◀️ Menu", callback_data: "back_main" }]
        ]
      }
    }
  );
}

function showAdminStats(chatId, msgId) {
  const s = db.getStats();
  bot.editMessageText(
    `📊 <b>STATISTIQUES COMPLÈTES</b>\n\n` +
    `👤 Total users : ${s.users}\n` +
    `👥 Actifs 24h : ${s.activeUsers24h}\n` +
    `👥 Actifs 7j : ${s.activeUsers7d}\n` +
    `⛔ Bannis : ${s.bannedUsers}\n` +
    `💎 VIP : ${s.vipUsers}\n\n` +
    `💰 En circulation : ${fmt(s.totalBalance || 0)}\n` +
    `💵 Déposé : ${fmt(s.totalDeposited)}\n` +
    `💸 Retiré : ${fmt(s.totalWithdrawn)}\n` +
    `🏦 Frais : ${fmt(s.totalFees || 0)}\n` +
    `📈 Profit : ${fmt(s.profit || 0)}\n` +
    `🎰 Jackpot pool : ${fmt(parseFloat(db.getSetting("jackpot_pool", "0")))}`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("admin") }
  );
}

// Admin Settings — tout modifiable
function showAdminSettings(chatId, msgId) {
  const settings = [
    { key: "welcome_bonus",         label: "🎁 Bonus bienvenue ($)" },
    { key: "daily_bonus_min",       label: "📅 Bonus quotidien min ($)" },
    { key: "daily_bonus_max",       label: "📅 Bonus quotidien max ($)" },
    { key: "referral_bonus",        label: "👥 Bonus parrainage ($)" },
    { key: "referral_percent",      label: "👥 Commission parrainage (%)" },
    { key: "min_withdrawal",        label: "🏧 Min retrait ($)" },
    { key: "max_withdrawal",        label: "🏧 Max retrait ($)" },
    { key: "withdrawal_fee_percent",label: "💸 Frais retrait (%)" },
    { key: "max_tasks_day",         label: "📋 Max tâches/jour" },
    { key: "maintenance_mode",      label: "🔧 Mode maintenance" },
    { key: "bot_name",              label: "🤖 Nom du bot" },
    { key: "support_username",      label: "🎫 Username support" },
  ];

  let text = `⚙️ <b>PARAMÈTRES DU BOT</b>\n\n`;
  settings.forEach(s => {
    const val = db.getSetting(s.key, "—");
    text += `${s.label} : <b>${val}</b>\n`;
  });

  const buttons = settings.map(s => [{ text: `✏️ ${s.label}`, callback_data: `adm_set_${s.key}` }]);
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

// Admin Games Settings
function showAdminGamesSettings(chatId, msgId) {
  const settings = [
    { key: "spin_cost",           label: "🎡 Coût spin ($)" },
    { key: "dice_min_bet",        label: "🎲 Dés mise min ($)" },
    { key: "dice_max_bet",        label: "🎲 Dés mise max ($)" },
    { key: "dice_multiplier",     label: "🎲 Dés multiplicateur (x)" },
    { key: "coinflip_min_bet",    label: "🪙 Pile/Face mise min ($)" },
    { key: "coinflip_max_bet",    label: "🪙 Pile/Face mise max ($)" },
    { key: "coinflip_multiplier", label: "🪙 Pile/Face multiplicateur (x)" },
    { key: "jackpot_cost",        label: "🏆 Jackpot coût ticket ($)" },
    { key: "jackpot_chance",      label: "🏆 Jackpot chance de gagner (%)" },
    { key: "jackpot_pool",        label: "🏆 Jackpot pool actuel ($)" },
    { key: "guess_cost",          label: "🔢 Devinette coût ($)" },
    { key: "guess_prize",         label: "🔢 Devinette gain ($)" },
  ];

  let text = `🎮 <b>CONFIG JEUX</b>\n\n`;
  settings.forEach(s => {
    text += `${s.label} : <b>${db.getSetting(s.key, "—")}</b>\n`;
  });

  const buttons = settings.map(s => [{ text: `✏️ ${s.label}`, callback_data: `adm_set_${s.key}` }]);
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);

  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function handleAdminSetting(chatId, msgId, userId, key) {
  const labels = {
    welcome_bonus: "Bonus bienvenue ($)",
    daily_bonus_min: "Bonus quotidien min ($)",
    daily_bonus_max: "Bonus quotidien max ($)",
    referral_bonus: "Bonus parrainage ($)",
    referral_percent: "Commission parrainage (%)",
    min_withdrawal: "Min retrait ($)",
    max_withdrawal: "Max retrait ($)",
    withdrawal_fee_percent: "Frais retrait (%)",
    max_tasks_day: "Max tâches/jour",
    spin_cost: "Coût spin ($)",
    dice_min_bet: "Dés mise min ($)",
    dice_max_bet: "Dés mise max ($)",
    dice_multiplier: "Dés multiplicateur",
    coinflip_min_bet: "Pile/Face mise min ($)",
    coinflip_max_bet: "Pile/Face mise max ($)",
    coinflip_multiplier: "Pile/Face multiplicateur",
    jackpot_cost: "Jackpot ticket ($)",
    jackpot_chance: "Jackpot chance (%)",
    jackpot_pool: "Jackpot pool ($)",
    guess_cost: "Devinette coût ($)",
    guess_prize: "Devinette gain ($)",
    maintenance_mode: "Maintenance (true/false)",
    bot_name: "Nom du bot",
    support_username: "Username support",
  };
  const current = db.getSetting(key, "—");
  setState(userId, `setting_${key}`, { key });
  bot.editMessageText(
    `⚙️ <b>${labels[key] || key}</b>\n\nValeur actuelle : <b>${current}</b>\n\nEnvoie la nouvelle valeur :`,
    { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: back("admin_settings") }
  );
}

// Admin Flash Tasks
function showAdminFlashTasks(chatId, msgId) {
  bot.editMessageText(
    `⚡ <b>FLASH TASKS</b>\n\nTâches spéciales à durée limitée avec récompense x2.\nActives pendant 30 minutes maximum.`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "➕ Créer Flash Task", callback_data: "admin_new_flash" }],
        [{ text: "◀️ Admin", callback_data: "admin" }]
      ]}
    }
  );
}

// Admin Tasks
function showAdminTasks(chatId, msgId) {
  const tasks = db.getPendingTasks();
  if (tasks.length === 0) {
    return bot.editMessageText("📋 Aucune tâche en attente.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("admin") });
  }
  let text = `📋 <b>TÂCHES EN ATTENTE (${tasks.length})</b>\n\n`;
  const buttons = [];
  tasks.slice(0, 5).forEach(t => {
    text += `#${t.task_id} ${esc(t.title)} — ${fmt(t.reward_per_completion)}\n`;
    buttons.push([
      { text: `✅ #${t.task_id}`, callback_data: `adm_approve_task_${t.task_id}` },
      { text: `❌ #${t.task_id}`, callback_data: `adm_reject_task_${t.task_id}` }
    ]);
  });
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);
  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function showAdminProofs(chatId, msgId) {
  const proofs = db.getPendingProofs ? db.getPendingProofs() : [];
  if (proofs.length === 0) {
    return bot.editMessageText("📸 Aucune preuve en attente.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("admin") });
  }
  let text = `📸 <b>PREUVES EN ATTENTE (${proofs.length})</b>\n\n`;
  const buttons = [];
  proofs.slice(0, 5).forEach(p => {
    text += `#${p.completion_id} User:${p.user_id}\n`;
    buttons.push([
      { text: `✅ #${p.completion_id}`, callback_data: `adm_approve_proof_${p.completion_id}` },
      { text: `❌ #${p.completion_id}`, callback_data: `adm_reject_proof_${p.completion_id}` }
    ]);
  });
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);
  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function showAdminWithdrawals(chatId, msgId) {
  const wds = db.getPendingWithdrawals();
  if (wds.length === 0) {
    return bot.editMessageText("🏧 Aucun retrait en attente.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("admin") });
  }
  let text = `🏧 <b>RETRAITS EN ATTENTE (${wds.length})</b>\n\n`;
  const buttons = [];
  wds.slice(0, 5).forEach(w => {
    text += `#${w.withdrawal_id} ${esc(w.first_name)} — ${fmt(w.net_amount)} → ${esc(w.wallet_address)}\n`;
    buttons.push([
      { text: `✅ Payer #${w.withdrawal_id}`, callback_data: `adm_pay_wd_${w.withdrawal_id}` },
      { text: `❌`, callback_data: `adm_reject_wd_${w.withdrawal_id}` }
    ]);
  });
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);
  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function showAdminDeposits(chatId, msgId) {
  const deps = db.getPendingDeposits ? db.getPendingDeposits() : [];
  if (deps.length === 0) {
    return bot.editMessageText("💳 Aucun dépôt en attente.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("admin") });
  }
  let text = `💳 <b>DÉPÔTS EN ATTENTE (${deps.length})</b>\n\n`;
  const buttons = [];
  deps.forEach(d => {
    text += `#${d.deposit_id} | ${esc(d.first_name)}\n${d.amount}$ | ${d.method}\n\n`;
    buttons.push([
      { text: `✅ #${d.deposit_id}`, callback_data: `adm_confirm_dep_${d.deposit_id}` },
      { text: `❌`, callback_data: `adm_reject_dep_${d.deposit_id}` }
    ]);
  });
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);
  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function showAdminUsers(chatId, msgId) {
  bot.editMessageText(
    "👥 <b>GESTION USERS</b>\n\nEnvoie l'ID d'un user pour le gérer :",
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "💰 Modifier Solde", callback_data: "admin_add_balance" }],
        [{ text: "⛔ Bannir", callback_data: "admin_ban" }, { text: "✅ Débannir", callback_data: "admin_unban" }],
        [{ text: "◀️ Admin", callback_data: "admin" }]
      ]}
    }
  );
}

function showAdminGiveaways(chatId, msgId) {
  const giveaways = db.getActiveGiveaways ? db.getActiveGiveaways() : [];
  let text = `🏆 <b>GESTION CONCOURS</b>\n\n`;
  if (giveaways.length === 0) { text += "Aucun concours actif."; }
  else {
    giveaways.forEach(g => {
      text += `#${g.giveaway_id} ${esc(g.title)} — ${fmt(g.prize_amount)} | ${g.current_participants} participants\n`;
    });
  }
  const buttons = [
    [{ text: "➕ Nouveau Concours", callback_data: "admin_new_giveaway" }],
    ...giveaways.map(g => [{ text: `🎲 Tirer #${g.giveaway_id}`, callback_data: `adm_draw_ga_${g.giveaway_id}` }]),
    [{ text: "◀️ Admin", callback_data: "admin" }]
  ];
  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function showAdminTickets(chatId, msgId) {
  const tickets = db.getOpenTickets ? db.getOpenTickets() : [];
  if (tickets.length === 0) {
    return bot.editMessageText("🎫 Aucun ticket ouvert.",
      { chat_id: chatId, message_id: msgId, reply_markup: back("admin") });
  }
  let text = `🎫 <b>TICKETS OUVERTS (${tickets.length})</b>\n\n`;
  const buttons = [];
  tickets.slice(0, 5).forEach(t => {
    text += `#${t.ticket_id} | ${esc(t.first_name)} : ${esc(t.subject)}\n`;
    buttons.push([{ text: `📖 Ticket #${t.ticket_id}`, callback_data: `adm_ticket_${t.ticket_id}` }]);
  });
  buttons.push([{ text: "◀️ Admin", callback_data: "admin" }]);
  bot.editMessageText(text, {
    chat_id: chatId, message_id: msgId, parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons }
  });
}

function adminViewTicket(chatId, msgId, ticketId) {
  const ticket = db.getTicket ? db.getTicket(ticketId) : null;
  if (!ticket) return;
  bot.editMessageText(
    `🎫 <b>Ticket #${ticketId}</b>\n👤 ${esc(ticket.first_name)}\n📝 ${esc(ticket.subject)}\n💬 ${esc(ticket.message)}`,
    {
      chat_id: chatId, message_id: msgId, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [
        [{ text: "💬 Répondre", callback_data: `adm_reply_ticket_${ticketId}` }],
        [{ text: "🔒 Fermer", callback_data: `adm_close_ticket_${ticketId}` }],
        [{ text: "◀️ Tickets", callback_data: "admin_tickets" }]
      ]}
    }
  );
}

function adminCloseTicket(chatId, msgId, ticketId) {
  if (db.closeTicket) {
    const ticket = db.closeTicket(ticketId);
    if (ticket) bot.sendMessage(ticket.user_id, `🎫 Ton ticket #${ticketId} a été fermé.`).catch(() => {});
  }
  bot.editMessageText("✅ Ticket fermé.", { chat_id: chatId, message_id: msgId, reply_markup: back("admin_tickets") });
}

// Admin actions
function adminApproveTask(chatId, msgId, taskId) {
  if (db.approveTask) {
    const task = db.approveTask(taskId);
    if (task) bot.sendMessage(task.creator_id, `✅ Ta tâche "<b>${esc(task.title)}</b>" est approuvée !`, { parse_mode: "HTML" }).catch(() => {});
  }
  bot.editMessageText(`✅ Tâche #${taskId} approuvée.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_tasks") });
}

function adminRejectTask(chatId, msgId, taskId) {
  if (db.rejectTask) {
    const task = db.rejectTask(taskId);
    if (task) bot.sendMessage(task.creator_id, `❌ Ta tâche "<b>${esc(task.title)}</b>" a été rejetée.`, { parse_mode: "HTML" }).catch(() => {});
  }
  bot.editMessageText(`❌ Tâche #${taskId} rejetée.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_tasks") });
}

function adminApproveProof(chatId, msgId, completionId) {
  if (db.approveProof) {
    const c = db.approveProof(completionId);
    if (c) bot.sendMessage(c.user_id, "✅ Ta preuve a été validée ! Récompense créditée.").catch(() => {});
  }
  bot.editMessageText(`✅ Preuve approuvée.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_proofs") });
}

function adminRejectProof(chatId, msgId, completionId) {
  if (db.rejectProof) {
    const c = db.rejectProof(completionId);
    if (c) bot.sendMessage(c.user_id, "❌ Ta preuve a été rejetée.").catch(() => {});
  }
  bot.editMessageText(`❌ Preuve rejetée.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_proofs") });
}

function adminPayWithdrawal(chatId, msgId, wdId) {
  if (db.payWithdrawal) {
    const wd = db.payWithdrawal(wdId);
    if (wd) bot.sendMessage(wd.user_id, `✅ Ton retrait de <b>${fmt(wd.net_amount)}</b> a été envoyé !`, { parse_mode: "HTML" }).catch(() => {});
  }
  bot.editMessageText(`✅ Retrait #${wdId} payé.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_withdrawals") });
}

function adminRejectWithdrawal(chatId, msgId, wdId) {
  if (db.rejectWithdrawal) {
    const wd = db.rejectWithdrawal(wdId);
    if (wd) bot.sendMessage(wd.user_id, `❌ Ton retrait a été rejeté. Montant remboursé.`).catch(() => {});
  }
  bot.editMessageText(`❌ Retrait #${wdId} rejeté.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_withdrawals") });
}

function adminConfirmDeposit(chatId, msgId, depId) {
  const dep = db.confirmDeposit ? db.confirmDeposit(depId, "", false) : null;
  if (dep) bot.sendMessage(dep.user_id, `✅ Ton dépôt de <b>${fmt(dep.amount)}</b> est confirmé !`, { parse_mode: "HTML" }).catch(() => {});
  bot.editMessageText(`✅ Dépôt #${depId} confirmé.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_deposits") });
}

function adminRejectDeposit(chatId, msgId, depId) {
  if (db.rejectDeposit) db.rejectDeposit(depId);
  bot.editMessageText(`❌ Dépôt #${depId} rejeté.`, { chat_id: chatId, message_id: msgId, reply_markup: back("admin_deposits") });
}

function adminDrawGiveaway(chatId, msgId, gaId) {
  const result = db.drawGiveaway ? db.drawGiveaway(gaId) : null;
  if (result && result.winners) {
    result.winners.forEach(w => {
      bot.sendMessage(w.user_id, `🎉 Tu as gagné <b>${fmt(result.prizePerWinner)}</b> au concours !`, { parse_mode: "HTML" }).catch(() => {});
    });
  }
  bot.editMessageText("🎲 Tirage effectué !", { chat_id: chatId, message_id: msgId, reply_markup: back("admin_giveaways") });
}

// ═══════════════════════════════════════════
//  💬 GESTION DES MESSAGES TEXTE
// ═══════════════════════════════════════════

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text   = msg.text.trim();
  const state  = getState(userId);

  if (!state) return;

  const s     = state.state;
  const data  = state.data || {};
  const user  = db.getUser(userId);

  // ──── DÉPÔT ────
  if (s === "deposit_amount") {
    const amount = parseFloat(text);
    const method = config.DEPOSIT_METHODS[data.method];
    if (!method || isNaN(amount) || amount < method.minAmount) {
      return bot.sendMessage(chatId, `❌ Minimum : ${method?.minAmount || 0} ${method?.symbol || ""}`);
    }
    const depId = db.createDeposit(userId, data.method, amount);
    clearState(userId);
    const depMsg = await payments.buildDepositMessage(data.method, amount, method.wallet, userId, depId);
    // Notifier admin
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `💳 <b>Nouveau dépôt #${depId}</b>\n👤 ${esc(user?.first_name)} (${userId})\n💰 ${amount} ${method.symbol}`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[
          { text: "✅ Confirmer", callback_data: `adm_confirm_dep_${depId}` },
          { text: "❌ Rejeter",   callback_data: `adm_reject_dep_${depId}` }
        ]]} }
      ).catch(() => {});
    }
    return bot.sendMessage(chatId, depMsg, {
      parse_mode: "HTML",
      reply_markup: back("wallet")
    });
  }

  // ──── RETRAIT — adresse ────
  if (s === "withdraw_method") {
    setState(userId, "withdraw_amount", { method: data.method, wallet: text });
    return bot.sendMessage(chatId, `🏧 Adresse enregistrée.\n\n💵 Ton solde : ${fmt(user.balance)}\n\nEnvoie le montant à retirer :`);
  }

  if (s === "withdraw_amount") {
    const amount = parseFloat(text);
    const minW   = parseFloat(db.getSetting("min_withdrawal", config.MIN_WITHDRAWAL));
    const maxW   = parseFloat(db.getSetting("max_withdrawal", config.MAX_WITHDRAWAL));
    if (isNaN(amount) || amount < minW || amount > maxW || amount > user.balance) {
      return bot.sendMessage(chatId, `❌ Montant invalide.\nMin: ${fmt(minW)} | Max: ${fmt(maxW)} | Solde: ${fmt(user.balance)}`);
    }
    const wd = db.createWithdrawal(userId, data.method, amount, data.wallet);
    if (!wd) return bot.sendMessage(chatId, "❌ Erreur création retrait.");
    clearState(userId);
    bot.sendMessage(chatId, `✅ Retrait #${wd.withdrawal_id} demandé !\n💵 ${fmt(wd.net_amount)} (après frais)\n⏳ Traitement sous 24h.`);
    for (const aid of config.ADMIN_IDS) {
      bot.sendMessage(aid,
        `🏧 <b>Retrait #${wd.withdrawal_id}</b>\n👤 ${esc(user?.first_name)} (${userId})\n💵 ${fmt(wd.net_amount)}\n👛 ${data.wallet}`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[
          { text: "✅ Payer", callback_data: `adm_pay_wd_${wd.withdrawal_id}` },
          { text: "❌ Rejeter", callback_data: `adm_reject_wd_${wd.withdrawal_id}` }
        ]]} }
      ).catch(() => {});
    }
    return;
  }

  // ──── BROADCAST ────
  if (s === "broadcast" && isAdmin(userId)) {
    const users = db.getAllUsers ? db.getAllUsers() : [];
    let sent = 0;
    for (const u of users) {
      try {
        await bot.sendMessage(u.user_id, `📢 <b>Annonce</b>\n\n${text}`, { parse_mode: "HTML" });
        sent++;
        await new Promise(r => setTimeout(r, 50));
      } catch { }
    }
    clearState(userId);
    return bot.sendMessage(chatId, `✅ Broadcast envoyé à ${sent} utilisateurs.`);
  }

  // ──── ADMIN BALANCE ────
  if (s === "adm_balance_uid" && isAdmin(userId)) {
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(chatId, "❌ ID invalide.");
    setState(userId, "adm_balance_amount", { uid: tid });
    return bot.sendMessage(chatId, `💰 Modifier solde de ${tid}\n\nEnvoie le montant (positif ou négatif) :`);
  }

  if (s === "adm_balance_amount" && isAdmin(userId)) {
    const amount = parseFloat(text);
    if (isNaN(amount)) return bot.sendMessage(chatId, "❌ Montant invalide.");
    db.updateBalance(data.uid, amount, "admin_edit", `Admin modif: ${fmt(amount)}`);
    const target = db.getUser(data.uid);
    bot.sendMessage(data.uid, `💰 Solde modifié par admin : <b>${amount > 0 ? "+" : ""}${fmt(amount)}</b>\nNouveau solde : ${fmt(target?.balance)}`, { parse_mode: "HTML" }).catch(() => {});
    clearState(userId);
    return bot.sendMessage(chatId, `✅ Solde de ${data.uid} modifié : ${amount > 0 ? "+" : ""}${fmt(amount)}`);
  }

  // ──── ADMIN BAN/UNBAN ────
  if (s === "adm_ban_uid" && isAdmin(userId)) {
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(chatId, "❌ ID invalide.");
    db.updateUser(tid, { is_banned: 1, ban_reason: "Admin ban" });
    bot.sendMessage(tid, "⛔ Ton compte a été banni.").catch(() => {});
    clearState(userId);
    return bot.sendMessage(chatId, `✅ User ${tid} banni.`);
  }

  if (s === "adm_unban_uid" && isAdmin(userId)) {
    const tid = parseInt(text);
    if (isNaN(tid)) return bot.sendMessage(chatId, "❌ ID invalide.");
    db.updateUser(tid, { is_banned: 0, ban_reason: "" });
    bot.sendMessage(tid, "✅ Ton compte a été débanni !").catch(() => {});
    clearState(userId);
    return bot.sendMessage(chatId, `✅ User ${tid} débanni.`);
  }

  // ──── ADMIN SETTINGS ────
  if (s.startsWith("setting_") && isAdmin(userId)) {
    const key = s.replace("setting_", "");
    db.updateSetting ? db.updateSetting(key, text) : db.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, text);
    clearState(userId);
    return bot.sendMessage(chatId, `✅ <b>${key}</b> = <b>${text}</b>`, { parse_mode: "HTML" });
  }

  // ──── GIVEAWAY CRÉATION ────
  if (s === "ga_title" && isAdmin(userId)) {
    setState(userId, "ga_prize", { title: text });
    return bot.sendMessage(chatId, "🏆 Envoie le montant du prix ($) :");
  }
  if (s === "ga_prize" && isAdmin(userId)) {
    const prize = parseFloat(text);
    if (isNaN(prize)) return bot.sendMessage(chatId, "❌ Montant invalide.");
    setState(userId, "ga_duration", { ...data, prize });
    return bot.sendMessage(chatId, "⏰ Durée en heures :");
  }
  if (s === "ga_duration" && isAdmin(userId)) {
    const hours = parseInt(text);
    if (isNaN(hours)) return bot.sendMessage(chatId, "❌ Durée invalide.");
    const ga = db.createGiveaway ? db.createGiveaway(data.title, data.prize, hours) : null;
    clearState(userId);
    return bot.sendMessage(chatId, `✅ Concours "${data.title}" créé ! Prix: ${fmt(data.prize)} | Durée: ${hours}h`);
  }

  // ──── FLASH TASK CRÉATION ────
  if (s === "flash_title" && isAdmin(userId)) {
    setState(userId, "flash_reward", { title: text });
    return bot.sendMessage(chatId, "⚡ Envoie la récompense ($) :");
  }
  if (s === "flash_reward" && isAdmin(userId)) {
    const reward = parseFloat(text);
    if (isNaN(reward)) return bot.sendMessage(chatId, "❌ Invalide.");
    setState(userId, "flash_url", { ...data, reward });
    return bot.sendMessage(chatId, "🔗 Envoie l'URL de la tâche :");
  }
  if (s === "flash_url" && isAdmin(userId)) {
    // Créer flash task dans DB (30min)
    if (db.db) {
      db.db.prepare(
        "INSERT INTO tasks (title, type, url, reward_per_completion, status, is_flash, flash_expires_at, creator_id, budget) VALUES (?,?,?,?,?,1,datetime('now','+30 minutes'),?,?)"
      ).run(data.title, "website", text, data.reward, "active", config.ADMIN_IDS[0], data.reward * 100);
    }
    clearState(userId);
    return bot.sendMessage(chatId, `✅ Flash Task créée ! "${data.title}" — ${fmt(data.reward)} x2 pendant 30 minutes.`);
  }

  // ──── TICKET ────
  if (s === "ticket_subject") {
    setState(userId, "ticket_message", { subject: text });
    return bot.sendMessage(chatId, "💬 Envoie ton message :");
  }
  if (s === "ticket_message") {
    if (db.createTicket) {
      const ticket = db.createTicket(userId, data.subject, text);
      clearState(userId);
      bot.sendMessage(chatId, `✅ Ticket #${ticket.ticket_id} créé ! On te répondra bientôt.`);
      for (const aid of config.ADMIN_IDS) {
        bot.sendMessage(aid,
          `🎫 <b>Nouveau ticket #${ticket.ticket_id}</b>\n👤 ${esc(user?.first_name)} (${userId})\n📝 ${esc(data.subject)}\n💬 ${esc(text)}`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: `📖 Voir #${ticket.ticket_id}`, callback_data: `adm_ticket_${ticket.ticket_id}` }]] } }
        ).catch(() => {});
      }
    } else {
      clearState(userId);
      bot.sendMessage(chatId, "✅ Message reçu ! On te contactera bientôt.");
    }
    return;
  }

  // ──── CRÉER TÂCHE ────
  if (s === "ct_title") {
    setState(userId, "ct_url", { ...data, title: text });
    return bot.sendMessage(chatId, "🔗 Envoie l'URL :");
  }
  if (s === "ct_url") {
    setState(userId, "ct_reward", { ...data, url: text });
    return bot.sendMessage(chatId, "💰 Récompense par complétion ($) :");
  }
  if (s === "ct_reward") {
    const reward = parseFloat(text);
    if (isNaN(reward) || reward < 0.01) return bot.sendMessage(chatId, "❌ Min 0.01$");
    setState(userId, "ct_budget", { ...data, reward });
    return bot.sendMessage(chatId, "💵 Budget total ($) :");
  }
  if (s === "ct_budget") {
    const budget = parseFloat(text);
    if (isNaN(budget) || user.balance < budget) {
      return bot.sendMessage(chatId, `❌ Solde insuffisant. Solde: ${fmt(user.balance)}`);
    }
    const task = db.createTask ? db.createTask(userId, data.type, data.title, data.url, data.reward, budget) : null;
    clearState(userId);
    if (task) {
      db.updateBalance(userId, -budget, "task_created", `Campagne: ${data.title}`);
      bot.sendMessage(chatId, `✅ Campagne soumise !\n"${data.title}"\nBudget: ${fmt(budget)} | Récompense: ${fmt(data.reward)}/complétion\n\nEn attente de validation.`);
      for (const aid of config.ADMIN_IDS) {
        bot.sendMessage(aid,
          `📋 <b>Nouvelle tâche à valider</b>\n👤 ${esc(user?.first_name)}\n📌 ${esc(data.title)}\n💰 ${fmt(data.reward)} | Budget: ${fmt(budget)}`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [[
            { text: `✅ Approuver #${task.task_id}`, callback_data: `adm_approve_task_${task.task_id}` },
            { text: `❌ Rejeter`, callback_data: `adm_reject_task_${task.task_id}` }
          ]]} }
        ).catch(() => {});
      }
    } else {
      bot.sendMessage(chatId, "❌ Erreur création campagne.");
    }
    return;
  }
});

// ═══════════════════════════════════════════
//  🔄 VÉRIFICATION AUTO DÉPÔTS
// ═══════════════════════════════════════════

payments.startAutoDepositChecker(db, config, async (deposit, usdAmount, tx) => {
  try {
    const user = db.getUser(deposit.user_id);
    if (!user) return;
    const symbols = { ton: "TON", bnb: "BNB", usdt_bep20: "USDT", usdt_ton: "USDT" };
    const symbol  = symbols[deposit.method] || "CRYPTO";
    await bot.sendMessage(deposit.user_id,
      `✅ <b>Dépôt confirmé automatiquement !</b>\n\n` +
      `💰 ${tx.amount} ${symbol} → <b>+${fmt(usdAmount)}</b>\n` +
      `🔗 TX : <code>${tx.txHash}</code>\n\n` +
      `💵 Nouveau solde : <b>${fmt((db.getUser(deposit.user_id) || user).balance)}</b>`,
      { parse_mode: "HTML" }
    );
  } catch (e) { console.error("Notif dépôt auto:", e.message); }
});

// ═══════════════════════════════════════════
//  ⏰ TÂCHES PÉRIODIQUES
// ═══════════════════════════════════════════

// Vérifier abonnements canaux (toutes les heures)
setInterval(async () => {
  try {
    if (!db.db) return;
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
  } catch (e) { console.error("Membership check:", e.message); }
}, 60 * 60 * 1000);

// Reset streak hebdo et récompense leaderboard (chaque lundi)
setInterval(async () => {
  const now = new Date();
  if (now.getDay() !== 1 || now.getHours() !== 0) return; // Lundi minuit

  try {
    if (!db.db) return;
    const top3 = db.db.prepare(
      "SELECT user_id, referral_count FROM users WHERE is_banned=0 ORDER BY referral_count DESC LIMIT 3"
    ).all();

    const prizes = [2.00, 1.00, 0.50];
    top3.forEach((u, i) => {
      db.updateBalance(u.user_id, prizes[i], "leaderboard_reward", `Top ${i + 1} hebdo`);
      bot.sendMessage(u.user_id,
        `🏆 <b>Top ${i + 1} du classement hebdo !</b>\n\n💰 +${fmt(prizes[i])} crédité !\nFélicitations !`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    });

    // Reset referral_count weekly (optionnel)
    console.log("✅ Leaderboard hebdo distribué");
  } catch (e) { console.error("Weekly leaderboard:", e.message); }
}, 60 * 60 * 1000);

// ═══════════════════════════════════════════
//  🌐 KEEP-ALIVE SERVER
// ═══════════════════════════════════════════

const http = require("http");
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("✅ ADCRYPTON Bot is running!");
}).listen(PORT, () => {
  console.log(`✅ Keep-alive server on port ${PORT}`);
});

// Erreurs globales
bot.on("polling_error", (e) => console.error("Polling error:", e.message));
process.on("uncaughtException",  (e) => console.error("Uncaught:", e));
process.on("unhandledRejection", (e) => console.error("Unhandled:", e));

console.log("🚀 ADCRYPTON Bot démarré !");

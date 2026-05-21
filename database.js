// ============================================
// 🗄️ BASE DE DONNÉES SQLite - VERSION COMPLÈTE
// ============================================

const Database = require("better-sqlite3");
const path = require("path");
const config = require("./config");

const db = new Database(path.join(__dirname, "cryptotaskbot.db"));
db.pragma("journal_mode = WAL");

// ============================================
// 📊 CRÉATION DES TABLES
// ============================================

db.exec(`
  -- ═══════════════════════════════════════════
  -- 👤 UTILISATEURS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language TEXT DEFAULT 'fr',
    balance REAL DEFAULT 0,
    total_earned REAL DEFAULT 0,
    total_withdrawn REAL DEFAULT 0,
    total_deposited REAL DEFAULT 0,
    total_spent REAL DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_created INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    vip_level INTEGER DEFAULT 0,
    vip_expires_at DATETIME,
    referral_code TEXT UNIQUE,
    referred_by INTEGER,
    referral_count INTEGER DEFAULT 0,
    referral_earnings REAL DEFAULT 0,
    daily_tasks_done INTEGER DEFAULT 0,
    daily_tasks_reset DATE,
    last_daily_bonus DATETIME,
    last_spin DATETIME,
    free_spins INTEGER DEFAULT 1,
    is_banned INTEGER DEFAULT 0,
    ban_reason TEXT,
    is_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ═══════════════════════════════════════════
  -- 📋 TÂCHES
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS tasks (
    task_id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    link TEXT NOT NULL,
    chat_id TEXT,
    proof_required INTEGER DEFAULT 0,
    proof_instructions TEXT,
    reward REAL NOT NULL,
    platform_fee REAL NOT NULL,
    max_completions INTEGER DEFAULT 100,
    current_completions INTEGER DEFAULT 0,
    budget REAL NOT NULL,
    budget_remaining REAL NOT NULL,
    countries TEXT,
    min_level INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    expires_at DATETIME,
    FOREIGN KEY (creator_id) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- ✅ COMPLÉTIONS DE TÂCHES
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS task_completions (
    completion_id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    reward REAL NOT NULL,
    proof_url TEXT,
    proof_message TEXT,
    admin_note TEXT,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,
    must_stay_until DATETIME,
    FOREIGN KEY (task_id) REFERENCES tasks(task_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    UNIQUE(task_id, user_id)
  );

  -- ═══════════════════════════════════════════
  -- 💳 DÉPÔTS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS deposits (
    deposit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    crypto_amount REAL,
    tx_hash TEXT,
    from_address TEXT,
    status TEXT DEFAULT 'pending',
    auto_detected INTEGER DEFAULT 0,
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- 🏧 RETRAITS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS withdrawals (
    withdrawal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    net_amount REAL NOT NULL,
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- 📜 TRANSACTIONS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS transactions (
    tx_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL,
    description TEXT,
    reference_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- 🏆 CONCOURS / GIVEAWAYS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS giveaways (
    giveaway_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    prize_amount REAL NOT NULL,
    prize_description TEXT,
    max_participants INTEGER,
    current_participants INTEGER DEFAULT 0,
    winner_count INTEGER DEFAULT 1,
    entry_type TEXT DEFAULT 'free',
    entry_cost REAL DEFAULT 0,
    requirements TEXT,
    status TEXT DEFAULT 'active',
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ends_at DATETIME NOT NULL,
    drawn_at DATETIME,
    FOREIGN KEY (created_by) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS giveaway_entries (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    giveaway_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    tickets INTEGER DEFAULT 1,
    is_winner INTEGER DEFAULT 0,
    prize_amount REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (giveaway_id) REFERENCES giveaways(giveaway_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    UNIQUE(giveaway_id, user_id)
  );

  -- ═══════════════════════════════════════════
  -- 🎰 HISTORIQUE DES JEUX
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS game_history (
    game_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_type TEXT NOT NULL,
    bet_amount REAL DEFAULT 0,
    win_amount REAL DEFAULT 0,
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- 💎 ACHATS VIP
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS vip_purchases (
    purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    vip_level INTEGER NOT NULL,
    amount REAL NOT NULL,
    duration_days INTEGER DEFAULT 30,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- 🎫 TICKETS SUPPORT
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS tickets (
    ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    admin_response TEXT,
    responded_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    closed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- 📢 BROADCASTS
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS broadcasts (
    broadcast_id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    image_url TEXT,
    button_text TEXT,
    button_url TEXT,
    target_audience TEXT DEFAULT 'all',
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,
    FOREIGN KEY (created_by) REFERENCES users(user_id)
  );

  -- ═══════════════════════════════════════════
  -- ⚙️ PARAMÈTRES
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT DEFAULT 'string',
    category TEXT DEFAULT 'general',
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ═══════════════════════════════════════════
  -- 📊 STATISTIQUES JOURNALIÈRES
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS daily_stats (
    date DATE PRIMARY KEY,
    new_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_created INTEGER DEFAULT 0,
    total_deposited REAL DEFAULT 0,
    total_withdrawn REAL DEFAULT 0,
    total_earned REAL DEFAULT 0,
    total_fees REAL DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    games_profit REAL DEFAULT 0
  );

  -- ═══════════════════════════════════════════
  -- 🚫 LISTE NOIRE
  -- ═══════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, value)
  );

  -- INDEX pour performances
  CREATE INDEX IF NOT EXISTS idx_users_referral ON users(referral_code);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
  CREATE INDEX IF NOT EXISTS idx_completions_status ON task_completions(status);
  CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
`);

// ============================================
// 👤 FONCTIONS UTILISATEURS
// ============================================

function getUser(userId) {
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
}

function createUser(userId, username, firstName, lastName, referredBy = null) {
  const referralCode = "REF" + userId.toString(36).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
  
  const welcomeBonus = parseFloat(getSetting("welcome_bonus", config.WELCOME_BONUS));
  
  db.prepare(`
    INSERT OR IGNORE INTO users (user_id, username, first_name, last_name, balance, referral_code, referred_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username || "", firstName || "", lastName || "", welcomeBonus, referralCode, referredBy);

  if (welcomeBonus > 0) {
    addTransaction(userId, "welcome_bonus", welcomeBonus, "Bonus de bienvenue");
  }

  if (referredBy) {
    const referrer = getUser(referredBy);
    if (referrer && !referrer.is_banned) {
      const refBonus = parseFloat(getSetting("referral_bonus", config.REFERRAL_BONUS));
      updateBalance(referredBy, refBonus, "referral_bonus", `Parrainage: ${firstName}`);
      db.prepare("UPDATE users SET referral_count = referral_count + 1 WHERE user_id = ?").run(referredBy);
      addXP(referredBy, config.XP_PER_REFERRAL);
    }
  }

  updateDailyStats("new_users", 1);
  return getUser(userId);
}

function updateUser(userId, data) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(", ");
  const values = Object.values(data);
  db.prepare(`UPDATE users SET ${fields}, last_active = CURRENT_TIMESTAMP WHERE user_id = ?`).run(...values, userId);
}

function updateBalance(userId, amount, type, description, referenceId = null) {
  const user = getUser(userId);
  if (!user) return false;

  const newBalance = Math.round((user.balance + amount) * 100) / 100;
  if (newBalance < 0) return false;

  db.prepare("UPDATE users SET balance = ?, last_active = CURRENT_TIMESTAMP WHERE user_id = ?").run(newBalance, userId);

  if (amount > 0 && type.includes("reward") || type.includes("task")) {
    db.prepare("UPDATE users SET total_earned = total_earned + ? WHERE user_id = ?").run(amount, userId);
  }

  addTransaction(userId, type, amount, description, referenceId);
  return true;
}

function addXP(userId, xp) {
  const user = getUser(userId);
  if (!user) return;

  const newXP = user.xp + xp;
  let newLevel = user.level;

  for (let i = config.LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (newXP >= config.LEVEL_THRESHOLDS[i]) {
      newLevel = i + 1;
      break;
    }
  }

  db.prepare("UPDATE users SET xp = ?, level = ? WHERE user_id = ?").run(newXP, newLevel, userId);

  // Bonus de niveau si level up
  if (newLevel > user.level && config.LEVEL_REWARDS[newLevel - 1]) {
    const reward = config.LEVEL_REWARDS[newLevel - 1];
    updateBalance(userId, reward, "level_up", `Niveau ${newLevel} atteint !`);
    return { leveledUp: true, newLevel, reward };
  }
  return { leveledUp: false };
}

function banUser(userId, banned = true, reason = "") {
  db.prepare("UPDATE users SET is_banned = ?, ban_reason = ? WHERE user_id = ?").run(banned ? 1 : 0, reason, userId);
}

function getAllUsers(filters = {}) {
  let query = "SELECT * FROM users WHERE 1=1";
  const params = [];

  if (filters.banned !== undefined) {
    query += " AND is_banned = ?";
    params.push(filters.banned ? 1 : 0);
  }
  if (filters.vip) {
    query += " AND vip_level > 0";
  }
  if (filters.minBalance) {
    query += " AND balance >= ?";
    params.push(filters.minBalance);
  }

  query += " ORDER BY created_at DESC";
  if (filters.limit) {
    query += " LIMIT ?";
    params.push(filters.limit);
  }

  return db.prepare(query).all(...params);
}

function getUserCount() {
  return db.prepare("SELECT COUNT(*) as count FROM users").get().count;
}

function getTopUsers(type = "earned", limit = 10) {
  const columns = {
    earned: "total_earned",
    balance: "balance",
    tasks: "tasks_completed",
    referrals: "referral_count",
    xp: "xp",
  };
  const col = columns[type] || "total_earned";
  return db.prepare(`SELECT * FROM users WHERE is_banned = 0 ORDER BY ${col} DESC LIMIT ?`).all(limit);
}

function getUserByReferralCode(code) {
  return db.prepare("SELECT * FROM users WHERE referral_code = ?").get(code);
}

// ============================================
// 📋 FONCTIONS TÂCHES
// ============================================

function createTask(data) {
  const taskType = config.TASK_TYPES[data.type];
  if (!taskType || !taskType.enabled) return null;

  const platformFee = taskType.platform_fee;
  const budget = (data.reward + platformFee) * data.maxCompletions;

  const user = getUser(data.creatorId);
  if (!user || user.balance < budget) return null;

  updateBalance(data.creatorId, -budget, "task_creation", `Création tâche: ${data.title}`);

  const result = db.prepare(`
    INSERT INTO tasks (creator_id, type, title, description, link, chat_id, proof_required, proof_instructions, reward, platform_fee, max_completions, budget, budget_remaining, countries, min_level, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.creatorId, data.type, data.title, data.description || "", data.link,
    data.chatId || null, data.proofRequired ? 1 : 0, data.proofInstructions || "",
    data.reward, platformFee, data.maxCompletions, budget, budget,
    data.countries || null, data.minLevel || 1, data.expiresAt || null
  );

  db.prepare("UPDATE users SET tasks_created = tasks_created + 1 WHERE user_id = ?").run(data.creatorId);
  updateDailyStats("tasks_created", 1);

  return result.lastInsertRowid;
}

function getTask(taskId) {
  return db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
}

function getActiveTasks(type = null, userId = null) {
  let query = `
    SELECT * FROM tasks 
    WHERE status = 'active' 
    AND budget_remaining > 0 
    AND current_completions < max_completions
    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `;
  const params = [];

  if (type) {
    query += " AND type = ?";
    params.push(type);
  }

  if (userId) {
    query += ` AND creator_id != ? AND task_id NOT IN (SELECT task_id FROM task_completions WHERE user_id = ?)`;
    params.push(userId, userId);
  }

  query += " ORDER BY priority DESC, created_at DESC";
  return db.prepare(query).all(...params);
}

function getPendingTasks() {
  return db.prepare("SELECT t.*, u.first_name, u.username FROM tasks t JOIN users u ON t.creator_id = u.user_id WHERE t.status = 'pending' ORDER BY t.created_at ASC").all();
}

function approveTask(taskId, adminNote = "") {
  db.prepare("UPDATE tasks SET status = 'active', admin_note = ?, approved_at = CURRENT_TIMESTAMP WHERE task_id = ?").run(adminNote, taskId);
}

function rejectTask(taskId, adminNote = "") {
  const task = getTask(taskId);
  if (task) {
    updateBalance(task.creator_id, task.budget, "task_refund", `Tâche rejetée: ${task.title}`);
    db.prepare("UPDATE tasks SET status = 'rejected', admin_note = ? WHERE task_id = ?").run(adminNote, taskId);
  }
}

function updateTaskStatus(taskId, status) {
  db.prepare("UPDATE tasks SET status = ? WHERE task_id = ?").run(status, taskId);
}

function getUserTasks(userId, status = null) {
  let query = "SELECT * FROM tasks WHERE creator_id = ?";
  const params = [userId];
  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  query += " ORDER BY created_at DESC";
  return db.prepare(query).all(...params);
}

// ============================================
// ✅ FONCTIONS COMPLÉTIONS
// ============================================

function startTaskCompletion(taskId, userId) {
  const task = getTask(taskId);
  if (!task || task.status !== "active") return null;

  const taskType = config.TASK_TYPES[task.type];
  let mustStayUntil = null;
  const now = new Date();

  if (taskType.min_stay_hours) {
    mustStayUntil = new Date(now.getTime() + taskType.min_stay_hours * 60 * 60 * 1000).toISOString();
  } else if (taskType.min_stay_seconds) {
    mustStayUntil = new Date(now.getTime() + taskType.min_stay_seconds * 1000).toISOString();
  }

  try {
    db.prepare(`
      INSERT INTO task_completions (task_id, user_id, reward, must_stay_until)
      VALUES (?, ?, ?, ?)
    `).run(taskId, userId, task.reward, mustStayUntil);
    return { mustStayUntil, reward: task.reward, proofRequired: task.proof_required };
  } catch (e) {
    return null;
  }
}

function submitTaskProof(taskId, userId, proofUrl, proofMessage) {
  db.prepare(`
    UPDATE task_completions 
    SET proof_url = ?, proof_message = ?, status = 'pending_review'
    WHERE task_id = ? AND user_id = ?
  `).run(proofUrl, proofMessage, taskId, userId);
}

function verifyTaskCompletion(taskId, userId, forceApprove = false) {
  const completion = db.prepare(
    "SELECT * FROM task_completions WHERE task_id = ? AND user_id = ? AND status IN ('pending', 'pending_review')"
  ).get(taskId, userId);

  if (!completion) return { success: false, reason: "not_found" };

  const task = getTask(taskId);
  if (!task) return { success: false, reason: "task_not_found" };

  // Vérifier la durée minimale (sauf si forceApprove par admin)
  if (!forceApprove && completion.must_stay_until) {
    const mustStay = new Date(completion.must_stay_until);
    if (new Date() < mustStay) {
      const remaining = Math.ceil((mustStay.getTime() - Date.now()) / 1000);
      return { success: false, reason: "too_early", remaining };
    }
  }

  // Appliquer bonus VIP
  const user = getUser(userId);
  let reward = completion.reward;
  if (user && user.vip_level > 0 && config.VIP_LEVELS[user.vip_level]) {
    const bonusPercent = config.VIP_LEVELS[user.vip_level].bonus_percent || 0;
    reward = Math.round((reward * (1 + bonusPercent / 100)) * 100) / 100;
  }

  // Marquer comme vérifié
  db.prepare("UPDATE task_completions SET status = 'verified', verified_at = CURRENT_TIMESTAMP WHERE completion_id = ?").run(completion.completion_id);
  db.prepare("UPDATE tasks SET current_completions = current_completions + 1, budget_remaining = budget_remaining - ? WHERE task_id = ?").run(completion.reward + task.platform_fee, taskId);
  db.prepare("UPDATE users SET tasks_completed = tasks_completed + 1, daily_tasks_done = daily_tasks_done + 1 WHERE user_id = ?").run(userId);

  // Créditer l'utilisateur
  updateBalance(userId, reward, "task_reward", `Tâche: ${task.title}`, taskId);
  addXP(userId, config.XP_PER_TASK);

  // Commission parrainage
  if (user && user.referred_by) {
    const refPercent = parseFloat(getSetting("referral_percent", config.REFERRAL_PERCENT));
    const refBonus = Math.round((completion.reward * refPercent / 100) * 100) / 100;
    if (refBonus > 0) {
      updateBalance(user.referred_by, refBonus, "referral_commission", `Commission: ${user.first_name}`);
      db.prepare("UPDATE users SET referral_earnings = referral_earnings + ? WHERE user_id = ?").run(refBonus, user.referred_by);
    }
  }

  // Vérifier si tâche terminée
  const updatedTask = getTask(taskId);
  if (updatedTask && updatedTask.current_completions >= updatedTask.max_completions) {
    updateTaskStatus(taskId, "completed");
  }

  updateDailyStats("tasks_completed", 1);
  updateDailyStats("total_earned", reward);

  return { success: true, reward };
}

function rejectTaskCompletion(completionId, adminNote = "") {
  db.prepare("UPDATE task_completions SET status = 'failed', admin_note = ? WHERE completion_id = ?").run(adminNote, completionId);
}

function getUserCompletions(userId, status = null) {
  let query = `
    SELECT tc.*, t.title, t.type, t.link
    FROM task_completions tc
    JOIN tasks t ON tc.task_id = t.task_id
    WHERE tc.user_id = ?
  `;
  const params = [userId];
  if (status) {
    query += " AND tc.status = ?";
    params.push(status);
  }
  query += " ORDER BY tc.completed_at DESC";
  return db.prepare(query).all(...params);
}

function getPendingProofs() {
  return db.prepare(`
    SELECT tc.*, t.title, t.type, t.proof_instructions, u.first_name, u.username
    FROM task_completions tc
    JOIN tasks t ON tc.task_id = t.task_id
    JOIN users u ON tc.user_id = u.user_id
    WHERE tc.status = 'pending_review'
    ORDER BY tc.completed_at ASC
  `).all();
}

// ============================================
// 💳 FONCTIONS DÉPÔTS
// ============================================

function createDeposit(userId, method, amount) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(
    "INSERT INTO deposits (user_id, method, amount, expires_at) VALUES (?, ?, ?, ?)"
  ).run(userId, method, amount, expiresAt);
  return result.lastInsertRowid;
}

function confirmDeposit(depositId, txHash = "", autoDetected = false) {
  const deposit = db.prepare("SELECT * FROM deposits WHERE deposit_id = ?").get(depositId);
  if (!deposit || deposit.status !== "pending") return false;

  db.prepare("UPDATE deposits SET status = 'confirmed', tx_hash = ?, auto_detected = ?, confirmed_at = CURRENT_TIMESTAMP WHERE deposit_id = ?").run(txHash, autoDetected ? 1 : 0, depositId);
  db.prepare("UPDATE users SET total_deposited = total_deposited + ? WHERE user_id = ?").run(deposit.amount, deposit.user_id);
  updateBalance(deposit.user_id, deposit.amount, "deposit", `Dépôt ${deposit.method}: ${deposit.amount}`, depositId);
  
  addXP(deposit.user_id, Math.floor(deposit.amount * config.XP_PER_DOLLAR_SPENT));
  updateDailyStats("total_deposited", deposit.amount);

  return deposit;
}

function rejectDeposit(depositId, adminNote = "") {
  db.prepare("UPDATE deposits SET status = 'failed', admin_note = ? WHERE deposit_id = ?").run(adminNote, depositId);
}

function getPendingDeposits() {
  return db.prepare(`
    SELECT d.*, u.first_name, u.username
    FROM deposits d
    JOIN users u ON d.user_id = u.user_id
    WHERE d.status = 'pending'
    ORDER BY d.created_at ASC
  `).all();
}

function getUserDeposits(userId, limit = 20) {
  return db.prepare("SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
}

function findDepositByTx(txHash) {
  return db.prepare("SELECT * FROM deposits WHERE tx_hash = ?").get(txHash);
}

// ============================================
// 🏧 FONCTIONS RETRAITS
// ============================================

function createWithdrawal(userId, method, amount, walletAddress) {
  const user = getUser(userId);
  if (!user || user.balance < amount) return null;

  let feePercent = parseFloat(getSetting("withdrawal_fee_percent", config.WITHDRAWAL_FEE_PERCENT));
  const feeFixed = parseFloat(getSetting("withdrawal_fee_fixed", config.WITHDRAWAL_FEE_FIXED));

  // Réduction VIP
  if (user.vip_level > 0 && config.VIP_LEVELS[user.vip_level]) {
    const discount = config.VIP_LEVELS[user.vip_level].withdrawal_fee_discount || 0;
    feePercent = feePercent * (1 - discount / 100);
  }

  const fee = Math.round((amount * feePercent / 100 + feeFixed) * 100) / 100;
  const netAmount = Math.round((amount - fee) * 100) / 100;

  const debited = updateBalance(userId, -amount, "withdrawal_pending", `Retrait ${method}: ${amount}`);
  if (!debited) return null;

  const result = db.prepare(
    "INSERT INTO withdrawals (user_id, method, amount, fee, net_amount, wallet_address) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, method, amount, fee, netAmount, walletAddress);

  return result.lastInsertRowid;
}

function approveWithdrawal(withdrawalId, txHash = "") {
  const wd = db.prepare("SELECT * FROM withdrawals WHERE withdrawal_id = ?").get(withdrawalId);
  if (!wd) return null;

  db.prepare("UPDATE withdrawals SET status = 'approved', tx_hash = ?, processed_at = CURRENT_TIMESTAMP WHERE withdrawal_id = ?").run(txHash, withdrawalId);
  db.prepare("UPDATE users SET total_withdrawn = total_withdrawn + ? WHERE user_id = ?").run(wd.amount, wd.user_id);
  
  updateDailyStats("total_withdrawn", wd.net_amount);
  updateDailyStats("total_fees", wd.fee);

  return wd;
}

function markWithdrawalPaid(withdrawalId, txHash = "") {
  db.prepare("UPDATE withdrawals SET status = 'paid', tx_hash = ?, processed_at = CURRENT_TIMESTAMP WHERE withdrawal_id = ?").run(txHash, withdrawalId);
}

function rejectWithdrawal(withdrawalId, adminNote = "") {
  const wd = db.prepare("SELECT * FROM withdrawals WHERE withdrawal_id = ?").get(withdrawalId);
  if (!wd || wd.status !== "pending") return false;

  updateBalance(wd.user_id, wd.amount, "withdrawal_refund", `Retrait rejeté - remboursé`);
  db.prepare("UPDATE withdrawals SET status = 'rejected', admin_note = ?, processed_at = CURRENT_TIMESTAMP WHERE withdrawal_id = ?").run(adminNote, withdrawalId);
  return wd;
}

function getPendingWithdrawals() {
  return db.prepare(`
    SELECT w.*, u.first_name, u.username
    FROM withdrawals w
    JOIN users u ON w.user_id = u.user_id
    WHERE w.status = 'pending'
    ORDER BY w.created_at ASC
  `).all();
}

function getUserWithdrawals(userId, limit = 20) {
  return db.prepare("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
}

// ============================================
// 📜 FONCTIONS TRANSACTIONS
// ============================================

function addTransaction(userId, type, amount, description, referenceId = null) {
  const user = getUser(userId);
  db.prepare(
    "INSERT INTO transactions (user_id, type, amount, balance_after, description, reference_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, type, amount, user ? user.balance : 0, description, referenceId);
}

function getUserTransactions(userId, limit = 30) {
  return db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
}

// ============================================
// 🏆 FONCTIONS CONCOURS
// ============================================

function createGiveaway(data) {
  const result = db.prepare(`
    INSERT INTO giveaways (title, description, prize_amount, prize_description, max_participants, winner_count, entry_type, entry_cost, requirements, ends_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.title, data.description || "", data.prizeAmount, data.prizeDescription || "",
    data.maxParticipants || null, data.winnerCount || 1, data.entryType || "free",
    data.entryCost || 0, JSON.stringify(data.requirements || {}), data.endsAt, data.createdBy
  );
  return result.lastInsertRowid;
}

function getGiveaway(giveawayId) {
  return db.prepare("SELECT * FROM giveaways WHERE giveaway_id = ?").get(giveawayId);
}

function getActiveGiveaways() {
  return db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at > CURRENT_TIMESTAMP ORDER BY ends_at ASC").all();
}

function enterGiveaway(giveawayId, userId, tickets = 1) {
  const giveaway = getGiveaway(giveawayId);
  if (!giveaway || giveaway.status !== "active") return { success: false, reason: "not_active" };
  if (new Date(giveaway.ends_at) < new Date()) return { success: false, reason: "ended" };
  if (giveaway.max_participants && giveaway.current_participants >= giveaway.max_participants) {
    return { success: false, reason: "full" };
  }

  // Vérifier si déjà inscrit
  const existing = db.prepare("SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?").get(giveawayId, userId);
  if (existing) return { success: false, reason: "already_entered" };

  // Payer si nécessaire
  if (giveaway.entry_type === "paid" && giveaway.entry_cost > 0) {
    const paid = updateBalance(userId, -giveaway.entry_cost * tickets, "giveaway_entry", `Participation concours: ${giveaway.title}`);
    if (!paid) return { success: false, reason: "insufficient_balance" };
  }

  db.prepare("INSERT INTO giveaway_entries (giveaway_id, user_id, tickets) VALUES (?, ?, ?)").run(giveawayId, userId, tickets);
  db.prepare("UPDATE giveaways SET current_participants = current_participants + 1 WHERE giveaway_id = ?").run(giveawayId);

  return { success: true };
}

function drawGiveaway(giveawayId) {
  const giveaway = getGiveaway(giveawayId);
  if (!giveaway || giveaway.status !== "active") return null;

  const entries = db.prepare("SELECT * FROM giveaway_entries WHERE giveaway_id = ?").all(giveawayId);
  if (entries.length === 0) {
    db.prepare("UPDATE giveaways SET status = 'cancelled' WHERE giveaway_id = ?").run(giveawayId);
    return { winners: [], cancelled: true };
  }

  // Créer pool de tickets
  const pool = [];
  entries.forEach(e => {
    for (let i = 0; i < e.tickets; i++) pool.push(e.user_id);
  });

  // Tirer les gagnants
  const winners = [];
  const prizePerWinner = giveaway.prize_amount / giveaway.winner_count;

  for (let i = 0; i < giveaway.winner_count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const winnerId = pool[idx];
    pool.splice(idx, 1);

    // Éviter doublons
    if (!winners.includes(winnerId)) {
      winners.push(winnerId);
      db.prepare("UPDATE giveaway_entries SET is_winner = 1, prize_amount = ? WHERE giveaway_id = ? AND user_id = ?").run(prizePerWinner, giveawayId, winnerId);
      updateBalance(winnerId, prizePerWinner, "giveaway_win", `Gagnant concours: ${giveaway.title}`, giveawayId);
    }
  }

  db.prepare("UPDATE giveaways SET status = 'ended', drawn_at = CURRENT_TIMESTAMP WHERE giveaway_id = ?").run(giveawayId);

  return { winners, prizePerWinner };
}

function getGiveawayEntries(giveawayId) {
  return db.prepare(`
    SELECT ge.*, u.first_name, u.username
    FROM giveaway_entries ge
    JOIN users u ON ge.user_id = u.user_id
    WHERE ge.giveaway_id = ?
  `).all(giveawayId);
}

// ============================================
// 🎰 FONCTIONS JEUX
// ============================================

function recordGame(userId, gameType, betAmount, winAmount, result) {
  db.prepare(
    "INSERT INTO game_history (user_id, game_type, bet_amount, win_amount, result) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, gameType, betAmount, winAmount, result);
  
  updateDailyStats("games_played", 1);
  updateDailyStats("games_profit", betAmount - winAmount);
}

function getUserGameHistory(userId, limit = 20) {
  return db.prepare("SELECT * FROM game_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
}

function claimDailyBonus(userId) {
  const user = getUser(userId);
  if (!user) return null;

  const now = new Date();
  const lastBonus = user.last_daily_bonus ? new Date(user.last_daily_bonus) : null;

  if (lastBonus && now.toDateString() === lastBonus.toDateString()) {
    return { success: false, reason: "already_claimed" };
  }

  const minBonus = parseFloat(getSetting("daily_bonus_min", config.DAILY_BONUS_MIN));
  const maxBonus = parseFloat(getSetting("daily_bonus_max", config.DAILY_BONUS_MAX));
  const bonus = Math.round((Math.random() * (maxBonus - minBonus) + minBonus) * 100) / 100;

  updateBalance(userId, bonus, "daily_bonus", "Bonus quotidien");
  db.prepare("UPDATE users SET last_daily_bonus = CURRENT_TIMESTAMP WHERE user_id = ?").run(userId);

  return { success: true, amount: bonus };
}

function spinWheel(userId, free = false) {
  const user = getUser(userId);
  if (!user) return null;

  const spinCost = parseFloat(getSetting("spin_cost", config.SPIN_WHEEL.cost));

  if (free) {
    if (user.free_spins <= 0) return { success: false, reason: "no_free_spins" };
    db.prepare("UPDATE users SET free_spins = free_spins - 1 WHERE user_id = ?").run(userId);
  } else {
    if (user.balance < spinCost) return { success: false, reason: "insufficient_balance" };
    updateBalance(userId, -spinCost, "spin_wheel", "Roue de la fortune");
  }

  // Déterminer le gain
  const prizes = config.SPIN_WHEEL.prizes;
  const totalChance = prizes.reduce((sum, p) => sum + p.chance, 0);
  let random = Math.random() * totalChance;
  let prize = prizes[prizes.length - 1];

  for (const p of prizes) {
    random -= p.chance;
    if (random <= 0) {
      prize = p;
      break;
    }
  }

  if (prize.value > 0) {
    updateBalance(userId, prize.value, "spin_win", `Roue: ${prize.label}`);
  }

  recordGame(userId, "spin_wheel", free ? 0 : spinCost, prize.value, prize.label);
  db.prepare("UPDATE users SET last_spin = CURRENT_TIMESTAMP WHERE user_id = ?").run(userId);

  return { success: true, prize };
}

// ============================================
// 💎 FONCTIONS VIP
// ============================================

function purchaseVIP(userId, level) {
  const user = getUser(userId);
  if (!user) return null;

  const vipLevel = config.VIP_LEVELS[level];
  if (!vipLevel || !vipLevel.price) return { success: false, reason: "invalid_level" };

  if (user.balance < vipLevel.price) return { success: false, reason: "insufficient_balance" };

  updateBalance(userId, -vipLevel.price, "vip_purchase", `VIP ${vipLevel.name}`);
  
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE users SET vip_level = ?, vip_expires_at = ?, total_spent = total_spent + ? WHERE user_id = ?").run(level, expiresAt, vipLevel.price, userId);
  
  db.prepare("INSERT INTO vip_purchases (user_id, vip_level, amount, expires_at) VALUES (?, ?, ?, ?)").run(userId, level, vipLevel.price, expiresAt);

  addXP(userId, vipLevel.price * config.XP_PER_DOLLAR_SPENT);

  return { success: true, level: vipLevel };
}

// ============================================
// 🎫 FONCTIONS TICKETS
// ============================================

function createTicket(userId, subject, message, category = "general") {
  const result = db.prepare(
    "INSERT INTO tickets (user_id, subject, message, category) VALUES (?, ?, ?, ?)"
  ).run(userId, subject, message, category);
  return result.lastInsertRowid;
}

function getTicket(ticketId) {
  return db.prepare(`
    SELECT t.*, u.first_name, u.username
    FROM tickets t
    JOIN users u ON t.user_id = u.user_id
    WHERE t.ticket_id = ?
  `).get(ticketId);
}

function getOpenTickets() {
  return db.prepare(`
    SELECT t.*, u.first_name, u.username
    FROM tickets t
    JOIN users u ON t.user_id = u.user_id
    WHERE t.status = 'open'
    ORDER BY t.created_at ASC
  `).all();
}

function getUserTickets(userId) {
  return db.prepare("SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC").all(userId);
}

function respondToTicket(ticketId, response, adminId) {
  db.prepare(`
    UPDATE tickets 
    SET admin_response = ?, responded_by = ?, status = 'answered', updated_at = CURRENT_TIMESTAMP 
    WHERE ticket_id = ?
  `).run(response, adminId, ticketId);
}

function closeTicket(ticketId) {
  db.prepare("UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE ticket_id = ?").run(ticketId);
}

// ============================================
// ⚙️ FONCTIONS PARAMÈTRES
// ============================================

function getSetting(key, defaultValue = null) {
  const row = db.prepare("SELECT value, type FROM settings WHERE key = ?").get(key);
  if (!row) return defaultValue;
  
  switch (row.type) {
    case "number": return parseFloat(row.value);
    case "boolean": return row.value === "true";
    case "json": return JSON.parse(row.value);
    default: return row.value;
  }
}

function setSetting(key, value, type = "string", category = "general", description = "") {
  const strValue = type === "json" ? JSON.stringify(value) : String(value);
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, type, category, description, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(key, strValue, type, category, description);
}

function getAllSettings(category = null) {
  if (category) {
    return db.prepare("SELECT * FROM settings WHERE category = ? ORDER BY key").all(category);
  }
  return db.prepare("SELECT * FROM settings ORDER BY category, key").all();
}

// ============================================
// 📊 FONCTIONS STATISTIQUES
// ============================================

function getStats() {
  const users = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  const activeUsers24h = db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active > datetime('now', '-24 hours')").get().c;
  const activeUsers7d = db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active > datetime('now', '-7 days')").get().c;
  const bannedUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_banned = 1").get().c;
  const vipUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE vip_level > 0").get().c;
  
  const tasks = db.prepare("SELECT COUNT(*) as c FROM tasks").get().c;
  const activeTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'active'").get().c;
  const pendingTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'").get().c;
  
  const completions = db.prepare("SELECT COUNT(*) as c FROM task_completions WHERE status = 'verified'").get().c;
  const pendingProofs = db.prepare("SELECT COUNT(*) as c FROM task_completions WHERE status = 'pending_review'").get().c;
  
  const totalEarned = db.prepare("SELECT COALESCE(SUM(total_earned), 0) as s FROM users").get().s;
  const totalDeposited = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM deposits WHERE status = 'confirmed'").get().s;
  const totalWithdrawn = db.prepare("SELECT COALESCE(SUM(net_amount), 0) as s FROM withdrawals WHERE status IN ('approved','paid')").get().s;
  const totalFees = db.prepare("SELECT COALESCE(SUM(fee), 0) as s FROM withdrawals WHERE status IN ('approved','paid')").get().s;
  const totalBalance = db.prepare("SELECT COALESCE(SUM(balance), 0) as s FROM users").get().s;
  
  const pendingWithdrawals = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'").get().c;
  const pendingWithdrawalsAmount = db.prepare("SELECT COALESCE(SUM(net_amount), 0) as s FROM withdrawals WHERE status = 'pending'").get().s;
  const pendingDeposits = db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'pending'").get().c;
  
  const openTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").get().c;
  const activeGiveaways = db.prepare("SELECT COUNT(*) as c FROM giveaways WHERE status = 'active'").get().c;

  return {
    users, activeUsers24h, activeUsers7d, bannedUsers, vipUsers,
    tasks, activeTasks, pendingTasks,
    completions, pendingProofs,
    totalEarned, totalDeposited, totalWithdrawn, totalFees, totalBalance,
    pendingWithdrawals, pendingWithdrawalsAmount, pendingDeposits,
    openTickets, activeGiveaways,
    profit: totalDeposited + totalFees - totalWithdrawn,
  };
}

function updateDailyStats(field, increment) {
  const today = new Date().toISOString().split("T")[0];
  db.prepare(`INSERT OR IGNORE INTO daily_stats (date) VALUES (?)`).run(today);
  db.prepare(`UPDATE daily_stats SET ${field} = ${field} + ? WHERE date = ?`).run(increment, today);
}

function getDailyStats(days = 7) {
  return db.prepare(`SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?`).all(days);
}

// ============================================
// 🚫 FONCTIONS BLACKLIST
// ============================================

function addToBlacklist(type, value, reason, createdBy) {
  try {
    db.prepare("INSERT INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)").run(type, value, reason, createdBy);
    return true;
  } catch (e) {
    return false;
  }
}

function removeFromBlacklist(type, value) {
  db.prepare("DELETE FROM blacklist WHERE type = ? AND value = ?").run(type, value);
}

function isBlacklisted(type, value) {
  return !!db.prepare("SELECT 1 FROM blacklist WHERE type = ? AND value = ?").get(type, value);
}

function getBlacklist() {
  return db.prepare("SELECT * FROM blacklist ORDER BY created_at DESC").all();
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  db,
  // Users
  getUser, createUser, updateUser, updateBalance, addXP, banUser,
  getAllUsers, getUserCount, getTopUsers, getUserByReferralCode,
  // Tasks
  createTask, getTask, getActiveTasks, getPendingTasks,
  approveTask, rejectTask, updateTaskStatus, getUserTasks,
  // Completions
  startTaskCompletion, submitTaskProof, verifyTaskCompletion,
  rejectTaskCompletion, getUserCompletions, getPendingProofs,
  // Deposits
  createDeposit, confirmDeposit, rejectDeposit, getPendingDeposits,
  getUserDeposits, findDepositByTx,
  // Withdrawals
  createWithdrawal, approveWithdrawal, markWithdrawalPaid, rejectWithdrawal,
  getPendingWithdrawals, getUserWithdrawals,
  // Transactions
  addTransaction, getUserTransactions,
  // Giveaways
  createGiveaway, getGiveaway, getActiveGiveaways, enterGiveaway,
  drawGiveaway, getGiveawayEntries,
  // Games
  recordGame, getUserGameHistory, claimDailyBonus, spinWheel,
  // VIP
  purchaseVIP,
  // Tickets
  createTicket, getTicket, getOpenTickets, getUserTickets,
  respondToTicket, closeTicket,
  // Settings
  getSetting, setSetting, getAllSettings,
  // Stats
  getStats, updateDailyStats, getDailyStats,
  // Blacklist
  addToBlacklist, removeFromBlacklist, isBlacklisted, getBlacklist,
};

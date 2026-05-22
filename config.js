// ============================================
// ⚙️ CONFIGURATION — ADCRYPTON BOT
// ============================================
// Toutes les valeurs sensibles viennent des variables Railway.
// Configure-les dans Railway → Variables.

module.exports = {

  // ═══════════════════════════════════════════
  // 🔑 IDENTIFIANTS
  // ═══════════════════════════════════════════
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  ADMIN_IDS: process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(",").map(Number)
    : [6339278677],

  // ═══════════════════════════════════════════
  // 💰 DEVISE
  // ═══════════════════════════════════════════
  CURRENCY_NAME:   "USD",
  CURRENCY_SYMBOL: "$",
  DECIMALS:        2,

  // ═══════════════════════════════════════════
  // 🎁 BONUS & RÉCOMPENSES
  // ═══════════════════════════════════════════
  WELCOME_BONUS:     0,      // Désactivé
  DAILY_BONUS_MIN:   0.01,
  DAILY_BONUS_MAX:   0.05,
  REFERRAL_BONUS:    0.10,
  REFERRAL_PERCENT:  5,

  // ═══════════════════════════════════════════
  // 💳 DÉPÔTS
  // Cryptos : TON, USDT (TON), USDT (BEP20), BNB
  // ═══════════════════════════════════════════
  MIN_DEPOSIT: 0.50,

  DEPOSIT_METHODS: {

    ton: {
      enabled:        true,
      name:           "TON",
      symbol:         "TON",
      network:        "TON",
      wallet:         process.env.WALLET_TON || "",
      minAmount:      0.5,
      confirmations:  1,
      apiUrl:         "https://tonapi.io/v2",
    },

    usdt_ton: {
      enabled:        true,
      name:           "USDT (Réseau TON)",
      symbol:         "USDT",
      network:        "TON",
      wallet:         process.env.WALLET_TON || "",
      minAmount:      1,
      confirmations:  1,
      apiUrl:         "https://tonapi.io/v2",
    },

    usdt_bep20: {
      enabled:        true,
      name:           "USDT (Réseau BNB)",
      symbol:         "USDT",
      network:        "BEP20",
      wallet:         process.env.WALLET_BEP20 || "",
      minAmount:      1,
      confirmations:  3,
      apiUrl:         "https://api.bscscan.com/api",
    },

    bnb: {
      enabled:        true,
      name:           "BNB",
      symbol:         "BNB",
      network:        "BEP20",
      wallet:         process.env.WALLET_BEP20 || "",
      minAmount:      0.005,
      confirmations:  3,
      apiUrl:         "https://api.bscscan.com/api",
    },

  },

  // ═══════════════════════════════════════════
  // 🏧 RETRAITS
  // ═══════════════════════════════════════════
  MIN_WITHDRAWAL:          5.00,
  MAX_WITHDRAWAL:          500.00,
  WITHDRAWAL_FEE_PERCENT:  5,
  WITHDRAWAL_FEE_FIXED:    0,

  WITHDRAWAL_METHODS: {
    ton:       { enabled: true,  name: "TON",               minAmount: 1  },
    usdt_ton:  { enabled: true,  name: "USDT (Réseau TON)", minAmount: 5  },
    usdt_bep20:{ enabled: true,  name: "USDT (Réseau BNB)", minAmount: 5  },
    bnb:       { enabled: true,  name: "BNB",               minAmount: 0.01 },
  },

  // ═══════════════════════════════════════════
  // 📋 TYPES DE TÂCHES
  // ═══════════════════════════════════════════
  TASK_TYPES: {
    channel: {
      enabled:          true,
      name:             "📢 Canal Telegram",
      reward_min:       0.02,
      reward_max:       0.20,
      reward_default:   0.05,
      platform_fee:     0.01,
      min_stay_hours:   24,
    },
    group: {
      enabled:          true,
      name:             "👥 Groupe Telegram",
      reward_min:       0.02,
      reward_max:       0.20,
      reward_default:   0.05,
      platform_fee:     0.01,
      min_stay_hours:   24,
    },
    bot: {
      enabled:          true,
      name:             "🤖 Bot Telegram",
      reward_min:       0.01,
      reward_max:       0.10,
      reward_default:   0.03,
      platform_fee:     0.01,
      min_stay_seconds: 30,
    },
    youtube: {
      enabled:          false,
      name:             "📺 YouTube",
      reward_min:       0.05,
      reward_max:       0.50,
      reward_default:   0.10,
      platform_fee:     0.02,
    },
    twitter: {
      enabled:          false,
      name:             "🐦 Twitter / X",
      reward_min:       0.03,
      reward_max:       0.30,
      reward_default:   0.08,
      platform_fee:     0.01,
    },
    instagram: {
      enabled:          false,
      name:             "📷 Instagram",
      reward_min:       0.03,
      reward_max:       0.30,
      reward_default:   0.08,
      platform_fee:     0.01,
    },
    tiktok: {
      enabled:          false,
      name:             "🎵 TikTok",
      reward_min:       0.03,
      reward_max:       0.30,
      reward_default:   0.08,
      platform_fee:     0.01,
    },
    website: {
      enabled:          false,
      name:             "🌐 Site Web",
      reward_min:       0.02,
      reward_max:       0.20,
      reward_default:   0.05,
      platform_fee:     0.01,
    },
    app: {
      enabled:          false,
      name:             "📱 Application",
      reward_min:       0.10,
      reward_max:       1.00,
      reward_default:   0.30,
      platform_fee:     0.05,
    },
  },

  // ═══════════════════════════════════════════
  // 🎰 MINI-JEUX
  // ═══════════════════════════════════════════
  GAMES_ENABLED: true,

  SPIN_WHEEL: {
    enabled:          true,
    cost:             0.05,
    daily_free_spins: 1,
    prizes: [
      { label: "💰 0.01$",  value: 0.01,  chance: 30   },
      { label: "💰 0.02$",  value: 0.02,  chance: 25   },
      { label: "💰 0.05$",  value: 0.05,  chance: 20   },
      { label: "💰 0.10$",  value: 0.10,  chance: 12   },
      { label: "💰 0.25$",  value: 0.25,  chance: 7    },
      { label: "💰 0.50$",  value: 0.50,  chance: 4    },
      { label: "🎉 1.00$",  value: 1.00,  chance: 1.5  },
      { label: "❌ Perdu",  value: 0,     chance: 0.5  },
    ],
  },

  DICE_GAME: {
    enabled:        true,
    min_bet:        0.05,
    max_bet:        10.00,
    multiplier_win: 1.9,
  },

  COINFLIP: {
    enabled:        true,
    min_bet:        0.05,
    max_bet:        10.00,
    multiplier_win: 1.9,
  },

  GUESS_NUMBER: {
    enabled:   true,
    cost:      0.05,
    prize:     0.40,
    range:     [1, 10],
    attempts:  1,
  },

  // ═══════════════════════════════════════════
  // 🏆 CONCOURS
  // ═══════════════════════════════════════════
  GIVEAWAYS_ENABLED: true,

  // ═══════════════════════════════════════════
  // ⭐ VIP (gardé pour la DB — non affiché aux users)
  // ═══════════════════════════════════════════
  VIP_LEVELS: {
    0: { name: "Gratuit",  bonus_percent: 0,  max_tasks_day: 50,  withdrawal_fee_discount: 0  },
    1: { name: "Bronze",   bonus_percent: 5,  max_tasks_day: 100, withdrawal_fee_discount: 10, price: 5   },
    2: { name: "Silver",   bonus_percent: 10, max_tasks_day: 200, withdrawal_fee_discount: 25, price: 15  },
    3: { name: "Gold",     bonus_percent: 20, max_tasks_day: 500, withdrawal_fee_discount: 50, price: 50  },
    4: { name: "Diamond",  bonus_percent: 30, max_tasks_day: 999, withdrawal_fee_discount: 75, price: 150 },
  },

  // ═══════════════════════════════════════════
  // 📊 XP / NIVEAUX (requis par la DB)
  // ═══════════════════════════════════════════
  LEVELS_ENABLED:       true,
  XP_PER_TASK:          10,
  XP_PER_REFERRAL:      50,
  XP_PER_DOLLAR_SPENT:  100,
  LEVEL_THRESHOLDS:     [0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000],
  LEVEL_REWARDS:        [0, 0.05, 0.10, 0.20, 0.30, 0.50, 0.75, 1.00, 1.50, 2.00],

  // ═══════════════════════════════════════════
  // 🔒 SÉCURITÉ
  // ═══════════════════════════════════════════
  MAX_TASKS_PER_DAY:    50,
  RATE_LIMIT_SECONDS:   2,

  // ═══════════════════════════════════════════
  // 📝 INFOS BOT
  // ═══════════════════════════════════════════
  BOT_NAME:          "ADCRYPTON",
  CHANNEL_USERNAME:  process.env.CHANNEL_USERNAME  || "",
  PAYMENT_CHANNEL:   process.env.PAYMENT_CHANNEL   || "",
  SUPPORT_USERNAME:  process.env.SUPPORT_USERNAME  || "",

  // ═══════════════════════════════════════════
  // 🔧 MAINTENANCE
  // ═══════════════════════════════════════════
  MAINTENANCE_MODE:    false,
  MAINTENANCE_MESSAGE: "🔧 Bot en maintenance. Revenez bientôt !",

  // ═══════════════════════════════════════════
  // 🔄 VÉRIFICATION AUTO DÉPÔTS
  // ═══════════════════════════════════════════
  AUTO_DEPOSIT_CHECK_ENABLED:  true,
  AUTO_DEPOSIT_CHECK_INTERVAL: 60000,

};

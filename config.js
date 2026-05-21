// ============================================
// ⚙️ CONFIGURATION PRINCIPALE DU BOT
// ============================================
// Les valeurs sensibles sont lues depuis les variables d'environnement Railway.
// Configure-les dans Railway → Variables avant de déployer.

module.exports = {
  // ═══════════════════════════════════════════
  // 🔑 IDENTIFIANTS — Variables d'environnement Railway
  // ═══════════════════════════════════════════
  BOT_TOKEN: process.env.BOT_TOKEN || "",
  ADMIN_IDS: process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(",").map(Number)
    : [6339278677],

  // ═══════════════════════════════════════════
  // 💰 DEVISE & MONNAIE
  // ═══════════════════════════════════════════
  CURRENCY_NAME: "USDT",
  CURRENCY_SYMBOL: "$",
  DECIMALS: 2,

  // ═══════════════════════════════════════════
  // 🎁 BONUS & RÉCOMPENSES
  // ═══════════════════════════════════════════
  WELCOME_BONUS: 0.10,
  DAILY_BONUS_MIN: 0.01,
  DAILY_BONUS_MAX: 0.05,
  REFERRAL_BONUS: 0.20,
  REFERRAL_PERCENT: 10,

  // ═══════════════════════════════════════════
  // 💳 DÉPÔTS — Wallets via variables d'environnement
  // ═══════════════════════════════════════════
  MIN_DEPOSIT: 1.00,
  DEPOSIT_METHODS: {
    usdt_trc20: {
      enabled: true,
      name: "USDT (TRC20)",
      symbol: "USDT",
      network: "TRC20",
      wallet: process.env.WALLET_USDT_TRC20 || "",
      minAmount: 1,
      confirmations: 1,
      apiUrl: "https://apilist.tronscanapi.com/api/transaction",
    },
    usdt_bep20: {
      enabled: true,
      name: "USDT (BEP20)",
      symbol: "USDT",
      network: "BEP20",
      wallet: process.env.WALLET_USDT_BEP20 || "",
      minAmount: 1,
      confirmations: 3,
      apiUrl: "https://api.bscscan.com/api",
    },
    ton: {
      enabled: true,
      name: "TON",
      symbol: "TON",
      network: "TON",
      wallet: process.env.WALLET_TON || "UQDCLLOiZ8_KzB_lJXPaTuinjyEemjbnzS3-VAZD6fU-Rp2S",
      minAmount: 0.5,
      confirmations: 1,
      apiUrl: "https://tonapi.io/v2",
    },
    ltc: {
      enabled: false,
      name: "Litecoin",
      symbol: "LTC",
      network: "LTC",
      wallet: process.env.WALLET_LTC || "",
      minAmount: 0.01,
      confirmations: 3,
    },
    btc: {
      enabled: false,
      name: "Bitcoin",
      symbol: "BTC",
      network: "BTC",
      wallet: process.env.WALLET_BTC || "",
      minAmount: 0.0001,
      confirmations: 2,
    },
    bnb: {
      enabled: true,
      name: "BNB (BEP20)",
      symbol: "BNB",
      network: "BEP20",
      wallet: process.env.WALLET_BEP20 || process.env.WALLET_USDT_BEP20 || "",
      minAmount: 0.001,
      confirmations: 3,
      apiUrl: "https://api.bscscan.com/api",
    },
    usdt_ton: {
      enabled: true,
      name: "USDT (TON)",
      symbol: "USDT",
      network: "TON",
      wallet: process.env.WALLET_TON || "",
      minAmount: 1,
      confirmations: 1,
      apiUrl: "https://tonapi.io/v2",
    },
  },

  // ═══════════════════════════════════════════
  // 🏧 RETRAITS
  // ═══════════════════════════════════════════
  MIN_WITHDRAWAL: 5.00,
  MAX_WITHDRAWAL: 500.00,
  WITHDRAWAL_FEE_PERCENT: 5,
  WITHDRAWAL_FEE_FIXED: 0,
  WITHDRAWAL_METHODS: {
    usdt_trc20: { enabled: true, name: "USDT (TRC20)", minAmount: 5 },
    usdt_bep20: { enabled: true, name: "USDT (BEP20)", minAmount: 5 },
    ton: { enabled: true, name: "TON", minAmount: 1 },
    ltc: { enabled: false, name: "Litecoin", minAmount: 0.05 },
    btc: { enabled: false, name: "Bitcoin", minAmount: 0.001 },
    payeer: { enabled: false, name: "Payeer", minAmount: 5 },
    perfectmoney: { enabled: false, name: "Perfect Money", minAmount: 5 },
    bnb: { enabled: true, name: "BNB (BEP20)", minAmount: 0.01 },
    usdt_ton: { enabled: true, name: "USDT (TON)", minAmount: 1 },
  },

  // ═══════════════════════════════════════════
  // 📋 TÂCHES
  // ═══════════════════════════════════════════
  TASK_TYPES: {
    channel: {
      enabled: true,
      name: "📢 Canal Telegram",
      reward_min: 0.02,
      reward_max: 0.20,
      reward_default: 0.05,
      platform_fee: 0.02,
      min_stay_hours: 24,
    },
    group: {
      enabled: true,
      name: "👥 Groupe Telegram",
      reward_min: 0.02,
      reward_max: 0.20,
      reward_default: 0.05,
      platform_fee: 0.02,
      min_stay_hours: 24,
    },
    bot: {
      enabled: true,
      name: "🤖 Bot Telegram",
      reward_min: 0.01,
      reward_max: 0.10,
      reward_default: 0.03,
      platform_fee: 0.01,
      min_stay_seconds: 30,
    },
    youtube: {
      enabled: true,
      name: "📺 YouTube",
      reward_min: 0.05,
      reward_max: 0.50,
      reward_default: 0.10,
      platform_fee: 0.03,
      verification: "manual",
    },
    twitter: {
      enabled: true,
      name: "🐦 Twitter/X",
      reward_min: 0.03,
      reward_max: 0.30,
      reward_default: 0.08,
      platform_fee: 0.02,
      verification: "manual",
    },
    instagram: {
      enabled: true,
      name: "📷 Instagram",
      reward_min: 0.03,
      reward_max: 0.30,
      reward_default: 0.08,
      platform_fee: 0.02,
      verification: "manual",
    },
    tiktok: {
      enabled: true,
      name: "🎵 TikTok",
      reward_min: 0.03,
      reward_max: 0.30,
      reward_default: 0.08,
      platform_fee: 0.02,
      verification: "manual",
    },
    website: {
      enabled: true,
      name: "🌐 Site Web",
      reward_min: 0.02,
      reward_max: 0.20,
      reward_default: 0.05,
      platform_fee: 0.01,
      verification: "manual",
    },
    app: {
      enabled: true,
      name: "📱 Application",
      reward_min: 0.10,
      reward_max: 1.00,
      reward_default: 0.30,
      platform_fee: 0.05,
      verification: "manual",
    },
  },

  // ═══════════════════════════════════════════
  // 🎰 MINI-JEUX
  // ═══════════════════════════════════════════
  GAMES_ENABLED: true,
  SPIN_WHEEL: {
    enabled: true,
    cost: 0.05,
    prizes: [
      { label: "💰 0.01$", value: 0.01, chance: 30 },
      { label: "💰 0.02$", value: 0.02, chance: 25 },
      { label: "💰 0.05$", value: 0.05, chance: 20 },
      { label: "💰 0.10$", value: 0.10, chance: 12 },
      { label: "💰 0.25$", value: 0.25, chance: 7 },
      { label: "💰 0.50$", value: 0.50, chance: 4 },
      { label: "🎉 1.00$", value: 1.00, chance: 1.5 },
      { label: "❌ Perdu", value: 0, chance: 0.5 },
    ],
    daily_free_spins: 1,
  },
  DICE_GAME: {
    enabled: true,
    min_bet: 0.05,
    max_bet: 10.00,
    multiplier_win: 1.9,
  },
  COINFLIP: {
    enabled: true,
    min_bet: 0.05,
    max_bet: 10.00,
    multiplier_win: 1.9,
  },
  GUESS_NUMBER: {
    enabled: true,
    cost: 0.02,
    prize: 0.50,
    range: [1, 10],
    attempts: 3,
  },

  // ═══════════════════════════════════════════
  // 🏆 CONCOURS / GIVEAWAYS
  // ═══════════════════════════════════════════
  GIVEAWAYS_ENABLED: true,

  // ═══════════════════════════════════════════
  // ⭐ SYSTÈME VIP
  // ═══════════════════════════════════════════
  VIP_ENABLED: true,
  VIP_LEVELS: {
    0: { name: "🆓 Gratuit", bonus_percent: 0, max_tasks_day: 20, withdrawal_fee_discount: 0 },
    1: { name: "⭐ Bronze", bonus_percent: 5, max_tasks_day: 50, withdrawal_fee_discount: 10, price: 5 },
    2: { name: "⭐⭐ Silver", bonus_percent: 10, max_tasks_day: 100, withdrawal_fee_discount: 25, price: 15 },
    3: { name: "⭐⭐⭐ Gold", bonus_percent: 20, max_tasks_day: 200, withdrawal_fee_discount: 50, price: 50 },
    4: { name: "💎 Diamond", bonus_percent: 30, max_tasks_day: 999, withdrawal_fee_discount: 75, price: 150 },
  },

  // ═══════════════════════════════════════════
  // 📊 NIVEAUX D'EXPÉRIENCE
  // ═══════════════════════════════════════════
  LEVELS_ENABLED: true,
  XP_PER_TASK: 10,
  XP_PER_REFERRAL: 50,
  XP_PER_DOLLAR_SPENT: 100,
  LEVEL_THRESHOLDS: [0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000],
  LEVEL_REWARDS: [0, 0.05, 0.10, 0.20, 0.30, 0.50, 0.75, 1.00, 1.50, 2.00],

  // ═══════════════════════════════════════════
  // 🔒 SÉCURITÉ & ANTI-SPAM
  // ═══════════════════════════════════════════
  CAPTCHA_ENABLED: false,
  MAX_TASKS_PER_DAY: 50,
  MIN_ACCOUNT_AGE_DAYS: 0,
  RATE_LIMIT_SECONDS: 2,
  IP_CHECK_ENABLED: false,

  // ═══════════════════════════════════════════
  // 📝 TEXTES DU BOT
  // ═══════════════════════════════════════════
  BOT_NAME: "💰 CryptoTaskBot",
  BOT_USERNAME: "",
  BOT_DESCRIPTION: "Gagne de la crypto en complétant des tâches simples !",
  SUPPORT_USERNAME: process.env.SUPPORT_USERNAME || "",
  CHANNEL_USERNAME: process.env.CHANNEL_USERNAME || "",
  PAYMENT_CHANNEL: process.env.PAYMENT_CHANNEL || "",

  // ═══════════════════════════════════════════
  // 🌍 LANGUES
  // ═══════════════════════════════════════════
  DEFAULT_LANGUAGE: "fr",
  AVAILABLE_LANGUAGES: ["fr", "en"],

  // ═══════════════════════════════════════════
  // ⏰ MAINTENANCE
  // ═══════════════════════════════════════════
  MAINTENANCE_MODE: false,
  MAINTENANCE_MESSAGE: "🔧 Le bot est en maintenance. Revenez bientôt !",

  // ═══════════════════════════════════════════
  // 📊 VÉRIFICATION BLOCKCHAIN AUTO
  // ═══════════════════════════════════════════
  AUTO_DEPOSIT_CHECK_ENABLED: true,
  AUTO_DEPOSIT_CHECK_INTERVAL: 60000,
  TRONSCAN_API_KEY: process.env.TRONSCAN_API_KEY || "",
  BSCSCAN_API_KEY: process.env.BSCSCAN_API_KEY || "",
};

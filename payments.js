// ============================================
// 💰 PAYMENTS.JS - VÉRIFICATION AUTO DES DÉPÔTS
// Prix en temps réel via CoinGecko (gratuit, sans API key)
// Vérification blockchain auto toutes les 60s
// Supporte : TON, USDT BEP20, USDT TON, BNB
// ============================================

const https = require("https");

// ─────────────────────────────────────────────
//  PRIX EN TEMPS RÉEL — CoinGecko
// ─────────────────────────────────────────────

// Cache des prix pour éviter trop de requêtes
const priceCache = {
  prices: {},
  lastUpdate: 0,
  TTL: 60000, // 1 minute
};

/**
 * Récupère les prix en temps réel depuis CoinGecko
 * @returns {Object} { ton: 2.15, bnb: 580.00, usdt: 1.00 }
 */
async function getLivePrices() {
  const now = Date.now();

  // Retourner le cache si encore valide
  if (now - priceCache.lastUpdate < priceCache.TTL && Object.keys(priceCache.prices).length > 0) {
    return priceCache.prices;
  }

  return new Promise((resolve) => {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,binancecoin,tether&vs_currencies=usd";

    https.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          priceCache.prices = {
            ton:  json["the-open-network"]?.usd || 2.00,
            bnb:  json["binancecoin"]?.usd       || 580.00,
            usdt: json["tether"]?.usd             || 1.00,
          };
          priceCache.lastUpdate = now;
          console.log(`💱 Prix mis à jour: TON=${priceCache.prices.ton}$ BNB=${priceCache.prices.bnb}$ USDT=${priceCache.prices.usdt}$`);
          resolve(priceCache.prices);
        } catch (e) {
          console.error("CoinGecko parse error:", e.message);
          // Retourner cache existant ou valeurs par défaut
          resolve(priceCache.prices.ton ? priceCache.prices : { ton: 2.00, bnb: 580.00, usdt: 1.00 });
        }
      });
    }).on("error", (e) => {
      console.error("CoinGecko fetch error:", e.message);
      resolve(priceCache.prices.ton ? priceCache.prices : { ton: 2.00, bnb: 580.00, usdt: 1.00 });
    }).on("timeout", () => {
      console.error("CoinGecko timeout");
      resolve(priceCache.prices.ton ? priceCache.prices : { ton: 2.00, bnb: 580.00, usdt: 1.00 });
    });
  });
}

/**
 * Convertit un montant crypto en USD au prix du marché
 * @param {number} amount - Montant en crypto
 * @param {string} symbol - "TON", "BNB", "USDT"
 * @returns {number} Valeur en USD
 */
async function cryptoToUSD(amount, symbol) {
  const prices = await getLivePrices();
  const sym = symbol.toUpperCase();

  let price = 1.00;
  if (sym === "TON")  price = prices.ton;
  if (sym === "BNB")  price = prices.bnb;
  if (sym === "USDT") price = prices.usdt;

  const usd = Math.round(amount * price * 100) / 100;
  return usd;
}

// ─────────────────────────────────────────────
//  HELPERS HTTP
// ─────────────────────────────────────────────

function fetchJSON(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    })
    .on("error", reject)
    .on("timeout", () => reject(new Error("Timeout")));
  });
}

// ─────────────────────────────────────────────
//  VÉRIFICATION TON
// ─────────────────────────────────────────────

/**
 * Vérifie les transactions TON récentes sur un wallet
 * Cherche une transaction avec le memo = userId
 * @param {string} walletAddress - Adresse TON du bot
 * @param {string} userId - ID Telegram de l'user (dans le memo)
 * @param {number} minAmount - Montant minimum en TON
 * @param {number} sinceTimestamp - Ne regarder que depuis ce timestamp
 */
async function checkTONDeposit(walletAddress, userId, minAmount, sinceTimestamp) {
  try {
    const url = `https://tonapi.io/v2/accounts/${walletAddress}/events?limit=20&subject_only=true`;
    const data = await fetchJSON(url);

    if (!data.events) return null;

    for (const event of data.events) {
      // Ignorer les événements trop anciens
      if (event.timestamp < sinceTimestamp) continue;

      for (const action of event.actions || []) {
        if (action.type !== "TonTransfer") continue;

        const transfer = action.TonTransfer;
        if (!transfer) continue;

        // Vérifier le memo contient l'ID user
        const comment = transfer.comment || "";
        if (!comment.includes(String(userId))) continue;

        // Vérifier le montant minimum
        const amountTON = transfer.amount / 1e9; // nanotons → TON
        if (amountTON < minAmount) continue;

        // Vérifier que c'est bien envoyé à notre wallet
        if (!transfer.recipient?.address) continue;

        return {
          txHash: event.event_id,
          amount: amountTON,
          symbol: "TON",
          timestamp: event.timestamp,
        };
      }
    }

    return null;
  } catch (e) {
    console.error("TON check error:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
//  VÉRIFICATION USDT TON (Jetton TON)
// ─────────────────────────────────────────────

async function checkUSDT_TONDeposit(walletAddress, userId, minAmount, sinceTimestamp) {
  try {
    const url = `https://tonapi.io/v2/accounts/${walletAddress}/jettons/events?limit=20`;
    const data = await fetchJSON(url);

    if (!data.events) return null;

    for (const event of data.events) {
      if (event.timestamp < sinceTimestamp) continue;

      for (const action of event.actions || []) {
        if (action.type !== "JettonTransfer") continue;

        const transfer = action.JettonTransfer;
        if (!transfer) continue;

        const comment = transfer.comment || "";
        if (!comment.includes(String(userId))) continue;

        // Vérifier que c'est bien USDT
        const symbol = transfer.jetton?.symbol || "";
        if (!symbol.includes("USD")) continue;

        const amountUSDT = transfer.amount / Math.pow(10, transfer.jetton?.decimals || 6);
        if (amountUSDT < minAmount) continue;

        return {
          txHash: event.event_id,
          amount: amountUSDT,
          symbol: "USDT",
          network: "TON",
          timestamp: event.timestamp,
        };
      }
    }

    return null;
  } catch (e) {
    console.error("USDT TON check error:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
//  VÉRIFICATION BNB / USDT BEP20 (BSCScan gratuit)
// ─────────────────────────────────────────────

async function checkBSCDeposit(walletAddress, userId, minAmount, symbol, sinceTimestamp) {
  try {
    let url;

    if (symbol === "BNB") {
      // Transactions BNB natives
      url = `https://api.bscscan.com/api?module=account&action=txlist&address=${walletAddress}&sort=desc&page=1&offset=20`;
    } else {
      // Transactions USDT BEP20
      // Adresse contrat USDT BEP20
      const usdtContract = "0x55d398326f99059fF775485246999027B3197955";
      url = `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${usdtContract}&address=${walletAddress}&sort=desc&page=1&offset=20`;
    }

    const data = await fetchJSON(url);

    if (!data.result || !Array.isArray(data.result)) return null;

    for (const tx of data.result) {
      // Vérifier timestamp
      if (parseInt(tx.timeStamp) < sinceTimestamp) continue;

      // Vérifier destinataire = notre wallet
      if (tx.to?.toLowerCase() !== walletAddress.toLowerCase()) continue;

      // Vérifier memo/input contient userId
      let input = tx.input || "";
      // Décoder hex en texte pour chercher l'ID
      try {
        const decoded = Buffer.from(input.replace("0x", ""), "hex").toString("utf8");
        if (!decoded.includes(String(userId))) continue;
      } catch {
        // Si décodage échoue, ignorer cette tx
        continue;
      }

      let amount;
      if (symbol === "BNB") {
        amount = parseInt(tx.value) / 1e18;
      } else {
        const decimals = parseInt(tx.tokenDecimal) || 18;
        amount = parseInt(tx.value) / Math.pow(10, decimals);
      }

      if (amount < minAmount) continue;

      // Vérifier que la tx est confirmée
      if (tx.txreceipt_status && tx.txreceipt_status !== "1") continue;

      return {
        txHash: tx.hash,
        amount,
        symbol,
        network: "BEP20",
        timestamp: parseInt(tx.timeStamp),
      };
    }

    return null;
  } catch (e) {
    console.error(`BSC ${symbol} check error:`, e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
//  VÉRIFICATEUR PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Vérifie un dépôt en attente sur la blockchain
 * @param {Object} deposit - Objet dépôt depuis la DB
 * @param {Object} config - Config du bot
 * @returns {Object|null} Transaction trouvée ou null
 */
async function verifyDeposit(deposit, config) {
  const method = config.DEPOSIT_METHODS[deposit.method];
  if (!method || !method.enabled) return null;

  const wallet = method.wallet;
  if (!wallet || wallet.includes("Your") || wallet.length < 10) return null;

  const userId    = deposit.user_id;
  const minAmount = method.minAmount || 0.01;
  // Chercher seulement les transactions depuis la création du dépôt
  const since = Math.floor(new Date(deposit.created_at).getTime() / 1000) - 300; // -5min de marge

  let tx = null;

  if (deposit.method === "ton") {
    tx = await checkTONDeposit(wallet, userId, minAmount, since);
  } else if (deposit.method === "usdt_ton") {
    tx = await checkUSDT_TONDeposit(wallet, userId, minAmount, since);
  } else if (deposit.method === "bnb") {
    tx = await checkBSCDeposit(wallet, userId, minAmount, "BNB", since);
  } else if (deposit.method === "usdt_bep20") {
    tx = await checkBSCDeposit(wallet, userId, minAmount, "USDT", since);
  }

  return tx;
}

// ─────────────────────────────────────────────
//  BOUCLE DE VÉRIFICATION AUTOMATIQUE
// ─────────────────────────────────────────────

/**
 * Lance la vérification automatique toutes les 60 secondes
 * @param {Object} db - Instance base de données
 * @param {Object} config - Config du bot
 * @param {Function} onConfirmed - Callback quand dépôt confirmé (deposit, usdAmount)
 */
function startAutoDepositChecker(db, config, onConfirmed) {
  console.log("🔄 Démarrage vérification automatique des dépôts...");

  async function checkAll() {
    try {
      // Récupérer tous les dépôts en attente
      const pendingDeposits = db.prepare(
        "SELECT * FROM deposits WHERE status = 'pending' ORDER BY created_at ASC"
      ).all();

      if (pendingDeposits.length === 0) return;

      console.log(`🔍 Vérification de ${pendingDeposits.length} dépôt(s) en attente...`);

      for (const deposit of pendingDeposits) {
        // Ignorer les dépôts trop anciens (+24h)
        const age = Date.now() - new Date(deposit.created_at).getTime();
        if (age > 24 * 60 * 60 * 1000) {
          db.prepare("UPDATE deposits SET status = 'expired' WHERE deposit_id = ?").run(deposit.deposit_id);
          console.log(`⏰ Dépôt #${deposit.deposit_id} expiré`);
          continue;
        }

        // Vérifier si déjà traité (anti-double)
        if (deposit.tx_hash) continue;

        try {
          const tx = await verifyDeposit(deposit, config);

          if (tx) {
            // Vérifier anti-double crédit via txHash
            const alreadyUsed = db.prepare(
              "SELECT deposit_id FROM deposits WHERE tx_hash = ? AND status = 'confirmed'"
            ).get(tx.txHash);

            if (alreadyUsed) {
              console.log(`⚠️ TX ${tx.txHash} déjà utilisée, skip`);
              continue;
            }

            // Convertir en USD au prix du marché
            const usdAmount = await cryptoToUSD(tx.amount, tx.symbol);

            console.log(`✅ Dépôt détecté! User:${deposit.user_id} ${tx.amount} ${tx.symbol} = ${usdAmount}$ TX:${tx.txHash}`);

            // Sauvegarder le txHash pour éviter double crédit
            db.prepare(
              "UPDATE deposits SET tx_hash = ?, amount = ? WHERE deposit_id = ?"
            ).run(tx.txHash, usdAmount, deposit.deposit_id);

            // Confirmer le dépôt
            const confirmed = db.confirmDeposit(deposit.deposit_id, tx.txHash, true);

            if (confirmed && onConfirmed) {
              onConfirmed(confirmed, usdAmount, tx);
            }
          }
        } catch (e) {
          console.error(`Erreur vérif dépôt #${deposit.deposit_id}:`, e.message);
        }

        // Petite pause entre chaque vérif pour éviter rate limit
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error("Erreur boucle dépôts:", e.message);
    }
  }

  // Première vérification après 30s
  setTimeout(checkAll, 30000);

  // Puis toutes les 60 secondes
  setInterval(checkAll, 60000);

  console.log("✅ Vérification auto dépôts démarrée (toutes les 60s)");
}

// ─────────────────────────────────────────────
//  MESSAGE DE DÉPÔT AMÉLIORÉ
// ─────────────────────────────────────────────

/**
 * Génère le message de dépôt avec prix en temps réel
 * @param {string} method - "ton", "bnb", "usdt_bep20", "usdt_ton"
 * @param {number} amount - Montant en crypto
 * @param {string} wallet - Adresse wallet du bot
 * @param {number} userId - ID Telegram user
 * @param {number} depositId - ID du dépôt
 */
async function buildDepositMessage(method, amount, wallet, userId, depositId) {
  const symbols = {
    ton: "TON",
    bnb: "BNB",
    usdt_bep20: "USDT",
    usdt_ton: "USDT",
  };
  const networks = {
    ton: "TON",
    bnb: "BEP20",
    usdt_bep20: "BEP20",
    usdt_ton: "TON",
  };

  const symbol  = symbols[method] || "CRYPTO";
  const network = networks[method] || "?";

  // Prix en temps réel
  const usdValue = await cryptoToUSD(amount, symbol);
  const prices   = await getLivePrices();
  const priceStr = symbol === "TON"
    ? `1 TON = ${prices.ton}$`
    : symbol === "BNB"
    ? `1 BNB = ${prices.bnb}$`
    : `1 USDT = ${prices.usdt}$`;

  return `💳 <b>Dépôt #${depositId}</b>

💰 Montant : <b>${amount} ${symbol}</b>
💵 Valeur : <b>≈ ${usdValue}$</b>
📊 Prix actuel : <i>${priceStr}</i>
🌐 Réseau : <b>${network}</b>

📋 Envoie exactement <b>${amount} ${symbol}</b> à :
<code>${wallet}</code>

⚠️ <b>IMPORTANT</b> — Mets ton ID dans le <b>mémo/commentaire</b> :
<code>${userId}</code>

✅ Le dépôt sera <b>confirmé automatiquement</b> dès détection.
⏳ Délai : 1-5 minutes après envoi.
🕐 Expiration : 24 heures.`;
}

// ─────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  getLivePrices,
  cryptoToUSD,
  verifyDeposit,
  startAutoDepositChecker,
  buildDepositMessage,
};

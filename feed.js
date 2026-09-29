const fs = require('fs');
const steem = require('steem');

// ── Configuration ──────────────────────────────────────────────────────────────

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const rpcNode = config.rpc_nodes?.[0] ?? 'https://api.steemit.com';
steem.api.setOptions({ transport: 'http', uri: rpcNode, url: rpcNode });

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(...messages) {
  console.log(`[${new Date().toISOString()}]`, ...messages);
}

function getConfig(key) {
  return config[key] || process.env[key];
}

/**
 * Fetch JSON from a URL with automatic retries.
 * Returns the parsed JSON on success, or throws after all retries are exhausted.
 */
async function fetchJSON(url, headers = {}, retries = config.price_feed_max_retry ?? 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      log(`Fetch failed (attempt ${attempt + 1}/${retries + 1}): ${url} — ${err.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, (config.retry_interval ?? 10) * 1000));
      }
    }
  }
  throw new Error(`All ${retries + 1} attempts failed for ${url}`);
}

// ── Exchange Price Loaders ─────────────────────────────────────────────────────
// Each loader is a simple async function that returns a USD price (number).

const exchangeLoaders = {
  async coingecko() {
    const data = await fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=steem&vs_currencies=usd');
    const price = parseFloat(data.steem.usd);
    log(`CoinGecko: $${price}`);
    return price;
  },
  async binance() {
    const data = await fetchJSON('https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT');
    const price = parseFloat(data.price);
    log(`Binance: $${price}`);
    return price;
  },
  async coinmarketcap() {
    const res = await fetchJSON('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?slug=steem');
    const price = parseFloat(res.data.statistics.price);
    log(`CoinMarketCap: $${price}`);
    return price;
  },
};

// ── RPC Node Failover ──────────────────────────────────────────────────────────

function getCurrentNodeIndex() {
  const nodes = config.rpc_nodes;
  if (!nodes?.length) return -1;
  return nodes.indexOf(steem.api.options.url);
}

function switchToNode(index) {
  const nodes = config.rpc_nodes;
  const node = nodes[index % nodes.length];
  steem.api.setOptions({ transport: 'http', uri: node, url: node });
  return node;
}

// ── Feed Publishing ────────────────────────────────────────────────────────────

function publishFeed(price) {
  return new Promise((resolve, reject) => {
    const pegMulti = config.peg_multi ?? 1;
    const exchangeRate = {
      base: `${price.toFixed(3)} SBD`,
      quote: `${(1 / pegMulti).toFixed(3)} STEEM`,
    };

    const currentNode = steem.api.options.url;
    log(`Publishing via ${currentNode}: ${JSON.stringify(exchangeRate)}`);

    const activeKey = getConfig('feed_steem_active_key');
    const account = getConfig('feed_steem_account');

    steem.broadcast.feedPublish(activeKey, account, exchangeRate, (err, result) => {
      if (result && !err) {
        log(`Published successfully via ${currentNode}`);
        resolve(result);
      } else {
        reject(new Error(err));
      }
    });
  });
}

async function publishWithRetry(price) {
  const nodes = config.rpc_nodes ?? [];
  const totalAttempts = Math.max(nodes.length, 1);
  const startIndex = getCurrentNodeIndex();

  for (let i = 0; i < totalAttempts; i++) {
    const nodeIndex = (startIndex + i) % nodes.length;
    const node = switchToNode(nodeIndex);

    try {
      await publishFeed(price);
      return;
    } catch (err) {
      log(`Publish failed on ${node}: ${err.message}`);
      if (i < totalAttempts - 1) {
        log(`Switching to next node...`);
        await new Promise(r => setTimeout(r, (config.retry_interval ?? 10) * 1000));
      }
    }
  }
  log(`All ${totalAttempts} RPC nodes failed. Publish abandoned for this cycle.`);
}

// ── Main Loop ──────────────────────────────────────────────────────────────────

async function startProcess() {
  const enabledExchanges = config.exchanges ?? [];
  log(`Fallback strategy enabled. Exchanges order: ${enabledExchanges.join(', ')}`);

  let finalPrice = null;
  let successfulExchange = null;

  for (const name of enabledExchanges) {
    if (!exchangeLoaders[name]) {
      log(`Unknown exchange: "${name}" — skipping`);
      continue;
    }

    try {
      const price = await exchangeLoaders[name]();
      if (Number.isFinite(price) && price > 0) {
        finalPrice = price;
        successfulExchange = name;
        break; // Stop at the first successful exchange
      }
    } catch (err) {
      log(`Failed to fetch from ${name}: ${err.message}`);
    }
  }

  if (finalPrice === null) {
    log('No valid prices retrieved from any exchange. Skipping publish.');
    return;
  }

  log(`Using price from ${successfulExchange}: $${finalPrice.toFixed(4)}`);
  await publishWithRetry(finalPrice);
}

// ── Startup Validation ─────────────────────────────────────────────────────────

if (!getConfig('feed_steem_account')) {
  log('ERROR: feed_steem_account not set in config.json or environment');
  process.exit(1);
}

if (!getConfig('feed_steem_active_key')) {
  log('ERROR: feed_steem_active_key not set in config.json or environment');
  process.exit(1);
}

if (!config.exchanges?.length) {
  log('ERROR: No exchanges configured');
  process.exit(1);
}

// ── Run ────────────────────────────────────────────────────────────────────────

startProcess();
setInterval(startProcess, (config.interval ?? 60) * 60 * 1000);

const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');

const API_KEY = process.env.hefh6UXPHTcCDFc01MlIzHNKN2W1T6250X4qRL6TMCQ9Naqvzq4jH2O8I5WKLz0Y;
const SECRET_KEY = process.env.oxbI34CbcUzaHwdt9PS4n2b9pEahMz9dBbZh4RDGHFW8CIJQlXh9K4gk1ae44n7M;
const TELEGRAM_TOKEN = process.env.8613931109:AAGg8CyHsBIRxz0_dL6ZgILojojtTV9Zkxg;
const CHAT_ID = process.env.6041682231;

const TRADE_AMOUNT_USDT = 10;
const MAX_TRADES = 2;
const STOP_LOSS_PCT = 0.02;
const TAKE_PROFIT_PCT = 0.04;
const SCAN_INTERVAL_MS = 60000;

const COINS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','LTCUSDT','ATOMUSDT','NEARUSDT','FTMUSDT',
  'ALGOUSDT','XTZUSDT','RUNEUSDT','EGLDUSDT','CHZUSDT',
  'GRTUSDT','BATUSDT','ZECUSDT','DASHUSDT','COMPUSDT',
  'SUSHIUSDT','CRVUSDT','SNXUSDT','IOTAUSDT','FLOWUSDT',
  'LRCUSDT','RAYUSDT','ROSEUSDT','QNTUSDT','BANDUSDT',
  'STORJUSDT','FETUSDT','OCEANUSDT','ANKRUSDT','WOOUSDT'
];

const binance = new Binance().options({
  APIKEY: API_KEY,
  APISECRET: SECRET_KEY,
  useServerTime: true,
  httpBase: 'https://api1.binance.com',
  recvWindow: 60000
});

const telegram = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

let activeTrades = [];
let totalPnl = 0;
let tradeCount = 0;

function log(msg) {
  const time = new Date().toLocaleTimeString('en-IN');
  console.log(`[${time}] ${msg}`);
}

async function sendTelegram(msg) {
  try {
    await telegram.sendMessage(CHAT_ID, msg);
  } catch (e) {
    log('Telegram error: ' + e.message);
  }
}

async function calculateRSI(symbol, period = 14) {
  try {
    const ticks = await binance.candlesticks(symbol, '15m', false, { limit: period + 1 });
    const closes = ticks.map(t => parseFloat(t[4]));
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  } catch (e) {
    return 50;
  }
}

async function checkVolume(symbol) {
  try {
    const ticker = await binance.prevDay(symbol);
    return parseFloat(ticker.quoteVolume) > 5000000;
  } catch (e) {
    return false;
  }
}

async function getPriceChange(symbol) {
  try {
    const ticker = await binance.prevDay(symbol);
    return parseFloat(ticker.priceChangePercent);
  } catch (e) {
    return 0;
  }
}

async function getPrice(symbol) {
  try {
    const prices = await binance.prices(symbol);
    return parseFloat(prices[symbol]);
  } catch (e) {
    return 0;
  }
}

async function analyzeCoin(symbol) {
  try {
    const [rsi, highVolume, priceChange] = await Promise.all([
      calculateRSI(symbol),
      checkVolume(symbol),
      getPriceChange(symbol)
    ]);
    let score = 0;
    let direction = 'WAIT';
    if (rsi < 30) score += 30;
    else if (rsi < 40) score += 15;
    else if (rsi > 70) score -= 30;
    else if (rsi > 60) score -= 15;
    if (highVolume) score += 20;
    if (priceChange > 3) score += 20;
    else if (priceChange > 1) score += 10;
    else if (priceChange < -3) score -= 20;
    else if (priceChange < -1) score -= 10;
    if (score >= 40) direction = 'BUY';
    else if (score <= -30) direction = 'SELL';
    return { symbol, rsi: rsi.toFixed(1), highVolume, priceChange: priceChange.toFixed(2), score, direction };
  } catch (e) {
    return null;
  }
}

async function openTrade(signal) {
  try {
    const price = await getPrice(signal.symbol);
    if (price === 0) return;
    const quantity = parseFloat((TRADE_AMOUNT_USDT / price).toFixed(6));
    const sl = signal.direction === 'BUY'
      ? (price * (1 - STOP_LOSS_PCT)).toFixed(6)
      : (price * (1 + STOP_LOSS_PCT)).toFixed(6);
    const tp = signal.direction === 'BUY'
      ? (price * (1 + TAKE_PROFIT_PCT)).toFixed(6)
      : (price * (1 - TAKE_PROFIT_PCT)).toFixed(6);
    const msg = `TRADE OPEN\nCoin: ${signal.symbol}\nType: ${signal.direction}\nPrice: $${price}\nSL: $${sl}\nTP: $${tp}\nRSI: ${signal.rsi}\nScore: ${signal.score}`;
    log(msg);
    await sendTelegram(msg);
    activeTrades.push({
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: price,
      quantity,
      sl: parseFloat(sl),
      tp: parseFloat(tp),
      openTime: Date.now()
    });
    tradeCount++;
  } catch (e) {
    log('Trade open error: ' + e.message);
  }
}

async function monitorTrades() {
  for (let i = activeTrades.length - 1; i >= 0; i--) {
    const trade = activeTrades[i];
    const currentPrice = await getPrice(trade.symbol);
    if (currentPrice === 0) continue;
    let closed = false;
    let reason = '';
    let pnl = 0;
    if (trade.direction === 'BUY') {
      pnl = (currentPrice - trade.entryPrice) * trade.quantity;
      if (currentPrice >= trade.tp) { closed = true; reason = 'Take Profit HIT'; }
      else if (currentPrice <= trade.sl) { closed = true; reason = 'Stop Loss HIT'; }
    } else {
      pnl = (trade.entryPrice - currentPrice) * trade.quantity;
      if (currentPrice <= trade.tp) { closed = true; reason = 'Take Profit HIT'; }
      else if (currentPrice >= trade.sl) { closed = true; reason = 'Stop Loss HIT'; }
    }
    if (closed) {
      totalPnl += pnl;
      const msg = `${reason}\nCoin: ${trade.symbol}\nP&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(3)}\nTotal P&L: $${totalPnl.toFixed(3)}`;
      log(msg);
      await sendTelegram(msg);
      activeTrades.splice(i, 1);
    } else {
      const unrealized = trade.direction === 'BUY'
        ? (currentPrice - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - currentPrice) * trade.quantity;
      log(`MONITORING: ${trade.symbol} | Price: $${currentPrice} | Unrealized: ${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(3)}`);
    }
  }
}

async function runBot() {
  log('CryptoAI Bot SHURU HO GAYA!');
  log(`Trade Size: $${TRADE_AMOUNT_USDT} | Max Trades: ${MAX_TRADES} | SL: ${STOP_LOSS_PCT * 100}% | TP: ${TAKE_PROFIT_PCT * 100}%`);
  log(`Monitoring ${COINS.length} coins...`);
  log('─────────────────────────────────');
  await sendTelegram('CryptoAI Bot SHURU HO GAYA!\nTrade Size: $' + TRADE_AMOUNT_USDT + '\nMax Trades: ' + MAX_TRADES + '\nSL: ' + (STOP_LOSS_PCT * 100) + '%\nTP: ' + (TAKE_PROFIT_PCT * 100) + '%');
  setInterval(async () => {
    log(`Scanning ${COINS.length} coins...`);
    if (activeTrades.length > 0) await monitorTrades();
    if (activeTrades.length < MAX_TRADES) {
      const results = [];
      for (const coin of COINS) {
        const analysis = await analyzeCoin(coin);
        if (analysis && analysis.direction !== 'WAIT') results.push(analysis);
      }
      results.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
      const slotsAvailable = MAX_TRADES - activeTrades.length;
      const topSignals = results.slice(0, slotsAvailable);
      if (topSignals.length > 0) {
        for (const signal of topSignals) {
          log(`Signal: ${signal.symbol} | ${signal.direction} | RSI: ${signal.rsi} | Score: ${signal.score}`);
          await openTrade(signal);
        }
      } else {
        log('Koi strong signal nahi mila — next scan tak wait...');
      }
    } else {
      log(`Max trades active (${activeTrades.length}/${MAX_TRADES}) — monitoring...`);
    }
    log(`Total P&L: $${totalPnl.toFixed(3)} | Total Trades: ${tradeCount} | Active: ${activeTrades.length}`);
    log('─────────────────────────────────');
  }, SCAN_INTERVAL_MS);
}

runBot();
```

**Ctrl+S** save karo → CMD mein:
```
git add .
git commit -m "fix binance region"
git push
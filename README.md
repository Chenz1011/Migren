# Migren — NIMORI sniper (Pons / Robinhood Chain)

Bot buat auto-snipe `$NIMORI` di [Pons launchpad](https://www.ponsfamily.com/launchpad)
pake GMGN router (fastest route, auto anti-MEV). Trigger: migration ke V4 pool,
atau volume spike ≥ $12,500 dalam 60 detik. Notif via Telegram tiap step.

---

## 🚀 QUICKSTART (COPY PASTE AJA)

### 1. Install Node.js 20+ (sekali aja)

Kalo udah skip ke step 2. Kalo belum:

```bash
# Mac (brew):
brew install node

# Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# atau pake nvm (recommended, cross-platform):
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
```

Cek:
```bash
node --version   # harus v20+
```

### 2. Clone repo + install deps

```bash
git clone https://github.com/Chenz1011/Migren.git
cd Migren
git checkout claude/wonderful-bardeen-0i4hc5
npm install
```

### 3. Setup .env

```bash
cp .env.example .env
```

Buka `.env` di text editor (nano, vscode, apa aja):

```bash
nano .env     # atau: code .env
```

**Isi yang WAJIB (sisanya biarkan default):**

```
PRIVATE_KEY=0x<64 hex char priv key wallet lu>
GMGN_API_KEY=<API key GMGN lu>
TELEGRAM_BOT_TOKEN=<token dari @BotFather>
TELEGRAM_CHAT_ID=<chat ID lu dari @userinfobot>
```

Yang udah default (ga perlu diganti kecuali lu mau):
- `BUY_SIZE_ETH=0.075`
- `VOLUME_SPIKE_USD=12500`
- `VOLUME_WINDOW_SECONDS=60`
- `TARGET_TICKER=NIMORI`
- `DRY_RUN=true` ← **PENTING: biarkan true dulu buat testing**

### 4. Setup Telegram bot (sekali aja)

Kalo lu belum punya TG bot:

1. Di Telegram, buka [@BotFather](https://t.me/BotFather) → kirim `/newbot` → kasih nama & username → dapet **token** (format: `123456789:AAE…`). Copy ke `TELEGRAM_BOT_TOKEN`.
2. Buka [@userinfobot](https://t.me/userinfobot) → kirim `/start` → dapet **chat ID** (angka doang, misal `123456789`). Copy ke `TELEGRAM_CHAT_ID`.
3. Buka bot lu (yg lu bikin di step 1) → kirim `/start` biar bot bisa DM lu.

### 5. Test (DRY_RUN mode)

```bash
npm start
```

Lu bakal liat log kayak gini:
```
[INFO] wallet ready { "address": "0x..." }
[INFO] rpc { "http": "...", "ws": "..." }
[INFO] wallet balance { "eth": "0.1" }
[INFO] price feed started { "ethUsd": 3456 }
[INFO] config summary { ... }
[WARN] ⚠️  DRY_RUN=true — tx NOT akan di-submit.
[INFO] watching Pons factory for new launches { ... }
```

Dan TG lu bakal nerima pesan "🤖 Migren started". Kalo iya, berarti setup bener.

### 6. Live mode

Buka `.env` lagi, ganti:
```
DRY_RUN=false
```

Restart:
```bash
npm start
```

Udah. Bot bakal:
- Watch Pons factory sampe NIMORI muncul
- Begitu NIMORI graduate atau volume ≥ $12,500/60s → auto-snipe 0.075 ETH via GMGN router
- Kirim notif TG tiap step: discovery, trigger, execute

### 7. Biar jalan 24/7 (tmux)

```bash
# install tmux dulu kalo belum: brew install tmux (Mac) atau apt install tmux (Linux)

tmux new -s migren
npm start
# Ctrl+b lalu d  → detach (bot tetep jalan)

# cek lagi nanti:
tmux attach -t migren

# matiin:
tmux kill-session -t migren
```

---

## 📝 Config quick reference

Yang paling sering lu ubah:

| Env var | Default | Keterangan |
|---|---|---|
| `BUY_SIZE_ETH` | `0.075` | ETH per snipe |
| `VOLUME_SPIKE_USD` | `12500` | USD volume threshold |
| `VOLUME_WINDOW_SECONDS` | `60` | Window volume (detik) |
| `MAX_TOTAL_SPEND_ETH` | `0.5` | Fail-safe total cap |
| `DRY_RUN` | `true` | Simulate only. Set `false` buat live. |
| `TARGET_TICKER` | `NIMORI` | Ticker target |
| `GMGN_ANTI_MEV` | `true` | Anti-sandwich protection |
| `GMGN_AUTO_SLIPPAGE` | `true` | Slippage auto-pick by GMGN |

Yang jarang disentuh:
- `TRIGGER_ON_MIGRATION`, `TRIGGER_ON_VOLUME_SPIKE` — matiin salah satu kalo mau trigger tunggal
- `TELEGRAM_NOTIFY_ON_*` — matiin notif per kategori
- `EXECUTION_ROUTE` — `GMGN` (default) atau `DIRECT` (raw chain)
- `RPC_WS_URL` — WebSocket RPC (biar event real-time)

---

## 🔧 Troubleshooting

**`Missing required env: PRIVATE_KEY`**
→ Isi `PRIVATE_KEY` di `.env`. Format: `0x` + 64 karakter hex.

**`EXECUTION_ROUTE=GMGN tapi GMGN_API_KEY kosong`**
→ Isi `GMGN_API_KEY` di `.env`.

**`GMGN swap failed`**
→ Cek log stderr. Biasanya karena chain name salah (confirm `GMGN_CHAIN=robinhood` persis), API key invalid, atau balance kurang. Rate limit GMGN: 1 call per 5 detik per API key.

**TG notif ga masuk**
→ Pastikan lu udah `/start` ke bot lu sendiri. Chat ID harus angka doang (contoh `123456789`), bukan `@username`.

**Price feed `could not fetch ETH/USD`**
→ Coingecko sometimes rate-limits. Ganti `PRICE_SOURCE_URL` ke endpoint lain yang return JSON dengan field `ethereum.usd` atau pakai Coinbase/Binance API.

**Volume trigger ga fire padahal volume kelihatan tinggi**
→ Bot ukur dari `tx.value` pas ada Transfer log. Kalo volume di aggregator (bukan buy langsung dari pool), mungkin ga ke-detect. Turunin threshold atau tambahin window.

---

## 🧠 Flow lengkap

```
[discovering]  →  watch Pons factory, decode address dari semua topics
                  verify via symbol() → NIMORI? lock in.
                  📱 TG: "🎯 NIMORI discovered"
     ↓
[bonding-curve] →  arm 2 watchers paralel:
                   • graduation watch (V4 PoolManager + Pons hook + factory)
                   • volume watch (Transfer events, USD threshold)
     ↓
     ├─ migration event detected
     │  📱 TG: "🔥 Trigger: migration"
     │  → snipe via GMGN router (auto post-grad path)
     │  📱 TG: "✅ Entry EXECUTED"
     │
     └─ volume spike ≥ $12,500 in 60s
        📱 TG: "🔥 Trigger: volume spike"
        → snipe via GMGN router
        📱 TG: "✅ Entry EXECUTED"
     ↓
[sniped]       →  idle, log final balance, TG terakhir dengan tx hash + explorer link
```

---

## 🛡️ Safety

- Priv key cuma di `.env` di mesin lu. `.gitignore` udah set, ga pernah ke-commit.
- GMGN CLI sign lokal — key ga pernah dikirim ke server GMGN.
- `MAX_TOTAL_SPEND_ETH` hard cap total spending.
- Pre-flight gas estimate (DIRECT route) auto-skip tx yang bakal revert.
- `DRY_RUN=true` default — HARUS test dulu sebelum live.

**JANGAN:**
- Pake wallet utama lu — bikin wallet khusus bot, transfer secukupnya.
- Set `MAX_TOTAL_SPEND_ETH` di atas balance wallet.
- Commit `.env` ke git (udah di-ignore sih, tapi tetep hati-hati).

---

## 📁 Struktur

```
src/
├── index.ts          # orchestrator
├── config.ts         # env loader
├── chain.ts          # viem clients
├── discovery.ts      # watch factory, symbol() filter
├── graduation.ts     # multi-source grad detection
├── volume.ts         # USD rolling window
├── sniper.ts         # execution dispatcher (GMGN or DIRECT)
├── gmgn.ts           # gmgn-cli subprocess wrapper
├── telegram.ts       # notif helpers
├── price.ts          # ETH/USD feed
├── state.ts          # phase + flags
├── log.ts            # structured logger
└── abi/
    ├── erc20.ts
    ├── pons.ts
    └── uniswap-v4.ts
```

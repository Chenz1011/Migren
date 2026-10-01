# Migren — NIMORI sniper (Pons / Robinhood Chain)

Bot buat snipe `$NIMORI` di [Pons launchpad](https://www.ponsfamily.com/launchpad)
di Robinhood Chain (chain id `4663`). Dua trigger:

1. **Migration** — begitu NIMORI graduate dari bonding curve ke Uniswap V4 pool → beli.
2. **Volume spike** — kalo rolling volume (ETH masuk via buy tx) di NIMORI
   nembus threshold dalam window waktu tertentu → beli.

## Prereq

- Node.js 20+
- Wallet dengan ETH di Robinhood Chain (buat beli + bayar gas)
- RPC WebSocket (opsional tapi WAJIB kalo mau latency rendah).
  Public endpoint `wss://rpc.mainnet.chain.robinhood.com` biasanya cukup
  untuk test; buat production pakai dedicated (QuickNode / Chainstack / Dwellir / dRPC).

## Setup

```bash
# clone & masuk
git clone <this-repo> migren
cd migren

# install
npm install

# config
cp .env.example .env
# edit .env, isi minimal: PRIVATE_KEY, RPC_WS_URL, BUY_SIZE_ETH

# jalankan dalam DRY_RUN mode dulu (default: true)
npm start

# kalo semua udah logging bener, matikan dry-run di .env:
#   DRY_RUN=false
# lalu restart
npm start
```

## Env — apa yang perlu lu isi

Yang **wajib** diisi manual:

| Variable | Keterangan |
|---|---|
| `PRIVATE_KEY` | Priv key wallet lu, 0x + 64 hex. **Jangan commit**. |
| `BUY_SIZE_ETH` | Jumlah ETH per snipe (contoh: `0.05`). |
| `VOLUME_SPIKE_ETH` | Threshold volume (ETH) buat trigger spike. Default 1 ETH / 60s. |
| `MAX_TOTAL_SPEND_ETH` | Fail-safe total cap selama bot jalan. |

Yang **opsional tapi recommended**:

| Variable | Keterangan |
|---|---|
| `RPC_WS_URL` | WebSocket RPC. Tanpa ini, bot fallback ke polling (lambat). |
| `UNISWAP_V4_POOL_MANAGER` | V4 PoolManager address. Dibutuhkan buat deteksi graduation paling cepet. |
| `UNIVERSAL_ROUTER` | Universal Router address. Dibutuhkan buat post-graduation swap. |
| `WETH_ADDRESS` | WETH di Robinhood Chain. Dibutuhkan buat V4 swap path. |
| `TARGET_TOKEN_ADDRESS` | Kalo lu udah tau address NIMORI, isi langsung — skip discovery. |

Pons V2 factory/router/hook sudah di-prefill (per 2026-10). Ganti kalo Pons re-deploy.

**GMGN API: ga wajib.** Default `GMGN_ENABLED=false`. Direct-chain execution
lewat viem lebih kenceng dan ga ada API dependency. Modul `src/gmgn.ts` ada
sebagai placeholder kalo lu mau fallback.

## Priv key — perlu ga?

**Perlu**, kalo mau snipe beneran. Dua alasan:
- Direct on-chain execution butuh signer buat ngirim tx.
- GMGN Agent API pun ujung-ujungnya tetep perlu signer (bot ini sign
  lokal; GMGN cuma dipake buat quote/build-tx).

Priv key cuma hidup di process ini (via `.env`) dan ga pernah dikirim keluar.
Pastikan `.env` ada di `.gitignore` (udah di-set).

## Flow bot

```
[discovering]  →  watch Pons factory, filter candidate addresses by symbol()
     ↓   (symbol == NIMORI)
[bonding-curve] →  arm migration watcher + volume watcher
     ↓
     ├─ migration event → snipe via PonsLaunchAndBuy  (if phase=curve)
     │                   atau Universal Router V4     (if phase=graduated)
     └─ volume spike   → same as above
     ↓
[sniped]       →  idle, log final balance
```

## Safety checklist

- [ ] `DRY_RUN=true` dulu sampai lu liat log "token locked in" dan simulated snipe
- [ ] `MAX_TOTAL_SPEND_ETH` di-set wajar (jangan all-in)
- [ ] Wallet khusus bot, bukan main wallet lu
- [ ] `.env` tidak pernah di-commit (`.gitignore` udah handle)
- [ ] Pre-flight gas estimate otomatis — tx yang bakal revert di-skip (ga buang gas)

## Hal yang masih manual / fragile

- **Exact Pons event signatures** tidak dipublish. Bot ini resilient karena
  decode address dari semua topics dan verify via `symbol()` — tapi kalo
  Pons mengubah schema, perbaiki filter di `src/discovery.ts`.
- **Universal Router V4 payload** di `src/sniper.ts` disusun generik; kalo
  revert, cek dengan tx simulator (Tenderly fork Robinhood Chain) buat
  liat selector/argumen yang bener. Pre-flight estimate otomatis skip
  kalo bakal revert, jadi lu ga rugi gas — cuma snipe-nya ga eksekusi.
- **NIMORI belum deploy** per 2026-10. Bot stays in `discovering` phase
  sampai ada token dengan symbol "NIMORI" muncul dari Pons factory.

## Monitor dari jauh

```bash
# tail log
LOG_LEVEL=debug npm start | tee migren.log

# atau pake tmux / screen biar tetap jalan
tmux new -s migren
npm start
# Ctrl+b d  → detach
# tmux attach -t migren
```

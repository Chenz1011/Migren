import { config } from './config.js';
import { logStartup, httpClient, account } from './chain.js';
import { log } from './log.js';
import { state } from './state.js';
import { discoverLoop } from './discovery.js';
import { watchGraduation } from './graduation.js';
import { watchVolume } from './volume.js';
import { snipe } from './sniper.js';
import { formatEther } from 'viem';
import { startPriceFeed, getEthUsd } from './price.js';
import { tg } from './telegram.js';

async function main() {
  log.info('========================================');
  log.info('  Migren — NIMORI sniper on Pons');
  log.info('========================================');
  logStartup();

  if (config.executionRoute === 'GMGN' && !config.gmgnApiKey) {
    log.error('EXECUTION_ROUTE=GMGN tapi GMGN_API_KEY kosong. Isi .env dulu.');
    process.exit(1);
  }

  try {
    const bal = await httpClient.getBalance({ address: account.address });
    log.info('wallet balance', { eth: formatEther(bal) });
    if (bal < config.buySizeWei) {
      log.warn('wallet balance below BUY_SIZE_ETH', {
        balance: formatEther(bal),
        buySize: formatEther(config.buySizeWei),
      });
    }
  } catch (e: any) {
    log.warn('could not fetch wallet balance (RPC slow or down) — bot keeps running', {
      err: e?.shortMessage ?? e?.message ?? String(e),
    });
    log.warn('tip: isi RPC_HTTP_URL + RPC_WS_URL dari provider dedicated (QuickNode / Dwellir / dRPC) di .env');
  }

  await startPriceFeed();

  log.info('config summary', {
    route: config.executionRoute,
    ticker: config.targetTicker,
    buySizeEth: formatEther(config.buySizeWei),
    triggers: {
      migration: config.triggerOnMigration,
      volumeSpike: config.triggerOnVolumeSpike,
      volumeThresholdUsd: config.volumeSpikeUsd,
      volumeWindowSec: config.volumeWindowSec,
    },
    ethUsd: getEthUsd() || '(pending)',
    dryRun: config.dryRun,
    maxTotalSpendEth: formatEther(config.maxTotalSpendWei),
    telegram: config.telegramBotToken ? 'enabled' : 'disabled',
  });

  await tg.startup(
    account.address,
    config.targetTicker,
    formatEther(config.buySizeWei),
    config.executionRoute,
  );

  if (config.dryRun) {
    log.warn('⚠️  DRY_RUN=true — tx NOT akan di-submit. Set DRY_RUN=false pas lu udah siap.');
  }

  await discoverLoop(async (token) => {
    log.info('token locked in, starting watchers', { token });
    void tg.discovery(token, config.targetTicker);

    const triggerSnipe = async (reason: 'migration' | 'volume') => {
      if (state.phase === 'sniped' || state.phase === 'exhausted') {
        log.info('already sniped, ignoring additional trigger', { reason });
        return;
      }
      await snipe(reason);
    };

    const tasks: Promise<void>[] = [];

    if (config.triggerOnMigration) {
      tasks.push(
        watchGraduation(() => {
          if (!state.migrationTriggered) {
            state.migrationTriggered = true;
            void tg.trigger('migration', 'NIMORI graduated from bonding curve → Uniswap V4');
            void triggerSnipe('migration');
          }
        }),
      );
    }

    if (config.triggerOnVolumeSpike) {
      tasks.push(
        watchVolume(() => {
          void triggerSnipe('volume');
        }),
      );
    }

    await Promise.all(tasks);
    log.info('all watchers armed');
  });

  await new Promise(() => {});
}

main().catch((e) => {
  log.error('fatal', { err: e?.message ?? String(e) });
  void tg.error('main', e?.message ?? String(e));
  setTimeout(() => process.exit(1), 1000).unref();
});

process.on('SIGINT', () => {
  log.info('shutting down (SIGINT)');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log.info('shutting down (SIGTERM)');
  process.exit(0);
});

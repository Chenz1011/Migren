import { config } from './config.js';
import { logStartup, httpClient, account } from './chain.js';
import { log } from './log.js';
import { state } from './state.js';
import { discoverLoop } from './discovery.js';
import { watchGraduation } from './graduation.js';
import { watchVolume } from './volume.js';
import { snipe } from './sniper.js';
import { formatEther } from 'viem';

async function main() {
  log.info('========================================');
  log.info('  Migren — NIMORI sniper on Pons');
  log.info('========================================');
  logStartup();

  // Pre-flight balance check so you know gas is covered.
  const bal = await httpClient.getBalance({ address: account.address });
  log.info('wallet balance', { eth: formatEther(bal) });
  if (bal < config.buySizeWei) {
    log.warn('wallet balance below BUY_SIZE_ETH', {
      balance: formatEther(bal),
      buySize: formatEther(config.buySizeWei),
    });
  }

  log.info('config', {
    ticker: config.targetTicker,
    buySizeEth: formatEther(config.buySizeWei),
    maxSlippageBps: Number(config.maxSlippageBps),
    triggers: {
      migration: config.triggerOnMigration,
      volumeSpike: config.triggerOnVolumeSpike,
      volumeThresholdEth: formatEther(config.volumeSpikeWei),
      volumeWindowSec: config.volumeWindowSec,
    },
    dryRun: config.dryRun,
    maxTotalSpendEth: formatEther(config.maxTotalSpendWei),
  });

  if (config.dryRun) {
    log.warn('⚠️  DRY_RUN=true — no real tx will be submitted. Set DRY_RUN=false in .env when you are ready.');
  }

  await discoverLoop(async (token) => {
    log.info('token locked in, starting watchers', { token });

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

  // Keep process alive forever; event watchers run on their own timers.
  await new Promise(() => {});
}

main().catch((e) => {
  log.error('fatal', { err: e?.message ?? String(e) });
  process.exit(1);
});

process.on('SIGINT', () => {
  log.info('shutting down (SIGINT)');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log.info('shutting down (SIGTERM)');
  process.exit(0);
});

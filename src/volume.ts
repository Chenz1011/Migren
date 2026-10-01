import { type Hex, keccak256, toBytes, formatEther } from 'viem';
import { wsClient } from './chain.js';
import { config } from './config.js';
import { log } from './log.js';
import { state } from './state.js';
import { ethWeiToUsd, getEthUsd } from './price.js';
import { tg } from './telegram.js';

const TRANSFER_TOPIC = keccak256(toBytes('Transfer(address,address,uint256)'));

type Buy = { ts: number; wei: bigint };
const windowBuys: Buy[] = [];

function prune(nowSec: number) {
  const cutoff = nowSec - config.volumeWindowSec;
  while (windowBuys.length && windowBuys[0].ts < cutoff) windowBuys.shift();
}

function windowSumWei(): bigint {
  let s = 0n;
  for (const b of windowBuys) s += b.wei;
  return s;
}

export async function watchVolume(onSpike: () => void): Promise<void> {
  if (!state.token) throw new Error('watchVolume called before token discovered');
  const token = state.token;

  const seenTx = new Set<string>();

  const unwatch = wsClient.watchEvent({
    address: token,
    event: {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { indexed: true, name: 'from', type: 'address' },
        { indexed: true, name: 'to', type: 'address' },
        { indexed: false, name: 'value', type: 'uint256' },
      ],
    },
    onLogs: async (logs) => {
      const nowSec = Math.floor(Date.now() / 1000);
      prune(nowSec);

      for (const l of logs) {
        if (l.topics[0] !== TRANSFER_TOPIC) continue;
        const txHash = l.transactionHash;
        if (!txHash || seenTx.has(txHash)) continue;
        seenTx.add(txHash);

        try {
          const tx = await wsClient.getTransaction({ hash: txHash as Hex });
          if (tx.value > 0n) {
            windowBuys.push({ ts: nowSec, wei: tx.value });
            const sumWei = windowSumWei();
            const sumUsd = ethWeiToUsd(sumWei);
            log.debug('buy observed', {
              tx: txHash,
              valueEth: formatEther(tx.value),
              windowEth: formatEther(sumWei),
              windowUsd: sumUsd.toFixed(2),
              ethUsd: getEthUsd(),
            });

            if (
              sumUsd >= config.volumeSpikeUsd &&
              !state.volumeTriggered &&
              getEthUsd() > 0
            ) {
              log.info('🔥 volume spike detected', {
                windowUsd: sumUsd.toFixed(2),
                thresholdUsd: config.volumeSpikeUsd,
                windowSec: config.volumeWindowSec,
              });
              state.volumeTriggered = true;
              void tg.trigger(
                'volume spike',
                `$${sumUsd.toFixed(0)} in ${config.volumeWindowSec}s (threshold $${config.volumeSpikeUsd})`,
              );
              onSpike();
              unwatch();
              return;
            }
          }
        } catch {
          log.debug('failed to fetch tx for volume', { tx: txHash });
        }
      }
    },
    onError: (err) => log.warn('volume watch error', { err: err.message }),
  });

  log.info('watching volume on token', {
    token,
    windowSec: config.volumeWindowSec,
    thresholdUsd: config.volumeSpikeUsd,
  });
}

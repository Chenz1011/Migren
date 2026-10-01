import { type Hex, keccak256, toBytes, formatEther } from 'viem';
import { wsClient } from './chain.js';
import { config } from './config.js';
import { log } from './log.js';
import { state } from './state.js';

const TRANSFER_TOPIC = keccak256(toBytes('Transfer(address,address,uint256)'));

type Buy = { ts: number; wei: bigint };
const window: Buy[] = [];

function prune(nowSec: number) {
  const cutoff = nowSec - config.volumeWindowSec;
  while (window.length && window[0].ts < cutoff) window.shift();
}

function windowSumWei(): bigint {
  let s = 0n;
  for (const b of window) s += b.wei;
  return s;
}

export async function watchVolume(onSpike: () => void): Promise<void> {
  if (!state.token) throw new Error('watchVolume called before token discovered');
  const token = state.token;

  // Approach: watch Transfer events on the TARGET token. Any Transfer where
  // `from` is the bonding-curve/hook/pool-ish contract and `to` is a user
  // wallet is a BUY. We approximate the ETH value by reading tx.value from
  // the same transaction. Reading tx per log is a cost, so we batch per tx.
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
            window.push({ ts: nowSec, wei: tx.value });
            const sum = windowSumWei();
            log.debug('buy observed', {
              tx: txHash,
              valueEth: formatEther(tx.value),
              windowEth: formatEther(sum),
            });
            if (sum >= config.volumeSpikeWei && !state.volumeTriggered) {
              log.info('🔥 volume spike detected', {
                windowEth: formatEther(sum),
                thresholdEth: formatEther(config.volumeSpikeWei),
                windowSec: config.volumeWindowSec,
              });
              state.volumeTriggered = true;
              onSpike();
              unwatch();
              return;
            }
          }
        } catch (e) {
          log.debug('failed to fetch tx for volume', { tx: txHash });
        }
      }
    },
    onError: (err) => log.warn('volume watch error', { err: err.message }),
  });

  log.info('watching volume on token', {
    token,
    windowSec: config.volumeWindowSec,
    thresholdEth: formatEther(config.volumeSpikeWei),
  });
}

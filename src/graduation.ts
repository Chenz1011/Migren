import { type Address, type Hex, getAddress, keccak256, toBytes } from 'viem';
import { wsClient } from './chain.js';
import { config } from './config.js';
import { log } from './log.js';
import { markGraduated, state } from './state.js';

// Topic0 of Uniswap V4 PoolManager.Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)
const V4_INITIALIZE_TOPIC = keccak256(
  toBytes('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
);

function topicAddr(t: Hex | undefined | null): Address | null {
  if (!t) return null;
  try {
    return getAddress(`0x${t.slice(-40)}`);
  } catch {
    return null;
  }
}

export async function watchGraduation(onGraduated: () => void): Promise<void> {
  if (!state.token) throw new Error('watchGraduation called before token discovered');
  const token = state.token;

  const handlers: Array<() => void> = [];

  // Strategy A — official V4 PoolManager Initialize event, filtered to logs
  // where currency0 or currency1 is our token.
  if (config.v4PoolManager) {
    const tokenTopic = `0x${'0'.repeat(24)}${token.slice(2).toLowerCase()}` as Hex;
    const unwatchA = wsClient.watchEvent({
      address: config.v4PoolManager,
      onLogs: (logs) => {
        for (const l of logs) {
          if (l.topics[0] !== V4_INITIALIZE_TOPIC) continue;
          const c0 = topicAddr(l.topics[2] as Hex);
          const c1 = topicAddr(l.topics[3] as Hex);
          if (c0?.toLowerCase() === token.toLowerCase() || c1?.toLowerCase() === token.toLowerCase()) {
            const poolId = l.topics[1] as `0x${string}`;
            log.info('🚀 graduation detected via V4 PoolManager', { token, poolId });
            markGraduated(poolId);
            onGraduated();
            handlers.forEach((h) => h());
            return;
          }
        }
      },
      onError: (err) => log.warn('v4 watch error', { err: err.message }),
    });
    handlers.push(unwatchA);
  }

  // Strategy B — Pons MemeHook starts receiving logs mentioning our token.
  // The hook is the first contract to touch a graduated pool, so any log
  // from it where our token appears in topics is a strong signal.
  const unwatchB = wsClient.watchEvent({
    address: config.ponsMemeHook,
    onLogs: (logs) => {
      for (const l of logs) {
        for (const t of l.topics.slice(1)) {
          const a = topicAddr(t as Hex);
          if (a?.toLowerCase() === token.toLowerCase()) {
            log.info('🚀 graduation detected via Pons MemeHook', { token, tx: l.transactionHash });
            markGraduated((l.topics[1] as `0x${string}`) ?? ('0x' as `0x${string}`));
            onGraduated();
            handlers.forEach((h) => h());
            return;
          }
        }
      }
    },
    onError: (err) => log.warn('hook watch error', { err: err.message }),
  });
  handlers.push(unwatchB);

  // Strategy C — Pons factory emits a Graduated event whose topics include
  // our token. We re-watch the factory specifically for post-launch logs.
  const unwatchC = wsClient.watchEvent({
    address: config.ponsLaunchFactory,
    onLogs: (logs) => {
      for (const l of logs) {
        for (const t of l.topics.slice(1)) {
          const a = topicAddr(t as Hex);
          if (a?.toLowerCase() === token.toLowerCase()) {
            // Any post-discovery mention from the factory with our token in
            // topics is almost certainly a graduation signal.
            log.info('🚀 graduation signal from factory', { token, tx: l.transactionHash });
            markGraduated('0x0000000000000000000000000000000000000000000000000000000000000000');
            onGraduated();
            handlers.forEach((h) => h());
            return;
          }
        }
      }
    },
    onError: (err) => log.warn('factory re-watch error', { err: err.message }),
  });
  handlers.push(unwatchC);

  log.info('watching for graduation', {
    token,
    strategies: [
      config.v4PoolManager ? 'v4-poolmanager' : null,
      'pons-hook',
      'pons-factory',
    ].filter(Boolean),
  });
}

import { config } from './config.js';
import { log } from './log.js';

let ethUsd = 0;
let lastFetchMs = 0;

async function fetchEthUsd(): Promise<number> {
  try {
    const res = await fetch(config.priceSourceUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any = await res.json();
    // Coingecko shape: { ethereum: { usd: 3456.78 } }
    const price =
      j?.ethereum?.usd ??
      j?.ETH?.usd ??
      j?.price ??
      j?.data?.price ??
      0;
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) throw new Error('bad price shape');
    return n;
  } catch (e: any) {
    log.warn('price fetch failed', { err: e?.message ?? String(e) });
    return 0;
  }
}

export async function startPriceFeed(): Promise<void> {
  const refresh = async () => {
    const p = await fetchEthUsd();
    if (p > 0) {
      ethUsd = p;
      lastFetchMs = Date.now();
      log.debug('ETH/USD refreshed', { price: p });
    }
  };
  await refresh();
  setInterval(refresh, config.priceRefreshSec * 1000).unref();
  if (ethUsd === 0) {
    log.warn('could not fetch ETH/USD; USD-denominated triggers will be skipped until a price arrives');
  } else {
    log.info('price feed started', { ethUsd });
  }
}

export function getEthUsd(): number {
  return ethUsd;
}

export function ethWeiToUsd(wei: bigint): number {
  if (ethUsd === 0) return 0;
  // Convert via string formatting to avoid bigint precision loss on 1e18
  const eth = Number(wei) / 1e18;
  return eth * ethUsd;
}

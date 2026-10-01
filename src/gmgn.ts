// Optional execution route via GMGN Agent API.
//
// WARNING: GMGN's docs are behind an egress-blocked domain in this sandbox,
// so this module is scaffolded with the common patterns but you'll need to
// confirm the exact endpoint, request body shape, and auth header against
// https://docs.gmgn.ai/index/gmgn-agent-api before enabling it.
//
// Typical flow for a chain like Robinhood:
//   1) GET /quote?chain=robinhood&tokenIn=ETH&tokenOut=<token>&amount=<wei>
//   2) GET /tx?... → returns an unsigned tx (to, data, value)
//   3) Sign locally with the same PRIVATE_KEY and submit via your RPC.
//
// We intentionally sign and submit locally rather than handing GMGN the
// private key.

import { type Address, type Hex } from 'viem';
import { config } from './config.js';
import { log } from './log.js';
import { httpClient, wallet, account, robinhoodChain } from './chain.js';

type Quote = { to: Address; data: Hex; value: bigint; estimatedOut: bigint };

export async function gmgnQuote(_token: Address, _amountWei: bigint): Promise<Quote | null> {
  if (!config.gmgnEnabled) return null;
  if (!config.gmgnApiKey) {
    log.warn('GMGN enabled but GMGN_API_KEY not set');
    return null;
  }

  // PLACEHOLDER — adapt once you've read the real GMGN docs:
  //   const url = `${config.gmgnBaseUrl}/robinhood/swap?...`;
  //   const res = await fetch(url, { headers: { Authorization: `Bearer ${config.gmgnApiKey}` } });
  //   const j = await res.json();
  //   return { to: j.to, data: j.data, value: BigInt(j.value), estimatedOut: BigInt(j.outAmount) };
  log.warn('gmgnQuote is a placeholder — fill in endpoint in src/gmgn.ts');
  return null;
}

export async function gmgnSwap(token: Address, amountWei: bigint): Promise<Hex | null> {
  const q = await gmgnQuote(token, amountWei);
  if (!q) return null;

  if (config.dryRun) {
    log.info('🧪 DRY_RUN — not submitting GMGN tx', { to: q.to });
    return null;
  }

  const hash = await wallet.sendTransaction({
    account,
    chain: robinhoodChain,
    to: q.to,
    data: q.data,
    value: q.value,
    maxFeePerGas: config.maxFeeWei,
    maxPriorityFeePerGas: config.priorityFeeWei,
  });
  log.info('GMGN tx submitted', { hash });
  return hash;
}

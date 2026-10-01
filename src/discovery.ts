import { type Address, type Hex, getAddress } from 'viem';
import { httpClient, wsClient } from './chain.js';
import { config } from './config.js';
import { log } from './log.js';
import { erc20Abi } from './abi/erc20.js';
import { setToken, state } from './state.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const seen = new Set<string>();

function topicToAddress(topic: Hex | null | undefined): Address | null {
  if (!topic || topic === '0x') return null;
  // address is right-aligned in a 32-byte topic
  const hex = topic.slice(-40);
  const addr = `0x${hex}` as const;
  if (addr === ZERO) return null;
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

async function checkSymbol(token: Address): Promise<string | null> {
  try {
    const sym = await httpClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'symbol',
    });
    return typeof sym === 'string' ? sym : null;
  } catch {
    return null;
  }
}

async function evaluateCandidate(token: Address, source: string): Promise<boolean> {
  if (seen.has(token.toLowerCase())) return false;
  seen.add(token.toLowerCase());

  const sym = await checkSymbol(token);
  if (!sym) {
    log.debug('candidate not an ERC20 (no symbol)', { token, source });
    return false;
  }
  log.debug('candidate token', { token, symbol: sym, source });

  if (sym.toUpperCase() !== config.targetTicker) return false;

  log.info('🎯 target ticker found', { token, symbol: sym, source });
  setToken(token, null);
  return true;
}

export async function discoverLoop(onFound: (token: Address) => void): Promise<void> {
  if (config.targetTokenAddress) {
    log.info('target token pre-configured, skipping discovery', {
      token: config.targetTokenAddress,
    });
    setToken(config.targetTokenAddress, null);
    onFound(config.targetTokenAddress);
    return;
  }

  log.info('watching Pons factory for new launches', {
    factory: config.ponsLaunchFactory,
    ticker: config.targetTicker,
  });

  const client = wsClient;
  const unwatch = client.watchEvent({
    address: config.ponsLaunchFactory,
    onLogs: async (logs) => {
      for (const l of logs) {
        // Try every indexed topic as a candidate address — covers unknown
        // event schemas by brute-forcing anything that could be a token addr.
        const candidates: Address[] = [];
        for (const t of l.topics.slice(1)) {
          const a = topicToAddress(t as Hex);
          if (a) candidates.push(a);
        }
        for (const token of candidates) {
          if (state.phase !== 'discovering') return;
          const ok = await evaluateCandidate(token, `factory:${l.transactionHash}`);
          if (ok) {
            unwatch();
            onFound(token);
            return;
          }
        }
      }
    },
    onError: (err) => log.warn('factory watch error', { err: err.message }),
  });
}

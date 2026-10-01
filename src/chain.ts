import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  webSocket,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config.js';
import { log } from './log.js';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [config.rpcHttp], webSocket: config.rpcWs ? [config.rpcWs] : undefined },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

export const account = privateKeyToAccount(config.privateKey);

export const httpClient: PublicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(config.rpcHttp, {
    batch: true,
    timeout: 30_000,
    retryCount: 3,
    retryDelay: 500,
  }),
});

export const wsClient: PublicClient = config.rpcWs
  ? createPublicClient({
      chain: robinhoodChain,
      transport: webSocket(config.rpcWs, { reconnect: { attempts: 20, delay: 1_000 } }),
    })
  : httpClient;

export const wallet: WalletClient = createWalletClient({
  account,
  chain: robinhoodChain,
  transport: http(config.rpcHttp, { timeout: 30_000, retryCount: 3, retryDelay: 500 }),
});

export function logStartup() {
  log.info('wallet ready', { address: account.address });
  log.info('rpc', { http: config.rpcHttp, ws: config.rpcWs || '(polling fallback)' });
}

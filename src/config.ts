import 'dotenv/config';
import { type Address, isAddress, getAddress, parseEther, parseGwei } from 'viem';

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing required env: ${name}`);
  return v.trim();
}

function opt(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

function bool(name: string, fallback = false): boolean {
  const v = opt(name);
  if (!v) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

function num(name: string, fallback: number): number {
  const v = opt(name);
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number in ${name}: ${v}`);
  return n;
}

function addr(name: string): Address {
  const v = req(name);
  if (!isAddress(v)) throw new Error(`Invalid address in ${name}: ${v}`);
  const checked = getAddress(v);
  if (checked === '0x0000000000000000000000000000000000000000') {
    throw new Error(`${name} is zero address — set it in .env`);
  }
  return checked;
}

function addrOpt(name: string): Address | null {
  const v = opt(name);
  if (!v) return null;
  if (!isAddress(v)) throw new Error(`Invalid address in ${name}: ${v}`);
  const checked = getAddress(v);
  if (checked === '0x0000000000000000000000000000000000000000') return null;
  return checked;
}

const privKeyRaw = req('PRIVATE_KEY');
const privateKey = (privKeyRaw.startsWith('0x') ? privKeyRaw : `0x${privKeyRaw}`) as `0x${string}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('PRIVATE_KEY must be 32-byte hex (0x + 64 chars)');
}

const execRoute = opt('EXECUTION_ROUTE', 'GMGN').toUpperCase();
if (execRoute !== 'GMGN' && execRoute !== 'DIRECT') {
  throw new Error(`EXECUTION_ROUTE must be GMGN or DIRECT, got: ${execRoute}`);
}

export const config = {
  privateKey,

  executionRoute: execRoute as 'GMGN' | 'DIRECT',

  gmgnApiKey: opt('GMGN_API_KEY'),
  gmgnChain: opt('GMGN_CHAIN', 'robinhood'),
  gmgnAntiMev: bool('GMGN_ANTI_MEV', true),
  gmgnAutoSlippage: bool('GMGN_AUTO_SLIPPAGE', true),

  rpcHttp: opt('RPC_HTTP_URL', 'https://rpc.mainnet.chain.robinhood.com'),
  rpcWs: opt('RPC_WS_URL'),

  targetTicker: opt('TARGET_TICKER', 'NIMORI').toUpperCase(),
  targetTokenAddress: addrOpt('TARGET_TOKEN_ADDRESS'),

  buySizeWei: parseEther(opt('BUY_SIZE_ETH', '0.075')),
  maxSlippageBps: BigInt(num('MAX_SLIPPAGE_BPS', 1500)),

  priorityFeeWei: parseGwei(opt('PRIORITY_FEE_GWEI', '0.5')),
  maxFeeWei: parseGwei(opt('MAX_FEE_GWEI', '5')),

  triggerOnMigration: bool('TRIGGER_ON_MIGRATION', true),
  triggerOnVolumeSpike: bool('TRIGGER_ON_VOLUME_SPIKE', true),
  volumeWindowSec: num('VOLUME_WINDOW_SECONDS', 60),
  volumeSpikeUsd: num('VOLUME_SPIKE_USD', 12_500),

  dryRun: bool('DRY_RUN', true),
  maxTotalSpendWei: parseEther(opt('MAX_TOTAL_SPEND_ETH', '0.5')),

  telegramBotToken: opt('TELEGRAM_BOT_TOKEN'),
  telegramChatId: opt('TELEGRAM_CHAT_ID'),
  tgNotifyDiscovery: bool('TELEGRAM_NOTIFY_ON_DISCOVERY', true),
  tgNotifyTrigger: bool('TELEGRAM_NOTIFY_ON_TRIGGER', true),
  tgNotifyExecute: bool('TELEGRAM_NOTIFY_ON_EXECUTE', true),

  ponsLaunchFactory: addr('PONS_LAUNCH_FACTORY'),
  ponsLaunchAndBuy: addr('PONS_LAUNCH_AND_BUY'),
  ponsMemeHook: addr('PONS_MEME_HOOK'),
  v4PoolManager: addrOpt('UNISWAP_V4_POOL_MANAGER'),
  universalRouter: addrOpt('UNIVERSAL_ROUTER'),
  weth: addrOpt('WETH_ADDRESS'),

  priceSourceUrl: opt(
    'PRICE_SOURCE_URL',
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
  ),
  priceRefreshSec: num('PRICE_REFRESH_SECONDS', 120),

  logLevel: opt('LOG_LEVEL', 'info'),
} as const;

export type Config = typeof config;

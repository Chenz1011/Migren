// GMGN execution route — shells out to `npx gmgn-cli` so we never touch the
// GMGN HTTP endpoints directly (which change) and we never leak the private
// key beyond the local machine (gmgn-cli signs locally).
//
// gmgn-cli reads two env vars:
//   GMGN_API_KEY       — for authenticated requests
//   GMGN_PRIVATE_KEY   — for local signing (same wallet)
//
// This module is called by sniper.ts when EXECUTION_ROUTE=GMGN.

import { spawn } from 'node:child_process';
import { type Address, formatEther, parseUnits } from 'viem';
import { account } from './chain.js';
import { config } from './config.js';
import { log } from './log.js';

type SwapResult = { ok: boolean; txHash?: string; stdout: string; stderr: string };

const NATIVE_ETH_SENTINEL = '0x0000000000000000000000000000000000000000';

function runGmgnCli(args: string[]): Promise<SwapResult> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['-y', 'gmgn-cli', ...args], {
      env: {
        ...process.env,
        GMGN_API_KEY: config.gmgnApiKey,
        GMGN_PRIVATE_KEY: config.privateKey,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => {
      const s = c.toString();
      stdout += s;
      log.debug('[gmgn-cli stdout]', { line: s.trim() });
    });
    proc.stderr.on('data', (c) => {
      const s = c.toString();
      stderr += s;
      log.debug('[gmgn-cli stderr]', { line: s.trim() });
    });

    proc.on('close', (code) => {
      // Try to extract tx hash from stdout (CLI usually prints "0x..." hash on success)
      const m = stdout.match(/0x[0-9a-fA-F]{64}/);
      const txHash = m ? m[0] : undefined;
      resolve({ ok: code === 0, txHash, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ ok: false, stdout, stderr: stderr + '\n' + err.message });
    });
  });
}

export async function gmgnSwapEthToToken(opts: {
  token: Address;
  amountWei: bigint;
}): Promise<SwapResult> {
  if (!config.gmgnApiKey) {
    const msg = 'GMGN_API_KEY not set — fill it in .env';
    log.error(msg);
    return { ok: false, stdout: '', stderr: msg };
  }

  const args = [
    'swap',
    '--chain', config.gmgnChain,
    '--from', account.address,
    '--input-token', NATIVE_ETH_SENTINEL, // native ETH
    '--output-token', opts.token,
    '--amount', opts.amountWei.toString(),
  ];

  if (config.gmgnAutoSlippage) {
    args.push('--auto-slippage');
  } else {
    // CLI expects slippage as percent (float), bps/100
    args.push('--slippage', (Number(config.maxSlippageBps) / 100).toString());
  }
  if (config.gmgnAntiMev) args.push('--anti-mev');

  log.info('executing GMGN swap', {
    chain: config.gmgnChain,
    token: opts.token,
    amountEth: formatEther(opts.amountWei),
    antiMev: config.gmgnAntiMev,
    autoSlippage: config.gmgnAutoSlippage,
  });

  if (config.dryRun) {
    log.info('🧪 DRY_RUN — would exec: npx gmgn-cli ' + args.join(' '));
    return { ok: true, stdout: '[dry-run]', stderr: '' };
  }

  const res = await runGmgnCli(args);
  if (res.ok) {
    log.info('✅ GMGN swap submitted', { txHash: res.txHash });
  } else {
    log.error('GMGN swap failed', { stderr: res.stderr.trim().slice(-500) });
  }
  return res;
}

// Dummy to keep parseUnits in the type graph (used elsewhere potentially).
void parseUnits;

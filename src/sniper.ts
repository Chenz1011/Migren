import {
  type Address,
  type Hex,
  encodeFunctionData,
  formatEther,
  encodePacked,
  encodeAbiParameters,
} from 'viem';
import { account, httpClient, wallet, robinhoodChain } from './chain.js';
import { config } from './config.js';
import { log } from './log.js';
import { ponsLaunchAndBuyAbi } from './abi/pons.js';
import { universalRouterAbi } from './abi/uniswap-v4.js';
import { erc20Abi } from './abi/erc20.js';
import { canSpend, markSniped, state } from './state.js';

type Reason = 'migration' | 'volume';

async function currentBalanceOf(token: Address): Promise<bigint> {
  try {
    return (await httpClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    })) as bigint;
  } catch {
    return 0n;
  }
}

async function sendTx(params: {
  to: Address;
  value: bigint;
  data: Hex;
  label: string;
}): Promise<Hex | null> {
  if (config.dryRun) {
    log.info('🧪 DRY_RUN — not submitting tx', {
      label: params.label,
      to: params.to,
      valueEth: formatEther(params.value),
      data: params.data.slice(0, 10) + '…',
    });
    return null;
  }

  if (!canSpend(params.value, config.maxTotalSpendWei)) {
    log.error('safety stop — would exceed MAX_TOTAL_SPEND_ETH', {
      spent: formatEther(state.totalSpentWei),
      want: formatEther(params.value),
      cap: formatEther(config.maxTotalSpendWei),
    });
    return null;
  }

  // Pre-flight gas estimate — if it reverts, bail before paying gas.
  try {
    await httpClient.estimateGas({
      account: account.address,
      to: params.to,
      value: params.value,
      data: params.data,
    });
  } catch (e: any) {
    log.warn('gas estimate failed, tx would revert — skipping', {
      label: params.label,
      err: e?.shortMessage ?? e?.message,
    });
    return null;
  }

  try {
    const nonce = await httpClient.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const hash = await wallet.sendTransaction({
      account,
      chain: robinhoodChain,
      to: params.to,
      value: params.value,
      data: params.data,
      nonce,
      maxFeePerGas: config.maxFeeWei,
      maxPriorityFeePerGas: config.priorityFeeWei,
    });
    log.info('✅ tx submitted', { label: params.label, hash });
    markSniped(params.value);
    return hash;
  } catch (e: any) {
    log.error('tx send failed', { label: params.label, err: e?.shortMessage ?? e?.message });
    return null;
  }
}

function applySlippage(amount: bigint, bps: bigint): bigint {
  // amount * (10000 - bps) / 10000
  return (amount * (10000n - bps)) / 10000n;
}

async function snipeBondingCurve(token: Address, reason: Reason): Promise<void> {
  log.info('attempting bonding-curve snipe via PonsLaunchAndBuy', { token, reason });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60);
  // We don't have an off-chain quote for Pons curves, so set minTokensOut
  // to 1 wei and rely on slippage via BUY_SIZE. A smarter version would
  // query the curve for `getAmountOut`.
  const minOut = 1n;

  const data = encodeFunctionData({
    abi: ponsLaunchAndBuyAbi,
    functionName: 'buy',
    args: [token, minOut, account.address, deadline],
  });

  await sendTx({
    to: config.ponsLaunchAndBuy,
    value: config.buySizeWei,
    data,
    label: `pons-buy:${reason}`,
  });
}

// Build Universal Router payload: V4_SWAP exact-in ETH -> token.
// Universal Router command byte 0x10 = V4_SWAP.
// Inside V4_SWAP: actions=[SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL],
// params=[(poolKey, zeroForOne, amountIn, amountOutMin, hookData), (ETH, amountIn), (token, amountOutMin)].
// This is a best-effort encoder; if the router's command set differs on
// Robinhood Chain, this will revert and gas estimate will catch it.
function buildV4SwapCommand(args: {
  token: Address;
  weth: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  hook: Address;
  fee: number;
  tickSpacing: number;
}): { commands: Hex; inputs: Hex[] } {
  const currency0 = args.token.toLowerCase() < args.weth.toLowerCase() ? args.token : args.weth;
  const currency1 = currency0 === args.token ? args.weth : args.token;
  const zeroForOne = currency0.toLowerCase() === args.weth.toLowerCase();

  // actions bytes: 0x06 SWAP_EXACT_IN_SINGLE, 0x0c SETTLE_ALL, 0x0f TAKE_ALL
  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [0x06, 0x0c, 0x0f]);

  const poolKey = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
    [currency0, currency1, args.fee, args.tickSpacing, args.hook],
  );

  const swapParams = encodeAbiParameters(
    [
      { type: 'bytes' }, // poolKey encoded
      { type: 'bool' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [poolKey, zeroForOne, args.amountIn, args.amountOutMin, '0x'],
  );
  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint128' }],
    [args.weth, args.amountIn],
  );
  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint128' }],
    [args.token, args.amountOutMin],
  );

  const v4SwapPayload = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [actions, [swapParams, settleParams, takeParams]],
  );

  const commands = '0x10' as Hex; // single V4_SWAP command
  return { commands, inputs: [v4SwapPayload] };
}

async function snipeUniswapV4(token: Address, reason: Reason): Promise<void> {
  if (!config.universalRouter || !config.weth) {
    log.warn('post-graduation snipe skipped — UNIVERSAL_ROUTER or WETH_ADDRESS not set');
    return;
  }
  log.info('attempting post-graduation snipe via Universal Router V4', { token, reason });

  const amountIn = config.buySizeWei;
  const amountOutMin = applySlippage(1n, config.maxSlippageBps); // best-effort; real quote needs pool read

  const { commands, inputs } = buildV4SwapCommand({
    token,
    weth: config.weth,
    amountIn,
    amountOutMin,
    hook: config.ponsMemeHook,
    fee: 3000,
    tickSpacing: 60,
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60);
  const data = encodeFunctionData({
    abi: universalRouterAbi,
    functionName: 'execute',
    args: [commands, inputs, deadline],
  });

  await sendTx({
    to: config.universalRouter,
    value: amountIn,
    data,
    label: `v4-buy:${reason}`,
  });
}

export async function snipe(reason: Reason): Promise<void> {
  if (!state.token) {
    log.error('snipe called with no token in state');
    return;
  }
  const token = state.token;

  const prevBalance = await currentBalanceOf(token);
  log.info('🎯 snipe triggered', {
    reason,
    token,
    sizeEth: formatEther(config.buySizeWei),
    phase: state.phase,
    prevBalance: prevBalance.toString(),
  });

  if (state.phase === 'graduated') {
    await snipeUniswapV4(token, reason);
  } else {
    await snipeBondingCurve(token, reason);
  }

  if (!config.dryRun) {
    const newBalance = await currentBalanceOf(token);
    log.info('post-snipe balance', {
      prev: prevBalance.toString(),
      now: newBalance.toString(),
      delta: (newBalance - prevBalance).toString(),
    });
  }
}

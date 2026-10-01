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
import { gmgnSwapEthToToken } from './gmgn.js';
import { tg } from './telegram.js';

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

async function sendDirectTx(params: {
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
  return (amount * (10000n - bps)) / 10000n;
}

async function directBondingCurve(token: Address, reason: Reason): Promise<Hex | null> {
  log.info('direct route: PonsLaunchAndBuy.buy', { token, reason });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60);
  const minOut = 1n;
  const data = encodeFunctionData({
    abi: ponsLaunchAndBuyAbi,
    functionName: 'buy',
    args: [token, minOut, account.address, deadline],
  });
  return sendDirectTx({
    to: config.ponsLaunchAndBuy,
    value: config.buySizeWei,
    data,
    label: `pons-buy:${reason}`,
  });
}

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
      { type: 'bytes' },
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

  const commands = '0x10' as Hex;
  return { commands, inputs: [v4SwapPayload] };
}

async function directUniswapV4(token: Address, reason: Reason): Promise<Hex | null> {
  if (!config.universalRouter || !config.weth) {
    log.warn('direct post-graduation skipped — UNIVERSAL_ROUTER or WETH_ADDRESS not set');
    return null;
  }
  log.info('direct route: Universal Router V4', { token, reason });

  const amountIn = config.buySizeWei;
  const amountOutMin = applySlippage(1n, config.maxSlippageBps);

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

  return sendDirectTx({
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
  const sizeEth = formatEther(config.buySizeWei);

  const prevBalance = await currentBalanceOf(token);
  log.info('🎯 snipe triggered', {
    reason,
    token,
    sizeEth,
    phase: state.phase,
    route: config.executionRoute,
    prevBalance: prevBalance.toString(),
  });

  let txHash: string | undefined;

  if (config.executionRoute === 'GMGN') {
    // GMGN router picks fastest route automatically — pre or post graduation.
    const res = await gmgnSwapEthToToken({ token, amountWei: config.buySizeWei });
    if (res.ok) {
      if (!config.dryRun) markSniped(config.buySizeWei);
      txHash = res.txHash;
    }
  } else {
    // DIRECT route
    const hash =
      state.phase === 'graduated'
        ? await directUniswapV4(token, reason)
        : await directBondingCurve(token, reason);
    if (hash) txHash = hash;
  }

  void tg.execute({ reason, token, sizeEth, txHash, dryRun: config.dryRun });

  if (!config.dryRun) {
    const newBalance = await currentBalanceOf(token);
    log.info('post-snipe balance', {
      prev: prevBalance.toString(),
      now: newBalance.toString(),
      delta: (newBalance - prevBalance).toString(),
    });
  }
}

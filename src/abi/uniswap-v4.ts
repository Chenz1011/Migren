// Uniswap V4 PoolManager — we only need the Initialize event to detect
// graduation (the moment a new pool is created with our target token).
export const v4PoolManagerAbi = [
  {
    type: 'event',
    name: 'Initialize',
    inputs: [
      { indexed: true, name: 'id', type: 'bytes32' },
      { indexed: true, name: 'currency0', type: 'address' },
      { indexed: true, name: 'currency1', type: 'address' },
      { indexed: false, name: 'fee', type: 'uint24' },
      { indexed: false, name: 'tickSpacing', type: 'int24' },
      { indexed: false, name: 'hooks', type: 'address' },
      { indexed: false, name: 'sqrtPriceX96', type: 'uint160' },
      { indexed: false, name: 'tick', type: 'int24' },
    ],
  },
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { indexed: true, name: 'id', type: 'bytes32' },
      { indexed: true, name: 'sender', type: 'address' },
      { indexed: false, name: 'amount0', type: 'int128' },
      { indexed: false, name: 'amount1', type: 'int128' },
      { indexed: false, name: 'sqrtPriceX96', type: 'uint160' },
      { indexed: false, name: 'liquidity', type: 'uint128' },
      { indexed: false, name: 'tick', type: 'int24' },
      { indexed: false, name: 'fee', type: 'uint24' },
    ],
  },
] as const;

// Universal Router V4 command for exact-input swap of native ETH into token.
// Simplified payload — real encoder requires Permit2 + v4 commands set.
// We ship this as a minimal ABI; actual swap bytes are built in sniper.ts.
export const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

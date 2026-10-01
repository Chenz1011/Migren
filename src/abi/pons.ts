// Pons V2 ABIs — minimal, event-focused.
// Pons docs don't publish exact event signatures publicly; these are the
// shapes that match the contract names in ponsdotdev/pons-labs. If Pons
// re-deploys and signatures change, update topic0 filters here.
//
// The strategy of this bot: filter logs by factory address (not by topic0),
// decode new contract addresses out of each log's topics, then verify by
// calling symbol() on the candidate. That makes us resilient to unknown
// event signatures while still catching every launch.

export const ponsLaunchFactoryAbi = [
  {
    type: 'event',
    name: 'LaunchCreated',
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: true, name: 'curve', type: 'address' },
      { indexed: true, name: 'creator', type: 'address' },
      { indexed: false, name: 'name', type: 'string' },
      { indexed: false, name: 'symbol', type: 'string' },
    ],
  },
  {
    type: 'event',
    name: 'Graduated',
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: true, name: 'pool', type: 'address' },
    ],
  },
] as const;

// LaunchAndBuy router — atomic launch+buy or buy-while-on-curve.
// Exact signature not publicly documented; we expose a generic buy() that
// matches the common Pons V2 router pattern. If signature differs, the
// snipe will revert and the bot falls back to post-graduation path.
export const ponsLaunchAndBuyAbi = [
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'minTokensOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'tokensOut', type: 'uint256' }],
  },
] as const;

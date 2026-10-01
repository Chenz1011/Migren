import type { Address } from 'viem';

type Phase = 'discovering' | 'bonding-curve' | 'graduated' | 'sniped' | 'exhausted';

type State = {
  phase: Phase;
  token: Address | null;
  curve: Address | null;
  v4PoolId: `0x${string}` | null;
  totalSpentWei: bigint;
  migrationTriggered: boolean;
  volumeTriggered: boolean;
};

export const state: State = {
  phase: 'discovering',
  token: null,
  curve: null,
  v4PoolId: null,
  totalSpentWei: 0n,
  migrationTriggered: false,
  volumeTriggered: false,
};

export function setToken(token: Address, curve: Address | null) {
  state.token = token;
  state.curve = curve;
  state.phase = 'bonding-curve';
}

export function markGraduated(poolId: `0x${string}`) {
  state.v4PoolId = poolId;
  state.phase = 'graduated';
}

export function markSniped(amountWei: bigint) {
  state.totalSpentWei += amountWei;
  state.phase = 'sniped';
}

export function canSpend(amountWei: bigint, maxTotal: bigint): boolean {
  return state.totalSpentWei + amountWei <= maxTotal;
}

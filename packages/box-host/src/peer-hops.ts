/** Peer messaging hop budget (Phase 2 exit criterion / AGENTS.md §3.5). */

export const PEER_MESSAGE_HOP_BUDGET = 5;

export function peerHopBudgetExceeded(hopCount: number, budget = PEER_MESSAGE_HOP_BUDGET): boolean {
  return hopCount > budget;
}

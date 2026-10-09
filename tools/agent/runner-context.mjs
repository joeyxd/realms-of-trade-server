import { buildContext } from './context.mjs';

// Chat and roster entries are optional context, unlike current rules, self state, goals,
// and unresolved actions. Prune a detached projection; never erase the inspection ledger.
export function buildRunnerContext(options) {
  const required = structuredClone(options.required);
  const originalChatCount = required.observation?.chat?.length ?? 0;
  const originalPeerCount = required.tools?.chat?.peers?.length ?? 0;
  const pinned = new Set([required.tools?.chat?.self,
    ...(required.tools?.chat?.pending ?? []).map((r) => r.target).filter(Boolean)]);
  let omittedChat = 0, omittedPeers = 0;
  let minimum = buildContext({ ...options, required, memory: [] });
  while (!minimum.ok && minimum.why === 'required_context_over_budget') {
    if (required.observation?.chat?.length) {
      required.observation.chat.shift(); omittedChat++;
      required.observation.historyGap++;
    } else {
      const index = required.tools?.chat?.peers?.findIndex((p) => !pinned.has(p.id)) ?? -1;
      if (index < 0) break;
      required.tools.chat.peers.splice(index, 1); omittedPeers++;
      required.tools.chat.omittedPeers++;
    }
    minimum = buildContext({ ...options, required, memory: [] });
  }
  const result = minimum.ok ? buildContext({ ...options, required }) : minimum;
  return { ...result, chatSelection: { policy: 'oldest_chat_then_unpinned_peers', originalChatCount,
    selectedChatCount: originalChatCount - omittedChat, omittedChat, originalPeerCount,
    selectedPeerCount: originalPeerCount - omittedPeers, omittedPeers,
    inspectionHistoryUnchanged: true } };
}

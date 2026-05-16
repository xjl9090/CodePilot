/**
 * Codex AgentRuntime implementation.
 *
 * Phase 5 Phase 3 (2026-05-13). Wires the existing CodePilot
 * `AgentRuntime` interface (stream / interrupt / isAvailable /
 * dispose) into the Codex app-server JSON-RPC channel.
 *
 * Lifecycle per call:
 *
 *   1. getCodexAppServer() — boot + initialize the app-server child
 *      process (cached singleton; subsequent calls reuse the same
 *      client).
 *   2. Resolve thread id — `thread/resume` if the session-store has
 *      a Codex ref for this chat session, else `thread/start` with
 *      the working directory.
 *   3. Subscribe to canonical notifications (agentMessage/delta,
 *      item/started, item/completed, turn/completed, etc.).
 *   4. `turn/start` with the user prompt + optional model override.
 *   5. Translate every notification into a `RuntimeRunEvent` via
 *      `translateCodexNotification`, then re-emit as SSE lines in
 *      CodePilot's existing format (`data: {"type":...,"data":...}\n\n`).
 *   6. On `turn/completed` (or `turn/failed`), close the stream.
 *
 * Server-to-client approval requests (`execCommandApproval` etc.)
 * are NOT wired into the canonical permission channel in this slice
 * — the JSON-RPC client doesn't yet support server-originated
 * requests, only notifications. Phase 6 closes that loop.
 *
 * NOTE: this module is node-only (pulls app-server-manager which
 * imports `child_process`). Don't import from client components.
 */

import type {
  AgentRuntime,
  RuntimeStreamOptions,
} from '@/lib/runtime/types';
import type { RuntimeRunEvent } from '@/lib/runtime/contract';
import {
  findCodexBinary,
  getCodexAppServer,
} from './app-server-manager';
import {
  translateCodexNotification,
  synthesizeFileChangedFromCompletedItem,
} from './event-mapper';
import { materializeCodexEventMedia } from './media-import';
import { handleCodexApprovalRequest } from './approval-bridge';
import {
  buildCodexThreadParams,
  resolveCodexProxyBaseUrl,
} from './provider-proxy';
import {
  getRuntimeSessionRef,
  setRuntimeSessionRef,
  clearRuntimeSessionRef,
} from '@/lib/runtime/session-store';

/**
 * Convert one canonical RuntimeRunEvent into the SSE-line format the
 * existing chat consumers expect:
 *   `data: {"type":"<sdkType>","data":"<payload>"}\n\n`
 *
 * The chat side already knows how to render these (claude-client
 * has been emitting them for v0.x). Codex's translator hits the same
 * channel; consumers don't need a new code path.
 */
function canonicalToSseLine(event: RuntimeRunEvent): string {
  switch (event.type) {
    case 'assistant_delta':
      return `data: ${JSON.stringify({ type: 'text', data: event.text })}\n\n`;
    case 'tool_started':
      return `data: ${JSON.stringify({
        type: 'tool_use',
        data: JSON.stringify({ id: event.toolId, name: event.name, input: event.input ?? {} }),
      })}\n\n`;
    case 'tool_completed':
      // Phase 5b smoke round 8 (2026-05-16) — forward `media` array
      // through the SSE `tool_result.media` channel. `useSSEStream.ts`
      // → `SSECallbacks.onToolResult` → `MediaPreview` consumes this
      // to render image / audio / video tool results inline. Without
      // this passthrough, Codex imageGeneration / imageView results
      // appeared as JSON inside `content` and never rendered as a
      // media card.
      return `data: ${JSON.stringify({
        type: 'tool_result',
        data: JSON.stringify({
          tool_use_id: event.toolId,
          content: event.output ?? '',
          ...(event.error ? { error: event.error } : {}),
          ...(event.media && event.media.length > 0 ? { media: event.media } : {}),
        }),
      })}\n\n`;
    case 'command_started':
      return `data: ${JSON.stringify({
        type: 'tool_use',
        data: JSON.stringify({ id: event.commandId, name: 'Bash', input: { command: event.command, cwd: event.cwd } }),
      })}\n\n`;
    case 'file_changed':
      // Phase 5 Phase 4 (2026-05-13) — emit as the dedicated SSE
      // `file_changed` event type. `useSSEStream.handleSSEEvent` →
      // SSECallbacks.onFileChanged → stream-session-manager →
      // dispatchFileChanged → window 'codepilot:file-changed' event →
      // PreviewPanel quiet-refresh. Same downstream path the
      // ClaudeCode SDK isWriteTool inspection uses; the runtime
      // adapter is the only place that knows where the paths come
      // from.
      return `data: ${JSON.stringify({
        type: 'file_changed',
        data: JSON.stringify({ paths: event.paths }),
      })}\n\n`;
    case 'usage_updated':
      return `data: ${JSON.stringify({
        type: 'context_usage',
        data: JSON.stringify({
          input_tokens: event.inputTokens,
          output_tokens: event.outputTokens,
          model_context_window: event.contextWindow,
        }),
      })}\n\n`;
    case 'run_completed':
      return `data: ${JSON.stringify({ type: 'result', data: JSON.stringify({ finish_reason: event.finishReason ?? 'end_turn' }) })}\n\n`;
    case 'run_failed':
      return `data: ${JSON.stringify({ type: 'error', data: event.message })}\n\n`;
    case 'unknown_item':
      // Surface unknown items as status so the chat doesn't drop them.
      return `data: ${JSON.stringify({
        type: 'status',
        data: JSON.stringify({ kind: event.sourceType, payload: event.payload }),
      })}\n\n`;
    default: {
      const _: never = event;
      throw new Error(`canonicalToSseLine: unhandled event ${String(_)}`);
    }
  }
}

/**
 * Active Codex turn registry — Phase 5 Phase 4 Slice 3 (2026-05-13).
 *
 * `turn/interrupt` requires both `threadId` AND `turnId` per
 * upstream schema (`TurnInterruptParams = { threadId, turnId }`).
 * threadId is already persisted via session-store; turnId is
 * transient (one per send, valid until turn/completed). We keep it
 * in-process per chat session — losing it across process restart
 * is acceptable because turns don't survive restarts either.
 *
 * Map cleared when turn/completed or turn/failed lands.
 */
const activeCodexTurns = new Map<string, { threadId: string; turnId: string }>();

/**
 * Active fs/watch entries — Phase 5 review round 3 (2026-05-13).
 *
 * Codex's fs/changed notifications only fire after a corresponding
 * fs/watch subscription. We register one watch per Codex session
 * (scoped to the chat session's working directory) so shell commands
 * that write files outside the fileChange item path still surface as
 * file_changed events. Entry cleared by fs/unwatch in closeStream.
 *
 * Map value is the watchId we sent — Codex echoes it back in
 * fs/changed notifications + accepts it for fs/unwatch.
 */
const fsWatchEntries = new Map<string, string>();

/**
 * The Codex AgentRuntime singleton. Phase 5 Phase 3 registers this
 * with the runtime registry alongside `nativeRuntime` and `sdkRuntime`.
 */
export const codexRuntime: AgentRuntime = {
  id: 'codex_runtime',
  displayName: 'Codex Runtime',
  description: 'Routes through the local codex app-server (Codex account models + native tools)',

  isAvailable(): boolean {
    return findCodexBinary() !== null;
  },

  stream(options: RuntimeStreamOptions): ReadableStream<string> {
    return new ReadableStream<string>({
      async start(controller) {
        const sessionId = options.sessionId;

        let active = true;
        const unsubscribers: Array<() => void> = [];
        const tryEnqueue = (line: string) => {
          if (!active) return;
          try {
            controller.enqueue(line);
          } catch {
            // Stream already closed (consumer aborted).
            active = false;
          }
        };

        const closeStream = (extra?: { error?: string }) => {
          if (!active) return;
          if (extra?.error) {
            tryEnqueue(
              `data: ${JSON.stringify({ type: 'error', data: extra.error })}\n\n`,
            );
          }
          tryEnqueue(`data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`);
          active = false;
          for (const u of unsubscribers.splice(0)) {
            try { u(); } catch { /* ignore */ }
          }
          try { controller.close(); } catch { /* ignore */ }
          // Phase 5 review round 3 (2026-05-13) — best-effort
          // fs/unwatch when the stream closes. We don't await: the
          // stream consumer doesn't care about the cleanup, and the
          // app-server forgets the watch on its end when the client
          // disconnects anyway. This is just hygiene to keep the
          // watch table small while CodePilot stays connected.
          const watchId = fsWatchEntries.get(sessionId);
          if (watchId) {
            fsWatchEntries.delete(sessionId);
            void (async () => {
              try {
                const { client } = await getCodexAppServer();
                await client.request('fs/unwatch', { watchId });
              } catch {
                /* best-effort; app-server cleans up on disconnect */
              }
            })();
          }
        };

        try {
          // ── env exclusion (Phase 5b) ───────────────────────────────
          // Reject empty / env providerId BEFORE booting the app-server
          // so the subprocess isn't spawned for a request we won't honor.
          // Codex Runtime is opt-out for env (Claude Code default); the
          // env provider routes via the Claude Code subprocess or
          // ANTHROPIC_API_KEY env, neither of which the Codex proxy
          // can target. Surfacing the failure here keeps the spawned
          // subprocess in the "actually used" set only.
          const requestedProviderId = (options.providerId ?? options.sessionProviderId ?? '').trim();
          if (!requestedProviderId || requestedProviderId === 'env') {
            throw new Error(
              'Codex Runtime requires an explicit provider. Pick a configured CodePilot provider or Codex Account; the env (Claude Code default) provider is not supported under Codex Runtime.',
            );
          }

          const { client } = await getCodexAppServer();

          // ── server-originated approval requests ──────────────────────
          // Phase 5 Phase 4 Slice 2 (2026-05-13). Wires Codex's
          // approval flow through CodePilot's existing PermissionPrompt
          // via `handleCodexApprovalRequest`:
          //   1. translateCodexApproval → canonical permission_request
          //   2. emits SDK-shape PermissionRequestEvent via SSE so
          //      useSSEStream + stream-session-manager + PermissionPrompt
          //      pick it up unchanged (UI doesn't branch on runtime)
          //   3. registers resolver in the existing permission-registry
          //      (same map ClaudeCode SDK uses); user response via
          //      /api/chat/permission resolves it
          //   4. translates PermissionResult → method-specific Codex
          //      response shape (different per approval method per
          //      `资料/codex/.../v2/{CommandExecution,FileChange,...}
          //      ApprovalDecision.ts`)
          //
          // Review round 3 (2026-05-13) — the original Slice 2 commit
          // shipped approval-bridge.ts + tests, but the runtime edit
          // got lost in a file-modification race and never replaced
          // the decline-by-default loop. This restoration completes
          // the wiring.
          //
          // item/permissions/requestApproval has a different response
          // shape (permissions + scope, not just decision). Bridge
          // throws an error → Codex treats as failed approval →
          // effectively decline. Phase 6 wires the full permission-
          // grant UI with GrantedPermissionProfile.
          for (const method of [
            'item/commandExecution/requestApproval',
            'item/fileChange/requestApproval',
            'item/permissions/requestApproval',
            'execCommandApproval',
            'applyPatchApproval',
          ]) {
            const unsubReq = client.onServerRequest(method, (params, ctx) =>
              handleCodexApprovalRequest({
                sessionId,
                jsonRpcId: ctx.id,
                method,
                params,
                emitSse: tryEnqueue,
              }),
            );
            unsubscribers.push(unsubReq);
          }

          // ── proxy-injection params (Phase 5b) ───────────────────────
          // `buildCodexThreadParams` returns the same shape that both
          // `thread/start` and `thread/resume` accept (cwd /
          // modelProvider / config). We MUST re-attach this payload on
          // every resume too, not just on start — see provider-proxy.ts
          // for the three reload scenarios where a resume-without-config
          // would drop the codepilot_proxy injection and silently route
          // a continuation turn at the wrong upstream.
          const threadParams = buildCodexThreadParams({
            providerId: requestedProviderId,
            workingDirectory: options.workingDirectory,
            proxyBaseUrl: resolveCodexProxyBaseUrl(),
            // Phase 5b smoke follow-up (2026-05-15) — Codex's
            // thread_start_params_from_config (codex-rs/tui/.../app_server_session.rs)
            // passes model alongside modelProvider so the proxy
            // injection resolves to a concrete model id. Without it
            // Codex rejects the turn before the proxy is even called
            // (the model_providers entry has no default_model set, by
            // design — we don't want users surprised by a different
            // model than they picked).
            model: options.model,
          });

          // ── thread resolution: resume if we have a ref + provider matches, else start ──
          const existingRef = getRuntimeSessionRef(sessionId, 'codex_runtime');
          const existingProviderBinding =
            typeof existingRef?.metadata?.providerId === 'string'
              ? existingRef.metadata.providerId
              : '';
          let threadId: string;
          if (existingRef && existingProviderBinding === requestedProviderId) {
            try {
              await client.request('thread/resume', {
                threadId: existingRef.token,
                ...threadParams,
              });
              threadId = existingRef.token;
            } catch {
              // Resume failed (thread archived / unknown id) → start fresh.
              const result = await client.request<{ thread: { id: string } }>(
                'thread/start',
                threadParams,
              );
              threadId = result.thread.id;
              setRuntimeSessionRef(sessionId, {
                runtimeId: 'codex_runtime',
                token: threadId,
                metadata: { providerId: requestedProviderId },
              });
            }
          } else {
            // Either no ref yet, or provider switched mid-session. In
            // the switch case the old thread is now stale (different
            // proxy injection); clear before writing the new binding
            // so a partial write can't leave a stale provider id behind.
            if (existingRef) clearRuntimeSessionRef(sessionId, 'codex_runtime');
            const result = await client.request<{ thread: { id: string } }>(
              'thread/start',
              threadParams,
            );
            threadId = result.thread.id;
            setRuntimeSessionRef(sessionId, {
              runtimeId: 'codex_runtime',
              token: threadId,
              metadata: { providerId: requestedProviderId },
            });
          }

          // ── workspace filesystem watch ──────────────────────────────
          // Phase 5 review round 3 (2026-05-13). Register an fs/watch
          // scoped to the working directory so Codex emits fs/changed
          // notifications when shell commands (NOT through fileChange
          // items) touch files. The fileChange item path already gets
          // covered by `synthesizeFileChangedFromCompletedItem`; this
          // watch covers the remaining case where Codex runs e.g. a
          // `cargo build` that drops artifacts on disk.
          //
          // The watch is best-effort: a failure leaves preview auto-
          // refresh degraded to fileChange items only, but the turn
          // continues. fs/unwatch fires in closeStream so we don't
          // leak watch entries on the long-running app-server.
          if (options.workingDirectory) {
            const watchId = `codex-fs-${sessionId}`;
            try {
              await client.request('fs/watch', {
                watchId,
                path: options.workingDirectory,
              });
              fsWatchEntries.set(sessionId, watchId);
            } catch (err) {
              console.debug('[codex.runtime] fs/watch best-effort failed:', err);
            }
          }

          // ── notification fan-out ────────────────────────────────────
          // Phase 5 review round 2 (2026-05-13): subscribe through the
          // wildcard hook so the canonical mapper sees EVERY notification.
          // Previously we registered ~9 specific method handlers — anything
          // outside that allowlist silently dropped, contradicting the
          // mapper's `unknown_item` fallback contract. The wildcard puts
          // every notification through `translateCodexNotification`, so
          // unknown methods actually reach the chat surface as
          // `unknown_item` blocks instead of vanishing.
          const unsubAny = client.onAnyNotification((method, params) => {
            const rawEvent = translateCodexNotification(method, params, { sessionId });
            // Phase 5b smoke round 9 (2026-05-16) — materialise MediaBlocks
            // before SSE encoding. Codex hands us raw paths like
            // /tmp/codex-out.png; /api/media/serve only allows
            // .codepilot-media. The import step copies the file into
            // the served directory and rewrites localPath so
            // MediaPreview can fetch it. No-op for non-image events
            // or already-imported blocks.
            const event = rawEvent
              ? materializeCodexEventMedia(rawEvent, { sessionId, cwd: options.workingDirectory })
              : null;
            if (event) {
              tryEnqueue(canonicalToSseLine(event));
            }

            // Review round 3 (2026-05-13) — fileChange item/completed
            // also synthesizes a `file_changed` event so PreviewPanel
            // auto-refresh fires for patch-applied files even without
            // a separate fs/changed notification. Two events from one
            // notification is legitimate: tool_completed for the chat
            // UI + file_changed for the dispatch channel.
            if (method === 'item/completed') {
              const fcEvent = synthesizeFileChangedFromCompletedItem(params, { sessionId });
              if (fcEvent) tryEnqueue(canonicalToSseLine(fcEvent));
            }

            // Stream lifecycle close on terminal canonical events.
            // turn/completed with status=failed lands as `run_failed`
            // (per the mapper); status=completed/interrupted/inProgress
            // lands as `run_completed`. Both close the stream.
            if (event?.type === 'run_completed' || event?.type === 'run_failed') {
              // Slice 3 (2026-05-13) — drop the active-turn entry so
              // a future interrupt() against this session doesn't
              // chase a stale turnId.
              activeCodexTurns.delete(sessionId);
              closeStream();
            }
          });
          unsubscribers.push(unsubAny);

          // ── kick off the turn ───────────────────────────────────────
          // Phase 5 Phase 4 Slice 3 — capture the returned turn id so
          // `interrupt(sessionId)` can issue `turn/interrupt` with the
          // correct (threadId, turnId) pair per
          // `TurnInterruptParams = { threadId, turnId }` in the schema.
          const turnResult = await client.request<{ turn: { id: string } }>('turn/start', {
            threadId,
            input: [{ type: 'text', text: options.prompt }],
            ...(options.workingDirectory ? { cwd: options.workingDirectory } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.effort ? { effort: options.effort } : {}),
          });
          activeCodexTurns.set(sessionId, { threadId, turnId: turnResult.turn.id });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          closeStream({ error: reason });
        }
      },
    });
  },

  interrupt(sessionId: string): void {
    // Phase 5 Phase 4 Slice 3 (2026-05-13) — issue a proper
    // `turn/interrupt` with (threadId, turnId). Both ids come from
    // the in-process `activeCodexTurns` map populated when
    // `turn/start` resolves. The map entry clears on turn/completed
    // or turn/failed so a stale entry can't fire after the turn
    // is already done.
    //
    // Best-effort still: if Codex isn't reachable or the entry is
    // missing (race against turn completion), the call no-ops. Per
    // upstream README, `turn/interrupt` resolves to `{}` on success
    // and the turn ultimately finishes with status: 'interrupted'.
    const active = activeCodexTurns.get(sessionId);
    if (!active) {
      console.debug('[codex.runtime] interrupt requested but no active turn for', sessionId);
      return;
    }
    void (async () => {
      try {
        const { client } = await getCodexAppServer();
        await client.request('turn/interrupt', {
          threadId: active.threadId,
          turnId: active.turnId,
        });
      } catch (err) {
        console.debug('[codex.runtime] turn/interrupt failed (best-effort):', err);
      }
    })();
  },

  dispose(): void {
    // Codex app-server lifecycle is managed centrally in
    // `app-server-manager.ts`. The runtime itself holds no
    // per-instance resources. Electron 'before-quit' / dev SIGTERM
    // calls `disposeCodexAppServer()` directly.
  },
};

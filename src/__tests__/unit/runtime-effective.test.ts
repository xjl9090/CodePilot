/**
 * Tests for `src/lib/runtime/effective.ts`. Locks in two contracts:
 *
 *   1. `computeEffectiveRuntime` mirrors `registry.ts:resolveRuntime`'s
 *      priority chain — `cli_enabled=false` is the highest-priority
 *      override, beating the stored `agent_runtime` value.
 *   2. `resolveNewChatDefault` mirrors `chat/page.tsx`'s resolution
 *      chain — global pair → provider-only → saved (localStorage)
 *      pair → API default → first compatible group.
 *
 * Both helpers run on the Settings Runtime page AND the chat header
 * RuntimeBadge AND the chat init path. Drift between any of those
 * surfaces is what triggered this refactor in the first place.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeEffectiveRuntime,
  resolveNewChatDefault,
  runtimeDisplayLabel,
} from "../../lib/runtime/effective";

// ---------------------------------------------------------------------------
// computeEffectiveRuntime
// ---------------------------------------------------------------------------

describe("computeEffectiveRuntime", () => {
  it("returns stored agent_runtime when cli_enabled is true", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", true, true), "claude-code-sdk");
    assert.equal(computeEffectiveRuntime("native", true, true), "native");
  });

  it("forces 'native' when cli_enabled is false (highest priority)", () => {
    // This is the drift case the refactor exists to prevent: the user's
    // stored preference says Claude Code, but cli_enabled=false routes
    // chat to AI SDK regardless. The settings panel + the chat badge
    // must both see this consistently.
    assert.equal(computeEffectiveRuntime("claude-code-sdk", false, true), "native");
    assert.equal(computeEffectiveRuntime("native", false, true), "native");
  });

  it("treats string 'false' the same as boolean false (DB stores strings)", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", "false", true), "native");
  });

  it("treats string 'true' the same as boolean true", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", "true", true), "claude-code-sdk");
  });

  it("defaults to enabled when cli_enabled is null / undefined (legacy rows)", () => {
    assert.equal(computeEffectiveRuntime("claude-code-sdk", null, true), "claude-code-sdk");
    assert.equal(computeEffectiveRuntime("claude-code-sdk", undefined, true), "claude-code-sdk");
  });

  it("coerces legacy 'auto' value to whichever matches CLI state", () => {
    // 'auto' isn't a real concrete runtime; resolveLegacyRuntimeForDisplay
    // picks claude-code-sdk when CLI is connected, native otherwise.
    assert.equal(computeEffectiveRuntime("auto", true, true), "claude-code-sdk");
    assert.equal(computeEffectiveRuntime("auto", true, false), "native");
  });

  it("legacy 'auto' still loses to cli_enabled=false override", () => {
    // Even if CLI is connected, cli_enabled=false short-circuits.
    assert.equal(computeEffectiveRuntime("auto", false, true), "native");
  });
});

// ---------------------------------------------------------------------------
// runtimeDisplayLabel
// ---------------------------------------------------------------------------

describe("runtimeDisplayLabel", () => {
  it("returns canonical display strings", () => {
    assert.equal(runtimeDisplayLabel("claude-code-sdk"), "Claude Code");
    assert.equal(runtimeDisplayLabel("native"), "AI SDK");
  });
});

// ---------------------------------------------------------------------------
// resolveNewChatDefault
// ---------------------------------------------------------------------------

const groupA = {
  provider_id: "anthropic-official",
  provider_name: "Anthropic",
  models: [
    { value: "sonnet", label: "Sonnet 4.6" },
    { value: "opus", label: "Opus 4.7" },
  ],
};
const groupB = {
  provider_id: "openrouter",
  provider_name: "OpenRouter",
  models: [
    { value: "anthropic/claude-3-opus", label: "Claude 3 Opus" },
  ],
};

describe("resolveNewChatDefault", () => {
  it("returns null when no compatible groups", () => {
    assert.equal(
      resolveNewChatDefault({
        groups: [],
        globalDefaultProvider: "anthropic-official",
        globalDefaultModel: "sonnet",
      }),
      null,
    );
  });

  it("global pair wins when both set and the model exists in the filtered group", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      globalDefaultProvider: "anthropic-official",
      globalDefaultModel: "opus",
    });
    assert.equal(result?.providerId, "anthropic-official");
    assert.equal(result?.modelValue, "opus");
    assert.equal(result?.modelLabel, "Opus 4.7");
  });

  it("provider-only fallback when global model is unset", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      globalDefaultProvider: "anthropic-official",
      globalDefaultModel: "",
    });
    // First model in target group (sonnet, not opus).
    assert.equal(result?.providerId, "anthropic-official");
    assert.equal(result?.modelValue, "sonnet");
  });

  it("when global model is set but invalid (not in filtered group), falls through to saved pair", () => {
    // This is the divergence the refactor closes: chat/page.tsx walks
    // through to localStorage in this case rather than the provider-only
    // fallback. The shared helper now matches.
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      globalDefaultProvider: "anthropic-official",
      globalDefaultModel: "non-existent-model",
      savedProviderId: "openrouter",
      savedModel: "anthropic/claude-3-opus",
    });
    assert.equal(result?.providerId, "openrouter");
    assert.equal(result?.modelValue, "anthropic/claude-3-opus");
  });

  it("when global model is set but invalid AND saved pair is missing, falls through to API default", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      globalDefaultProvider: "anthropic-official",
      globalDefaultModel: "non-existent-model",
      apiDefaultProviderId: "openrouter",
    });
    assert.equal(result?.providerId, "openrouter");
    assert.equal(result?.modelValue, "anthropic/claude-3-opus");
  });

  it("falls through to first compatible group when nothing else matches", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
    });
    assert.equal(result?.providerId, "anthropic-official"); // first in list
    assert.equal(result?.modelValue, "sonnet");
  });

  it("saved pair wins over API default when global pair is unusable and saved is valid", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      apiDefaultProviderId: "anthropic-official",
      savedProviderId: "openrouter",
      savedModel: "anthropic/claude-3-opus",
    });
    assert.equal(result?.providerId, "openrouter",
      "saved pair takes precedence over API default when no global pair");
  });

  it("saved provider with invalid saved model uses that provider's first model", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      savedProviderId: "anthropic-official",
      savedModel: "deprecated-model-id",
    });
    assert.equal(result?.providerId, "anthropic-official");
    assert.equal(result?.modelValue, "sonnet",
      "saved provider valid but saved model invalid → first model in that provider");
  });

  it("saved provider entirely missing from filtered groups falls through to API default", () => {
    const result = resolveNewChatDefault({
      groups: [groupA, groupB],
      apiDefaultProviderId: "openrouter",
      savedProviderId: "deleted-provider",
      savedModel: "x",
    });
    assert.equal(result?.providerId, "openrouter");
  });
});

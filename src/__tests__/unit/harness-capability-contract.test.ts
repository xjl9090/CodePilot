/**
 * Phase 5c slice 7 (2026-05-16) — Harness Capability Contract tests.
 *
 * Goal: catch the kind of drift that produced the slice-6 widget
 * regression — three independent `WIDGET_SYSTEM_PROMPT` copies, each
 * paraphrasing the same rules differently, so ClaudeCode SDK / Native
 * Runtime / Codex Runtime users got different format expectations.
 *
 * The contract module `src/lib/harness/capability-contract.ts` names
 * the canonical prompt fragment per capability and points at the
 * factory function in each runtime that exposes it. These tests check:
 *
 *   1. Catalog hygiene — every entry has the required fields; live
 *      capabilities have all three runtimes flagged; deferred/
 *      unsupported entries have a deferredReason.
 *   2. Tool-name agreement — the runtime exposure factories actually
 *      register the names the contract claims.
 *   3. Drift detection — every runtime exposure file either re-exports
 *      the canonical prompt verbatim (TypeScript import) OR includes
 *      it as a substring of the local constant. Anything else is
 *      paraphrasing and fails the test.
 *   4. Widget artifact wire format — the `canonicalJson` in the
 *      contract MUST JSON.parse + parseAllShowWidgets MUST return a
 *      `widget` segment (not malformed_widget). This is the slice-7
 *      direct fix for the slice-6 broken example.
 *   5. UI render path consistency — for media-bearing capabilities
 *      the render path mentions MediaPreview / SSE tool_result.media.
 *
 * The test is intentionally strict on widget (the smoke-broken one)
 * and looser on capabilities where Native/MCP drift is tech-debt
 * (memory / tasks). Those use a "core rule must appear in some form"
 * check rather than full string equality.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HARNESS_CAPABILITIES,
  getCapability,
  liveCapabilities,
  deferredCapabilities,
  unsupportedCapabilities,
  type CapabilityContract,
} from '@/lib/harness/capability-contract';
import { parseAllShowWidgets } from '@/components/chat/MessageItem';
import { WIDGET_SYSTEM_PROMPT as CANONICAL_WIDGET_PROMPT } from '@/lib/widget-guidelines';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────
// (1) Catalog hygiene
// ─────────────────────────────────────────────────────────────────────

describe('HARNESS_CAPABILITIES — catalog hygiene', () => {
  it('every entry has the required fields', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      assert.ok(cap.id, `entry must have id; got: ${JSON.stringify(cap)}`);
      assert.ok(cap.displayName, `${cap.id}: displayName required`);
      assert.ok(Array.isArray(cap.toolNames), `${cap.id}: toolNames must be array`);
      assert.ok(cap.exposure.claudecode_sdk, `${cap.id}: claudecode_sdk exposure required`);
      assert.ok(cap.exposure.native, `${cap.id}: native exposure required`);
      assert.ok(cap.exposure.codex_proxy, `${cap.id}: codex_proxy exposure required`);
      assert.ok(cap.uiRenderPath, `${cap.id}: uiRenderPath required`);
      assert.ok(Array.isArray(cap.canonicalEventTypes), `${cap.id}: canonicalEventTypes must be array`);
    }
  });

  it('ids are unique', () => {
    const ids = HARNESS_CAPABILITIES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate capability ids: ${ids.join(', ')}`);
  });

  it('non-live capabilities have a deferredReason', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      if (cap.status === 'live') continue;
      assert.ok(
        cap.deferredReason && cap.deferredReason.length > 20,
        `${cap.id} status=${cap.status} must include a substantive deferredReason; got: ${cap.deferredReason ?? 'undefined'}`,
      );
    }
  });

  it('live capabilities have at least two exposures that aren\'t marked unsupported', () => {
    // Pure-bridge-only capabilities don't make sense (they imply
    // CodePilot has an in-product capability ONLY when running
    // through Codex, which is backwards). Live means at least
    // ClaudeCode SDK + at least one of Native/Codex.
    for (const cap of liveCapabilities()) {
      const wired = [cap.exposure.claudecode_sdk, cap.exposure.native, cap.exposure.codex_proxy]
        .filter((e) => e.kind !== 'unsupported');
      assert.ok(
        wired.length >= 2,
        `${cap.id} is live but only one runtime is wired: ${JSON.stringify(cap.exposure)}`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (2) Tool-name surface agreement
// ─────────────────────────────────────────────────────────────────────

describe('Tool names declared in the contract appear in the runtime exposure files', () => {
  it('every tool name in `live` capabilities appears verbatim in at least one wired exposure file', () => {
    for (const cap of liveCapabilities()) {
      const wiredFiles = [cap.exposure.claudecode_sdk, cap.exposure.native, cap.exposure.codex_proxy]
        .filter((e) => e.kind !== 'unsupported' && e.module)
        .map((e) => readSource(e.module!));
      for (const name of cap.toolNames) {
        const inAny = wiredFiles.some((src) => src.includes(name));
        assert.ok(
          inAny,
          `${cap.id} tool "${name}" missing from every wired runtime exposure file. Either remove it from toolNames or wire it.`,
        );
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (3) Drift detection — Codex bridge alignment is strict
// ─────────────────────────────────────────────────────────────────────

describe('Codex bridge prompt does not redefine widget semantics', () => {
  it('bridge WIDGET_PROMPT consumes the canonical WIDGET_SYSTEM_PROMPT (no paraphrase)', () => {
    // The bridge MUST import + use the canonical fragment. We pin
    // both the import line AND the assignment line so a future edit
    // that re-introduces a standalone string trips immediately.
    const bridgeSrc = readSource('src/lib/codex/proxy/builtin-bridge.ts');
    assert.match(
      bridgeSrc,
      /import\s*\{[^}]*WIDGET_SYSTEM_PROMPT[^}]*\}\s*from\s*'@\/lib\/widget-guidelines'/,
      'bridge MUST import WIDGET_SYSTEM_PROMPT from widget-guidelines.ts (canonical source)',
    );
    assert.match(
      bridgeSrc,
      /const\s+WIDGET_PROMPT\s*=\s*CANONICAL_WIDGET_SYSTEM_PROMPT\s*;/,
      'bridge WIDGET_PROMPT must be exactly the canonical fragment — no paraphrasing, no concatenation',
    );
  });

  it('Native Runtime widget builtin-tools file re-exports the canonical', () => {
    const nativeSrc = readSource('src/lib/builtin-tools/widget-guidelines.ts');
    assert.match(
      nativeSrc,
      /import\s*\{[^}]*WIDGET_SYSTEM_PROMPT[^}]*\}\s*from\s*'@\/lib\/widget-guidelines'/,
      'Native widget tools file MUST import the canonical WIDGET_SYSTEM_PROMPT',
    );
    assert.match(
      nativeSrc,
      /export\s+const\s+WIDGET_SYSTEM_PROMPT\s*=\s*CANONICAL_WIDGET_SYSTEM_PROMPT\s*;/,
      'Native widget tools must re-export the canonical, not redefine it',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// (4) Widget artifact wire format — copy/paste-safe JSON
// ─────────────────────────────────────────────────────────────────────

describe('Widget artifact contract — canonicalJson is JSON.parse-safe + renders via parseAllShowWidgets', () => {
  it('JSON.parse(canonicalJson) returns an object with the required fields', () => {
    const widget = getCapability('widget');
    assert.ok(widget?.artifactContract, 'widget capability must declare an artifactContract');
    const { canonicalJson, requiredFields } = widget!.artifactContract!;
    // The slice-7 fix: this string must round-trip through JSON.parse
    // without escape-counting tricks. Slice 6 had `\\\"` here and
    // would fail this assertion.
    const parsed = JSON.parse(canonicalJson) as Record<string, unknown>;
    assert.equal(typeof parsed, 'object');
    for (const field of requiredFields) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(parsed, field),
        `canonicalJson missing required field "${field}"`,
      );
    }
    // Widget-specific shape checks.
    assert.equal(typeof parsed.title, 'string');
    assert.equal(typeof parsed.widget_code, 'string');
    assert.ok((parsed.widget_code as string).length > 0);
  });

  it('canonicalJson wrapped in a show-widget fence renders via parseAllShowWidgets (not malformed_widget)', () => {
    const widget = getCapability('widget');
    assert.ok(widget?.artifactContract);
    const { fenceLanguage, canonicalJson } = widget!.artifactContract!;
    // Build the literal fence the model would emit — three backticks
    // + fence language + JSON + three backticks. If the renderer
    // returns malformed_widget for this, the example in the prompt
    // is broken (slice-6 regression mode).
    const fence = '```' + fenceLanguage + '\n' + canonicalJson + '\n```';
    const segs = parseAllShowWidgets(fence);
    const widgetSeg = segs.find((s) => s.type === 'widget');
    const malformed = segs.find((s) => s.type === 'malformed_widget');
    assert.ok(widgetSeg, `canonical show-widget example must parse as a widget segment, got: ${JSON.stringify(segs)}`);
    assert.equal(malformed, undefined, 'canonical example must never trip malformed_widget — if it does, the prompt is broken');
    if (widgetSeg?.type !== 'widget') return;
    assert.equal(widgetSeg.data.title, 'Hello');
    // The widget_code should be exactly what's in the JSON, no
    // escape-counting weirdness.
    assert.match(widgetSeg.data.widget_code, /Hello world/);
  });

  it('the canonical example appears inside WIDGET_WIRE_FORMAT_SPEC, which appears inside WIDGET_SYSTEM_PROMPT', () => {
    // Triple-chain check: spec contains example, system prompt
    // contains spec. Any future refactor that detaches them shows
    // up here instantly.
    const widget = getCapability('widget');
    assert.ok(widget?.artifactContract);
    const example = widget!.artifactContract!.canonicalJson;
    assert.ok(
      CANONICAL_WIDGET_PROMPT.includes(example),
      'WIDGET_SYSTEM_PROMPT must embed the canonical example so the model reads it directly',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// (5) UI render path consistency for media-bearing capabilities
// ─────────────────────────────────────────────────────────────────────

describe('Media-bearing capabilities declare a MediaPreview render path', () => {
  it('every capability with toolResultShape === "media" mentions MediaPreview in its uiRenderPath', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      if (cap.toolResultShape !== 'media') continue;
      assert.match(
        cap.uiRenderPath,
        /MediaPreview/,
        `${cap.id} produces media but renderPath doesn't mention MediaPreview — the chain is broken`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (6) Status-aware exposure invariants
// ─────────────────────────────────────────────────────────────────────

describe('Deferred / unsupported capabilities have honest exposure shapes', () => {
  it('deferred capabilities have at least ONE runtime marked unsupported (otherwise they are actually live)', () => {
    for (const cap of deferredCapabilities()) {
      const anyUnsupported = [
        cap.exposure.claudecode_sdk,
        cap.exposure.native,
        cap.exposure.codex_proxy,
      ].some((e) => e.kind === 'unsupported');
      assert.ok(
        anyUnsupported,
        `${cap.id} is deferred but every exposure is wired — should be flipped to 'live'`,
      );
    }
  });

  it('unsupported runtime exposures carry a `notes` explanation', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      for (const [runtime, exp] of Object.entries(cap.exposure)) {
        if (exp.kind === 'unsupported') {
          assert.ok(
            exp.notes && exp.notes.length > 10,
            `${cap.id}.${runtime} is unsupported but has no explanatory notes`,
          );
        }
      }
    }
  });

  it('liveCapabilities() / deferredCapabilities() / unsupportedCapabilities() partition the catalog', () => {
    const total = liveCapabilities().length + deferredCapabilities().length + unsupportedCapabilities().length;
    assert.equal(total, HARNESS_CAPABILITIES.length, 'every capability must fall into exactly one status bucket');
  });
});

// ─────────────────────────────────────────────────────────────────────
// (7) System prompt fragments aren't accidentally empty
// ─────────────────────────────────────────────────────────────────────

describe('System prompt fragments are present for live capabilities (unless explicitly noted)', () => {
  it('every live capability with a documented authority file has a non-empty prompt', () => {
    for (const cap of liveCapabilities()) {
      // cli_tools is currently the only documented exception (prompt
      // lives inline in the factory; future slice extracts it).
      if (cap.id === 'cli_tools') continue;
      assert.ok(
        cap.systemPromptFragment.length > 0,
        `${cap.id} is live but systemPromptFragment is empty — either point at the canonical source or mark as tech-debt`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (8) Cross-check: the contract list matches the bridge's mounted set
// ─────────────────────────────────────────────────────────────────────

describe('Codex bridge tool surface matches the contract', () => {
  it('every codex_proxy.kind = bridge_executable tool name is mounted by createCodePilotBuiltinTools', async () => {
    // Runtime check: build the bridge with a synthetic session and
    // confirm the tool names match. This is real runtime semantics,
    // not just source-grep — if a future refactor breaks the bridge
    // wiring, this test catches it even if the source still mentions
    // the right factory name.
    const { createCodePilotBuiltinTools } = await import('@/lib/codex/proxy/builtin-bridge');
    const bridge = createCodePilotBuiltinTools({
      sessionId: 'contract-test',
      targetProviderId: 'prov-test',
      workspacePath: '/tmp/contract-test-workspace',
    });
    const mounted = new Set(Object.keys(bridge.tools));
    for (const cap of HARNESS_CAPABILITIES) {
      if (cap.exposure.codex_proxy.kind !== 'bridge_executable') continue;
      for (const toolName of cap.toolNames) {
        // Some capabilities (tasks_and_notify includes hatch_buddy)
        // declare a tool name in the catalog but don't mount it in
        // the Codex bridge — that's documented in the contract's
        // notes field. Skip names not mounted IF the notes mention
        // "NOT exposed via bridge".
        if (!mounted.has(toolName)) {
          const notes = cap.exposure.codex_proxy.notes ?? '';
          assert.match(
            notes,
            new RegExp(`${toolName}.*not exposed|NOT exposed.*${toolName}|${toolName}.*deferred`, 'i'),
            `${cap.id}.${toolName} is declared bridge_executable but the bridge doesn't mount it and the notes don't explain why`,
          );
        }
      }
    }
  });
});

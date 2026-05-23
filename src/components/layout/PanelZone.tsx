"use client";

/**
 * PanelZone — light right-rail container.
 *
 * Mounts:
 *   - FileTreePanel — independent topbar entry. The file tree is a
 *     high-frequency deterministic tool, kept out of the Workspace
 *     Sidebar so a quick file lookup doesn't drag the user into the
 *     full Tab shell.
 *   - AssistantPanel — assistant-workspace surface; doesn't fit the
 *     AI-work-surface Tab model, so it lives here as its own concern.
 *
 * The Git / Widget / Markdown / Artifact / file-preview surfaces all
 * live inside `<WorkspaceSidebar>` as fixed or dynamic Tabs and never
 * render here.
 *
 * v13 — FileTreePanel and the Workspace Sidebar are additive: both
 * can be open simultaneously and the chat area shrinks accordingly.
 * Each topbar toggle (UnifiedTopBar) flips its own panel only, with
 * no auto-close of the other. Earlier rounds (and v11) treated them
 * as mutually exclusive; that direction was reversed after the user
 * pointed out the actual product wish was coexistence — see the
 * Phase 3 archive's v13 entry for the full rationale.
 */

import dynamic from "next/dynamic";
import { usePanel } from "@/hooks/usePanel";

const FileTreePanel = dynamic(() => import("./panels/FileTreePanel").then(m => ({ default: m.FileTreePanel })), { ssr: false });
const AssistantPanel = dynamic(() => import("./panels/AssistantPanel").then(m => ({ default: m.AssistantPanel })), { ssr: false });

export function PanelZone() {
  const { fileTreeOpen, assistantPanelOpen } = usePanel();

  const anyOpen = fileTreeOpen || assistantPanelOpen;

  if (!anyOpen) return null;

  return (
    // Round 32 — file tree wrapped in card-frame for macOS profile so
    // its outer shadow doesn't get clipped by the surface's clip-path.
    // overflow:visible on the outer flex so the frame's shadow can
    // paint past its boundary.
    <div className="flex h-full shrink-0">
      {assistantPanelOpen && <AssistantPanel />}
      {fileTreeOpen && (
        <div data-platform-card-frame="file-tree" className="h-full">
          <FileTreePanel />
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * WorkspaceSidebar — the right-side shell.
 *
 * Renders nothing when the user has collapsed it (open === false);
 * the topbar reopen button is responsible for surfacing it again.
 *
 * Always-rendered structure when open:
 *   [ResizeHandle] [TabBar] [TabPanel]
 *
 * Width state lives in WorkspaceSidebarContext (persisted via
 * localStorage). ResizeHandle delivers pixel deltas; we clamp inside
 * the pure model.
 */

import { useCallback } from 'react';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
import { useWorkspaceSidebar } from '@/hooks/useWorkspaceSidebar';
import { TabBar } from './TabBar';
import { TabPanel } from './TabPanel';

export function WorkspaceSidebar() {
  const { state, setWidth } = useWorkspaceSidebar();

  // ResizeHandle on a right-side panel: dragging left → wider, so we
  // subtract the delta. Same convention as the existing PreviewPanel /
  // GitPanel resize. Clamp happens inside the pure model.
  const handleResize = useCallback(
    (delta: number) => {
      setWidth(state.width - delta);
    },
    [state.width, setWidth],
  );

  if (!state.open) return null;

  // Round 32 (Codex P1/P2) — two-layer card structure:
  //   outer frame: shadow + overflow visible (won't clip its own shadow)
  //   inner surface: clip-path + radius + bg + content
  // ResizeHandle stays as a sibling of the frame so its 4px slot
  // lives in the gutter, not inside the card.
  // Round 32 (Codex P1/P2) — two-layer card structure with
  // ResizeHandle as flex sibling on the left.
  return (
    <div className="flex h-full shrink-0">
      <ResizeHandle
        side="left"
        onResize={handleResize}
        onReset={() => setWidth(360)}
      />
      <div
        data-platform-card-frame="workspace"
        className="h-full"
        style={{ width: state.width }}
      >
        <div
          data-workspace-sidebar
          className="flex h-full flex-col overflow-hidden bg-background"
        >
          <TabBar />
          <TabPanel />
        </div>
      </div>
    </div>
  );
}

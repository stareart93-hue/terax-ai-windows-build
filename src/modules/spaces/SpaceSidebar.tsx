import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { labelFor, type Tab, TabIcon } from "@/modules/tabs";
import {
  leafIds,
  ptyIdForLeaf,
  useAgentActivityStore,
  type AgentPhase,
} from "@/modules/terminal";
import {
  Cancel01Icon,
  CheckmarkCircle01Icon,
  ComputerTerminal02Icon,
  Delete02Icon,
  IncognitoIcon,
  Loading03Icon,
  Message02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { InlineRename } from "./components/InlineRename";
import { SpaceAvatar } from "./SpaceAvatar";
import type { SpaceMeta } from "./lib/store";
import { useSpaces } from "./lib/useSpaces";

type Props = {
  tabs: Tab[];
  activeTabId: number;
  onNewSpace: () => void;
  onDeleteSpace: (id: string) => void;
  onNewTabInSpace: (spaceId: string) => void;
  onJumpTab: (id: number) => void;
  onCloseTab: (id: number) => void;
};

type ClaudeStatus = "attention" | "working" | "finished" | "idle";
type ClaudePresence = { status: ClaudeStatus; agent: string };

function subtitleFor(tab: Tab): string | null {
  if (tab.kind === "terminal") {
    if (!tab.cwd) return null;
    const segs = tab.cwd.split(/[\\/]/).filter(Boolean);
    return segs.slice(-2).join("/") || tab.cwd;
  }
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const segs = tab.path.split(/[\\/]/).filter(Boolean);
    return segs.slice(-2, -1)[0] ?? null;
  }
  return null;
}

function claudeStatusFor(
  phases: Record<number, AgentPhase>,
  agents: Record<number, string>,
  tab: Tab,
): ClaudePresence | null {
  if (tab.kind !== "terminal" || tab.private) return null;
  const ptyIds = leafIds(tab.paneTree)
    .map((leaf) => ptyIdForLeaf(leaf))
    .filter((id): id is number => id !== null);
  const claudePtys = ptyIds.filter((id) =>
    (agents[id] ?? "").toLowerCase().includes("claude"),
  );

  if (claudePtys.length === 0) return null;
  const agent = claudePtys.map((id) => agents[id]).find(Boolean) ?? "claude";
  let finished = false;
  for (const id of claudePtys) {
    const phase = phases[id];
    if (phase === "attention") return { status: "attention", agent };
    if (phase === "working") return { status: "working", agent };
    if (phase === "finished") finished = true;
  }
  return { status: finished ? "finished" : "idle", agent };
}

export function SpaceSidebar({
  tabs,
  activeTabId,
  onNewSpace,
  onDeleteSpace,
  onNewTabInSpace,
  onJumpTab,
  onCloseTab,
}: Props) {
  const spaces = useSpaces((s) => s.spaces);
  const activeSpaceId = useSpaces((s) => s.activeId);
  const setActive = useSpaces((s) => s.setActive);
  const rename = useSpaces((s) => s.rename);
  const phases = useAgentActivityStore((s) => s.phases);
  const agents = useAgentActivityStore((s) => s.agents);
  const [editingId, setEditingId] = useState<string | null>(null);

  const tabsBySpace = useMemo(() => {
    const m = new Map<string, Tab[]>();
    for (const t of tabs) {
      const arr = m.get(t.spaceId);
      if (arr) arr.push(t);
      else m.set(t.spaceId, [t]);
    }
    return m;
  }, [tabs]);

  return (
    <aside
      data-space-sidebar
      className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-2">
        <span className="text-xs font-semibold text-foreground">Spaces</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="New space"
          onClick={onNewSpace}
          className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {spaces.map((space) => (
          <SpaceSection
            key={space.id}
            space={space}
            tabs={tabsBySpace.get(space.id) ?? []}
            active={space.id === activeSpaceId}
            activeTabId={activeTabId}
            canDelete={spaces.length > 1}
            editing={editingId === space.id}
            phases={phases}
            agents={agents}
            onSwitch={() => setActive(space.id)}
            onStartRename={() => setEditingId(space.id)}
            onCommitRename={(name) => {
              const v = name.trim();
              if (v) rename(space.id, v);
              setEditingId(null);
            }}
            onCancelRename={() => setEditingId(null)}
            onDelete={() => onDeleteSpace(space.id)}
            onNewTab={() => onNewTabInSpace(space.id)}
            onJumpTab={onJumpTab}
            onCloseTab={onCloseTab}
          />
        ))}
      </div>
    </aside>
  );
}

function SpaceSection({
  space,
  tabs,
  active,
  activeTabId,
  canDelete,
  editing,
  phases,
  agents,
  onSwitch,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onNewTab,
  onJumpTab,
  onCloseTab,
}: {
  space: SpaceMeta;
  tabs: Tab[];
  active: boolean;
  activeTabId: number;
  canDelete: boolean;
  editing: boolean;
  phases: Record<number, AgentPhase>;
  agents: Record<number, string>;
  onSwitch: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onNewTab: () => void;
  onJumpTab: (id: number) => void;
  onCloseTab: (id: number) => void;
}) {
  return (
    <section className="mb-2">
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-1.5 py-1.5",
          active ? "bg-accent" : "hover:bg-accent/50",
        )}
      >
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SpaceAvatar space={space} active={active} />
            <InlineRename
              initial={space.name}
              onCommit={onCommitRename}
              onCancel={onCancelRename}
              className="min-w-0 flex-1"
            />
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
              {tabs.length}
            </span>
          </div>
        ) : (
          <button
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={onSwitch}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <SpaceAvatar space={space} active={active} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {space.name}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/55">
              {tabs.length}
            </span>
          </button>
        )}
        {!editing ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <SpaceAction
              icon={PencilEdit02Icon}
              label="Rename space"
              onClick={onStartRename}
            />
            <SpaceAction
              icon={PlusSignIcon}
              label="New tab in space"
              onClick={onNewTab}
            />
            {canDelete ? (
              <SpaceAction
                icon={Delete02Icon}
                label="Delete space"
                onClick={onDelete}
                destructive
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-0.5 flex flex-col gap-px pl-3">
        {tabs.map((tab) => (
          <SpaceTabRow
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            claude={claudeStatusFor(phases, agents, tab)}
            onJump={() => onJumpTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SpaceAction({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/80 hover:text-foreground",
        destructive && "hover:text-destructive",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={2} />
    </button>
  );
}

function SpaceTabRow({
  tab,
  active,
  claude,
  onJump,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  claude: ClaudePresence | null;
  onJump: () => void;
  onClose: () => void;
}) {
  const subtitle = subtitleFor(tab);
  return (
    <div
      className={cn(
        "group/tab flex items-center gap-2 rounded-md px-2 py-1.5",
        active ? "bg-foreground/[0.07]" : "hover:bg-accent/45",
      )}
    >
      <button
        type="button"
        onClick={onJump}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <SpaceTaskIcon tab={tab} claude={claude} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[11.5px] leading-tight text-foreground">
            {labelFor(tab)}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            {subtitle ? (
              <span className="truncate text-[9.5px] leading-tight text-muted-foreground/55">
                {subtitle}
              </span>
            ) : null}
            {claude ? <ClaudeStatusBadge status={claude.status} /> : null}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close tab"
        className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/tab:opacity-70 hover:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

function SpaceTaskIcon({
  tab,
  claude,
}: {
  tab: Tab;
  claude: ClaudePresence | null;
}) {
  if (tab.kind !== "terminal") return <TabIcon tab={tab} />;
  if (tab.private) {
    return (
      <HugeiconsIcon
        icon={IncognitoIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground"
      />
    );
  }
  if (!claude) {
    return (
      <HugeiconsIcon
        icon={ComputerTerminal02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground"
      />
    );
  }
  return (
    <span
      title={`Claude ${claude.status}`}
      className={cn(
        "relative inline-flex size-3.5 shrink-0 items-center justify-center",
        claude.status === "attention" && "text-amber-500",
        claude.status === "working" && "text-primary",
        claude.status === "finished" && "text-emerald-500",
        claude.status === "idle" && "text-muted-foreground",
      )}
    >
      <AgentIcon agent={claude.agent} size={14} />
      <span
        className={cn(
          "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border border-card",
          claude.status === "attention" && "bg-amber-500",
          claude.status === "working" && "bg-primary",
          claude.status === "finished" && "bg-emerald-500",
          claude.status === "idle" && "bg-muted-foreground/50",
        )}
      />
    </span>
  );
}

function ClaudeStatusBadge({ status }: { status: ClaudeStatus }) {
  const spec = {
    attention: {
      label: "Claude waiting",
      icon: Message02Icon,
      className: "text-amber-500",
    },
    working: {
      label: "Claude running",
      icon: Loading03Icon,
      className: "text-primary",
    },
    finished: {
      label: "Claude done",
      icon: CheckmarkCircle01Icon,
      className: "text-emerald-500",
    },
    idle: {
      label: "Claude idle",
      icon: CheckmarkCircle01Icon,
      className: "text-muted-foreground/45",
    },
  }[status];

  return (
    <span
      title={spec.label}
      className={cn("inline-flex shrink-0 items-center gap-1", spec.className)}
    >
      <HugeiconsIcon
        icon={spec.icon}
        size={10}
        strokeWidth={2}
        className={status === "working" ? "animate-spin" : undefined}
      />
      <span className="text-[9px] leading-none">{status}</span>
    </span>
  );
}

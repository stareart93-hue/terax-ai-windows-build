import { invoke } from "@tauri-apps/api/core";
import type {
  IBufferLine,
  IBufferRange,
  ILink,
  ILinkProvider,
  Terminal,
} from "@xterm/xterm";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  dispatchFileLink,
  findPathMatches,
  resolveTerminalPath,
} from "./pathLinks";

/**
 * String index -> buffer cell mapping that mirrors the web-links addon: walks
 * cells consuming string characters, treating wide characters as their string
 * length and zero-width continuation cells as empty. Returns 0-based
 * [lineIndex, cellIndex], or null past the buffer.
 */
function mapStrIdx(
  term: Terminal,
  lineIdx: number,
  startCell: number,
  remaining: number,
): [number, number] | null {
  const buffer = term.buffer.active;
  let x = startCell;
  let y = lineIdx;
  while (remaining > 0) {
    const line = buffer.getLine(y);
    if (!line) return null;
    for (; x < line.length; ++x) {
      const cell = line.getCell(x);
      if (!cell) break;
      const chars = cell.getChars();
      if (cell.getWidth() !== 0) {
        remaining -= chars.length || 1;
        if (x === line.length - 1 && chars === "") {
          const next = buffer.getLine(y + 1);
          if (next?.isWrapped) {
            const head = next.getCell(0);
            if (head && head.getWidth() === 2) remaining += 1;
          }
        }
      }
      if (remaining < 0) return [y, x];
    }
    y += 1;
    x = 0;
  }
  return [y, x];
}

function rangeFor(
  term: Terminal,
  bufferLineNumber: number,
  start: number,
  length: number,
): IBufferRange | null {
  const from = mapStrIdx(term, bufferLineNumber - 1, 0, start);
  if (!from) return null;
  const to = mapStrIdx(term, from[0], from[1], length);
  if (!to) return null;
  return {
    start: { x: from[1] + 1, y: from[0] + 1 },
    end: { x: to[1], y: to[0] + 1 },
  };
}

function lineText(term: Terminal, bufferLineNumber: number): string | null {
  const line: IBufferLine | undefined = term.buffer.active.getLine(
    bufferLineNumber - 1,
  );
  return line ? line.translateToString(true) : null;
}

async function openIfFile(path: string, line: number | null, col: number | null) {
  try {
    const stat = await invoke<{ size: number; mtime: number; kind: string }>(
      "fs_stat",
      { path, workspace: currentWorkspaceEnv() },
    );
    if (stat.kind !== "file") return;
    dispatchFileLink(path, line, col);
  } catch {
    // Path-shaped but not a real file: silently drop.
  }
}

let tooltipEl: HTMLDivElement | null = null;

function hideTooltip(): void {
  tooltipEl?.remove();
  tooltipEl = null;
}

function showTooltip(event: MouseEvent, resolved: string | null): void {
  hideTooltip();
  if (!resolved) return;
  const el = document.createElement("div");
  el.textContent = resolved;
  el.setAttribute("data-terax-path-tip", "");
  el.style.cssText =
    "position:fixed;z-index:9999;max-width:480px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
    "padding:3px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:#18181b;color:#fafafa;" +
    "font:11px ui-monospace,monospace;pointer-events:none;";
  el.style.left = `${Math.max(4, event.clientX - 8)}px`;
  el.style.top = `${Math.max(4, event.clientY - 30)}px`;
  document.body.appendChild(el);
  tooltipEl = el;
}

export function createFileLinkProvider(
  term: Terminal,
  getCwd: () => string | null,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const text = lineText(term, bufferLineNumber);
      if (!text) {
        callback(undefined);
        return;
      }
      const links: ILink[] = [];
      for (const match of findPathMatches(text)) {
        const range = rangeFor(
          term,
          bufferLineNumber,
          match.start,
          match.text.length,
        );
        if (!range) continue;
        const activate = (event: MouseEvent) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          const resolved = resolveTerminalPath(match.text, getCwd());
          if (!resolved) return;
          void openIfFile(resolved, match.line, match.col);
        };
        links.push({
          range,
          text: match.text,
          activate,
          hover: (event) =>
            showTooltip(event, resolveTerminalPath(match.text, getCwd())),
          leave: () => hideTooltip(),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

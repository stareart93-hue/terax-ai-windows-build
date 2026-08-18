import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  goToNextChunk,
  goToPreviousChunk,
  MergeView,
  unifiedMergeView,
} from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setDiffLayout } from "@/modules/settings/store";
import {
  commitDiffKey,
  fetchCommitDiff,
  fetchReviewDiff,
  fetchWorkingDiff,
  getCachedDiff,
  reviewDiffKey,
  workingDiffKey,
} from "./lib/diffCache";
import { DIFF_SCAN_LIMIT, normalizeForDiff } from "./lib/diffNormalize";
import {
  buildSharedExtensions,
  DEFAULT_INDENT,
  languageCompartment,
} from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";

type WorkingSource = {
  kind: "working";
  repoRoot: string;
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
};

type ReviewSource = {
  kind: "review";
  repoRoot: string;
  path: string;
  originalPath: string | null;
  baseRef: string;
};

type CommitSource = {
  kind: "commit";
  repoRoot: string;
  sha: string;
  path: string;
  originalPath: string | null;
};

type Props = {
  source: WorkingSource | ReviewSource | CommitSource;
  chipLabel?: string;
  active: boolean;
};

const LARGE_FILE_THRESHOLD = 256 * 1024;

const SHARED_EXT = buildSharedExtensions();
const READONLY_EXT = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];
const DIFF_THEME = EditorView.theme({
  "&.cm-merge-b .cm-changedText, .cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: "rgba(220, 90, 90, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.05) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.05) !important",
    paddingTop: "1px",
    paddingBottom: "1px",
  },
  "&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});

function countDiffLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (let i = 0; i < patch.length; i++) {
    if (i > 0 && patch.charCodeAt(i - 1) !== 10) continue;
    const c = patch.charCodeAt(i);
    if (c === 43 && patch.charCodeAt(i + 1) !== 43) added++;
    else if (c === 45 && patch.charCodeAt(i + 1) !== 45) removed++;
  }
  if (patch.length > 0 && patch.charCodeAt(0) === 43) added++;
  else if (patch.length > 0 && patch.charCodeAt(0) === 45) removed++;
  return { added, removed };
}

/** Approximation of `git diff -w` for the merge view: drop trailing spaces
 * per line so whitespace-only churn stops polluting the chunk list. */
function stripTrailingWhitespace(content: string): string {
  return content.replace(/[ \t]+(?=\n)/g, "").replace(/[ \t]+$/, "");
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      originalContent: string;
      modifiedContent: string;
      isBinary: boolean;
      fallbackPatch: string;
      /** Resolved before mount: a late compartment reconfigure would leave
       * the merge view's deleted-chunk widgets unhighlighted. */
      langExt: Extension | null;
    }
  | { kind: "error"; message: string };

function cacheKey(source: WorkingSource | ReviewSource | CommitSource): string {
  if (source.kind === "working") {
    return workingDiffKey(source.repoRoot, source.path, source.mode);
  }
  if (source.kind === "review") {
    return reviewDiffKey(source.repoRoot, source.baseRef, source.path);
  }
  return commitDiffKey(source.repoRoot, source.sha, source.path);
}

function loadStateFromCache(
  source: WorkingSource | ReviewSource | CommitSource,
): LoadState {
  const hit = getCachedDiff(cacheKey(source));
  if (!hit) return { kind: "idle" };
  return {
    kind: "loaded",
    originalContent: hit.originalContent,
    modifiedContent: hit.modifiedContent,
    isBinary: hit.isBinary,
    fallbackPatch: hit.fallbackPatch,
    langExt: resolveLanguageSync(source.path)?.ext ?? null,
  };
}

export function GitDiffPane({ source, chipLabel, active }: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const themeExt = useEditorThemeExt();
  const [state, setState] = useState<LoadState>(() =>
    active ? loadStateFromCache(source) : { kind: "idle" },
  );

  const key = cacheKey(source);

  useEffect(() => {
    if (!active) return;
    const cached = loadStateFromCache(source);
    if (cached.kind === "loaded") {
      setState(cached);
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    const promise =
      source.kind === "working"
        ? fetchWorkingDiff(
            source.repoRoot,
            source.path,
            source.mode,
            source.originalPath,
          )
        : source.kind === "review"
          ? fetchReviewDiff(
              source.repoRoot,
              source.baseRef,
              source.path,
              source.originalPath,
            )
          : fetchCommitDiff(
              source.repoRoot,
              source.sha,
              source.path,
              source.originalPath,
            );
    Promise.all([promise, resolveLanguage(source.path).catch(() => null)])
      .then(([res, lang]) => {
        if (cancelled) return;
        setState({
          kind: "loaded",
          originalContent: res.originalContent,
          modifiedContent: res.modifiedContent,
          isBinary: res.isBinary,
          fallbackPatch: res.fallbackPatch,
          langExt: lang?.ext ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [active, key, source]);

  const path = source.path;
  const repoRoot = source.repoRoot;
  const mode =
    source.kind === "working" ? source.mode : ("+" as const);
  const loaded = state.kind === "loaded" ? state : null;
  const originalContent = loaded?.originalContent ?? "";
  const modifiedContent = loaded?.modifiedContent ?? "";
  const isBinary = loaded?.isBinary ?? false;
  const fallbackPatch = loaded?.fallbackPatch ?? "";

  const isTooLarge =
    originalContent.length > LARGE_FILE_THRESHOLD ||
    modifiedContent.length > LARGE_FILE_THRESHOLD;
  const useFallback = isBinary || isTooLarge;

  const diffLayout = usePreferencesStore((s) => s.diffLayout);
  const [ignoreWs, setIgnoreWs] = useState(false);
  const splitHostRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  const displayOriginal = useMemo(() => {
    const norm = normalizeForDiff(originalContent);
    return ignoreWs ? stripTrailingWhitespace(norm) : norm;
  }, [originalContent, ignoreWs]);
  const displayModified = useMemo(() => {
    const norm = normalizeForDiff(modifiedContent);
    return ignoreWs ? stripTrailingWhitespace(norm) : norm;
  }, [modifiedContent, ignoreWs]);

  const langExt = loaded?.langExt ?? null;
  const extensions = useMemo(
    () => [
      ...SHARED_EXT,
      DEFAULT_INDENT,
      languageCompartment.of(langExt ?? []),
      ...READONLY_EXT,
      unifiedMergeView({
        original: displayOriginal,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
        diffConfig: { scanLimit: DIFF_SCAN_LIMIT },
      }),
      DIFF_THEME,
    ],
    [displayOriginal, langExt],
  );

  const splitSideExt = useMemo(
    () => (lang: Extension | null) => [
      ...SHARED_EXT,
      DEFAULT_INDENT,
      languageCompartment.of(lang ?? []),
      ...READONLY_EXT,
      themeExt,
      DIFF_THEME,
    ],
    [themeExt],
  );

  useEffect(() => {
    if (diffLayout !== "split" || useFallback || !splitHostRef.current) {
      return;
    }
    const sideExtensions = splitSideExt(langExt);
    const view = new MergeView({
      a: { doc: displayOriginal, extensions: sideExtensions },
      b: { doc: displayModified, extensions: sideExtensions },
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
      diffConfig: { scanLimit: DIFF_SCAN_LIMIT },
    });
    mergeViewRef.current = view;
    splitHostRef.current.appendChild(view.dom);
    return () => {
      mergeViewRef.current = null;
      view.destroy();
    };
  }, [
    diffLayout,
    useFallback,
    displayOriginal,
    displayModified,
    langExt,
    splitSideExt,
  ]);

  const gotoChunk = (dir: 1 | -1) => {
    const target =
      diffLayout === "split"
        ? (mergeViewRef.current?.b ?? null)
        : (cmRef.current?.view ?? null);
    if (!target) return;
    const ok = (dir === 1 ? goToNextChunk : goToPreviousChunk)(target);
    if (ok) target.focus();
  };

  // Cache-hit path only: the diff came from the cache before the language
  // pack was imported. Resolve and reconfigure once the view exists.
  useEffect(() => {
    if (useFallback || state.kind !== "loaded" || state.langExt) return;
    let cancelled = false;
    resolveLanguage(path).then((res) => {
      if (cancelled || !res) return;
      setState((s) =>
        s.kind === "loaded" ? { ...s, langExt: res.ext } : s,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [useFallback, path, state]);

  const stats = useMemo(
    () =>
      useFallback ? countDiffLines(fallbackPatch) : { added: 0, removed: 0 },
    [useFallback, fallbackPatch],
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide"
          >
            {chipLabel ?? mode}
          </Badge>
          {isBinary ? (
            <Badge variant="secondary" className="text-[10px]">
              Binary / patch fallback
            </Badge>
          ) : isTooLarge ? (
            <Badge variant="secondary" className="text-[10px]">
              Large file / patch view
            </Badge>
          ) : null}
          <span
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={path}
          >
            {path}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10.5px] tabular-nums text-muted-foreground">
          <span className="max-w-80 truncate font-mono">{repoRoot}</span>
          {useFallback ? (
            <>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{stats.added}
              </span>
              <span className="text-rose-600 dark:text-rose-400">
                −{stats.removed}
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                title="Previous change"
                onClick={() => gotoChunk(-1)}
                className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                ‹
              </button>
              <button
                type="button"
                title="Next change"
                onClick={() => gotoChunk(1)}
                className="cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                ›
              </button>
              <button
                type="button"
                title="Ignore trailing whitespace"
                onClick={() => setIgnoreWs((v) => !v)}
                className={
                  "cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground " +
                  (ignoreWs
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground")
                }
              >
                ws
              </button>
              <button
                type="button"
                title={
                  diffLayout === "split"
                    ? "Switch to unified layout"
                    : "Switch to side-by-side layout"
                }
                onClick={() =>
                  void setDiffLayout(
                    diffLayout === "split" ? "unified" : "split",
                  )
                }
                className="cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                {diffLayout === "split" ? "unified" : "split"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            Loading diff…
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11.5px] text-destructive">
            {state.message}
          </div>
        ) : useFallback ? (
          <ScrollArea className="h-full">
            <pre className="min-h-full whitespace-pre-wrap wrap-break-word p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {fallbackPatch || "Diff preview is not available for this file."}
            </pre>
          </ScrollArea>
        ) : diffLayout === "split" ? (
          <div className="h-full overflow-hidden [&_.cm-mergeView]:h-full [&_.cm-mergeView]:overflow-auto [&_.cm-editor]:h-full">
            <div ref={splitHostRef} className="h-full" />
          </div>
        ) : (
          <CodeMirror
            ref={cmRef}
            value={displayModified}
            theme={themeExt}
            extensions={extensions}
            editable={false}
            height="100%"
            className="h-full"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              searchKeymap: true,
            }}
          />
        )}
      </div>
    </div>
  );
}

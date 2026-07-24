import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Locks the startup-bundle invariant: the heavy editor / AI / markdown stacks
// must stay out of the eager graph of both window entries so they load only
// when the user opens those surfaces. A static import that re-introduces any of
// these (e.g. a barrel re-export of chat runtime, or a `cn`-style util getting
// absorbed into a feature chunk) will fail here. xterm and motion are
// intentionally eager (terminal-first shell) and are not asserted against.
const HEAVY = ["@ai-sdk", "ai", "streamdown", "@codemirror", "@uiw"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_ALIAS = join(ROOT, "src");
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];
const STATIC_IMPORT =
  /(?:^|\n)\s*import\s+(?!type[\s{])(?:[^"';]*?from\s*)?["']([^"']+)["']/g;
const STATIC_EXPORT_FROM =
  /(?:^|\n)\s*export\s+(?!type[\s{])[^"';]*?from\s*["']([^"']+)["']/g;

function resolveLocal(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC_ALIAS, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const ext of EXTS) {
    const path = base + ext;
    if (ext && existsSync(path) && statSync(path).isFile()) return path;
  }
  for (const ext of EXTS.slice(1)) {
    const path = join(base, "index" + ext);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

function staticSpecs(code: string): string[] {
  const specs = new Set<string>();
  for (const re of [STATIC_IMPORT, STATIC_EXPORT_FROM]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(code))) specs.add(match[1]);
  }
  return [...specs];
}

function heavyEagerHits(entry: string): string[] {
  const entryFile = resolve(ROOT, entry);
  const seen = new Set<string>();
  const queue = [entryFile];
  const hits = new Map<string, { spec: string; file: string }>();
  while (queue.length) {
    const file = queue.shift();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let code: string;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const spec of staticSpecs(code)) {
      const local = resolveLocal(spec, file);
      if (local) {
        queue.push(local);
        continue;
      }
      const pkg = HEAVY.find((w) => spec === w || spec.startsWith(w + "/"));
      if (pkg && !hits.has(pkg)) {
        hits.set(pkg, { spec, file: relative(ROOT, file) });
      }
    }
  }
  return [...hits.entries()].map(([pkg, info]) => `${pkg} <- ${info.file}`);
}

describe("startup bundle budget", () => {
  it("main window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/main.tsx")).toEqual([]);
  });

  it("settings window does not eagerly pull editor/AI/markdown stacks", () => {
    expect(heavyEagerHits("src/settings/main.tsx")).toEqual([]);
  });
});

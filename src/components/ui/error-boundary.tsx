import { logWarn } from "@/lib/diagnostics";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Custom fallback renderer; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** A label for which surface crashed, included in the persisted log. */
  name?: string;
};

type State = { error: Error | null };

/**
 * Catches render-time errors in its subtree so a single component crash
 * degrades to a recoverable error state instead of blanking the whole window.
 * Errors are persisted via plugin-log (see diagnostics.ts).
 *
 * Wrap at the top level for a global safety net, or around individual panes
 * for granular recovery (the `fallback` prop lets each surface define its own
 * recovery UI).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const where = this.props.name ?? "unknown surface";
    logWarn(`Render crash in ${where}: ${error.message}`);
    if (info.componentStack) logWarn(`componentStack: ${info.componentStack}`);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-foreground">
          Something went wrong
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Reload window
        </button>
      </div>
    </div>
  );
}

const DUPLICATE_WINDOW_MS = 80;

type RecentCommit = {
  data: string;
  expiresAt: number;
};

export class CompositionInputGate {
  private composing = false;
  private pending: RecentCommit | null = null;
  private accepted: RecentCommit | null = null;

  startComposition(): void {
    this.composing = true;
    this.pending = null;
  }

  endComposition(data: string, now: number): void {
    this.composing = false;
    this.pending = data ? { data, expiresAt: now + DUPLICATE_WINDOW_MS } : null;
  }

  shouldForward(data: string, now: number): boolean {
    if (this.composing) return false;

    if (this.pending && this.pending.expiresAt >= now) {
      const pending = this.pending;
      this.pending = null;
      if (data === pending.data) {
        this.accepted = pending;
        return true;
      }
    } else {
      this.pending = null;
    }

    const accepted = this.accepted;
    if (accepted && accepted.expiresAt >= now && data === accepted.data) {
      this.accepted = null;
      return false;
    }

    this.accepted = null;
    return true;
  }
}

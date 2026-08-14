import { create } from "zustand";

type WorktreeDialogState = {
  open: boolean;
  repoRoot: string | null;
  openDialog: (repoRoot: string) => void;
  close: () => void;
};

export const useWorktreeDialogStore = create<WorktreeDialogState>((set) => ({
  open: false,
  repoRoot: null,
  openDialog: (repoRoot) => set({ open: true, repoRoot }),
  close: () => set({ open: false, repoRoot: null }),
}));

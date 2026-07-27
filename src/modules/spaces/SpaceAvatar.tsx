import { cn } from "@/lib/utils";
import type { SpaceMeta } from "./lib/store";
import { accentFor, spaceInitial } from "./lib/spaceColor";

type Size = "sm" | "md";

const SIZES: Record<Size, string> = {
  sm: "size-5 rounded-[5px] text-[10px]",
  md: "size-7 rounded-md text-[12px]",
};

type Props = {
  space: Pick<SpaceMeta, "name" | "color">;
  size?: Size;
  active?: boolean;
  className?: string;
};

export function SpaceAvatar({ space, size = "sm", active, className }: Props) {
  const accent = accentFor(space);
  // Always carry the space's hue so multiple inactive spaces stay
  // distinguishable at a glance. Active is more saturated; inactive keeps the
  // hue but desaturated so the sidebar isn't visually noisy.
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold leading-none ring-1 ring-inset",
        SIZES[size],
        active ? "ring-transparent" : "ring-border/50",
        className,
      )}
      style={
        active
          ? {
              color: accent,
              backgroundColor: `color-mix(in oklch, ${accent} 16%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${accent} 35%, transparent)`,
            }
          : {
              color: `color-mix(in oklch, ${accent} 55%, var(--muted-foreground))`,
              backgroundColor: `color-mix(in oklch, ${accent} 8%, transparent)`,
            }
      }
    >
      {spaceInitial(space.name)}
    </span>
  );
}

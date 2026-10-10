// A picture for a workspace or person without one: a coloured tile with a symbol, picked from
// a stable seed (an id or name), so the same workspace always gets the same mark and two
// workspaces rarely share one. Never a letter.
import { cn } from "@/lib/utils";

const COLORS = ["#8B5CF6", "#E5484D", "#0E9F8E", "#D97A1A", "#2F80ED", "#D6409F", "#2F9E58", "#4F46E5"];

// Each symbol is drawn white on a 24 by 24 grid.
const SYMBOLS: Array<React.ReactNode> = [
  // Smile
  <g key="smile"><circle cx="9" cy="10.5" r="1.4" fill="#fff" /><circle cx="15" cy="10.5" r="1.4" fill="#fff" /><path d="M8.5 14.2c1.9 2.2 5.1 2.2 7 0" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" /></g>,
  // Spark
  <path key="spark" d="M12 4.5c.6 4.2 3.3 6.9 7.5 7.5-4.2.6-6.9 3.3-7.5 7.5-.6-4.2-3.3-6.9-7.5-7.5 4.2-.6 6.9-3.3 7.5-7.5Z" fill="#fff" />,
  // Orbit
  <g key="orbit"><circle cx="12" cy="12" r="5.5" stroke="#fff" strokeWidth="1.8" fill="none" /><circle cx="16.4" cy="8.2" r="1.9" fill="#fff" /></g>,
  // Peak
  <path key="peak" d="M4.5 17.5 10 8.5l3 4.8 1.8-2.6 4.7 6.8Z" fill="#fff" />,
  // Waves
  <g key="waves" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none"><path d="M5 9.5c2.3-1.8 4.7-1.8 7 0s4.7 1.8 7 0" /><path d="M5 14.5c2.3-1.8 4.7-1.8 7 0s4.7 1.8 7 0" /></g>,
  // Half sun
  <g key="sun"><path d="M6.5 15.5a5.5 5.5 0 0 1 11 0Z" fill="#fff" /><path d="M5 18h14" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></g>,
  // Bolt
  <path key="bolt" d="M13.2 4 6.8 13.2h4.4L10.6 20l6.6-9.4h-4.5Z" fill="#fff" />,
  // Petals
  <g key="petals" fill="#fff"><circle cx="12" cy="8.3" r="2.6" /><circle cx="15.7" cy="12" r="2.6" /><circle cx="12" cy="15.7" r="2.6" /><circle cx="8.3" cy="12" r="2.6" /></g>,
];

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function symbolFor(seed: string) {
  const h = hash(seed || "?");
  return { color: COLORS[h % COLORS.length], symbol: Math.floor(h / COLORS.length) % SYMBOLS.length };
}

export function SymbolMark({ seed, size = 24, round = false, className, title }: { seed: string; size?: number; round?: boolean; className?: string; title?: string }) {
  const { color, symbol } = symbolFor(seed);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-symbol={symbol}
      className={cn("flex-none overflow-hidden", round ? "rounded-full" : "rounded-[28%]", className)}
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" fill={color} />
      {/* A darker slab across the corner gives the tile depth. */}
      <path d="M24 6.5V24H6.5Z" fill="#000" fillOpacity="0.22" />
      {SYMBOLS[symbol]}
    </svg>
  );
}

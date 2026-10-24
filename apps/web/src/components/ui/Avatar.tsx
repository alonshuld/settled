import { cn } from '@/lib/cn';

const palette = ['bg-av-2', 'bg-av-3', 'bg-av-4', 'bg-av-5', 'bg-av-6'];

/** Initial in a pastel circle; `self` uses the lime "you" colour. Colour is stable per name. */
export function Avatar({ name, self, size = 44, className }: { name: string; self?: boolean; size?: number; className?: string }) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-full font-semibold text-accent-ink',
        self ? 'bg-av-1' : palette[hash % palette.length],
        className,
      )}
    >
      {initial}
    </span>
  );
}

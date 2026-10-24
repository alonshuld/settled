export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-block animate-spin rounded-full border-[2.5px] border-current border-e-transparent motion-reduce:animate-none"
    />
  );
}

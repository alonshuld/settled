export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="flex-none">
      <rect width="48" height="48" rx="13" fill="#C6F135" />
      <g transform="rotate(-12 24 24)">
        <rect x="8.5" y="14" width="31" height="20" rx="5.5" fill="none" stroke="#0E1116" strokeWidth="3" />
        <path d="M17 24.2l4.6 4.6 9.4-9.6" fill="none" stroke="#0E1116" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

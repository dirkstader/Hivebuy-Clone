export function Logo({ className = "", size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="OUNDA Procure Logo"
      className={className}
    >
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-primary" />
      <path
        d="M9 20.5V11.5C9 10.6716 9.67157 10 10.5 10H14.5C16.9853 10 19 12.0147 19 14.5C19 16.9853 16.9853 19 14.5 19H11.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M22 13L22 20" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M19.5 15.5L24.5 15.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

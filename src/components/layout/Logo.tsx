export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="strata-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc35a" />
          <stop offset="1" stopColor="#e08a00" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="var(--panel-2)" stroke="var(--line-strong)" />
      <path d="M7 21.5 16 26l9-4.5" fill="none" stroke="url(#strata-g)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
      <path d="M7 16.5 16 21l9-4.5" fill="none" stroke="url(#strata-g)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <path d="M16 6.5 25 11 16 15.5 7 11Z" fill="url(#strata-g)" />
    </svg>
  );
}

export function Wordmark({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <div className="leading-tight">
          <p className="font-display text-[15px] font-bold tracking-[0.18em]">STRATA</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">Mine Intelligence</p>
        </div>
      )}
    </div>
  );
}

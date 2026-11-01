type WeatherIconProps = {
  code: number;
  className?: string;
};

/** Minimal line icons mapped from WMO weather codes. */
export function WeatherIcon({ code, className = "h-8 w-8" }: WeatherIconProps) {
  const stroke = "currentColor";
  const common = {
    fill: "none" as const,
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (code === 0 || code === 1) {
    return (
      <svg viewBox="0 0 32 32" className={className} aria-hidden>
        <circle cx="16" cy="16" r="5" {...common} />
        <path
          d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M7.5 24.5l2.1-2.1M22.4 9.6l2.1-2.1"
          {...common}
        />
      </svg>
    );
  }

  if (code === 2) {
    return (
      <svg viewBox="0 0 32 32" className={className} aria-hidden>
        <circle cx="11" cy="12" r="4" {...common} />
        <path
          d="M11 5v2M5 12H3M7 8l-1.5-1.5M18 18.5c0-3 2.2-5.5 5.2-5.5 2.4 0 4.4 1.5 5.2 3.6 1.7.3 3 1.8 3 3.6 0 2.1-1.7 3.8-3.8 3.8H19.5c-2.2 0-4-1.8-4-4 0-.7.2-1.4.5-2"
          {...common}
        />
      </svg>
    );
  }

  if (code === 3 || code === 45 || code === 48) {
    return (
      <svg viewBox="0 0 32 32" className={className} aria-hidden>
        <path
          d="M9 20h13.5c2.5 0 4.5-2 4.5-4.5S25 11 22.5 11c-.4-2.8-2.8-5-5.7-5-2.4 0-4.5 1.5-5.4 3.6C9.4 10 7 12.2 7 15c0 2.8 2.2 5 5 5z"
          {...common}
        />
      </svg>
    );
  }

  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return (
      <svg viewBox="0 0 32 32" className={className} aria-hidden>
        <path
          d="M9 16h13.5c2.5 0 4.5-2 4.5-4.5S25 7 22.5 7c-.4-2.8-2.8-5-5.7-5-2.4 0-4.5 1.5-5.4 3.6C9.4 6 7 8.2 7 11c0 2.8 2.2 5 5 5z"
          {...common}
        />
        <path d="M12 20l-1.5 3M17 20l-1.5 3M22 20l-1.5 3" {...common} />
      </svg>
    );
  }

  // Rain / showers / thunder default
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path
        d="M9 16h13.5c2.5 0 4.5-2 4.5-4.5S25 7 22.5 7c-.4-2.8-2.8-5-5.7-5-2.4 0-4.5 1.5-5.4 3.6C9.4 6 7 8.2 7 11c0 2.8 2.2 5 5 5z"
        {...common}
      />
      <path d="M12 20v4M17 19v5M22 20v4" {...common} />
    </svg>
  );
}

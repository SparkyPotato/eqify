import React from 'react';

interface EqifyLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

export const EqifyLogo: React.FC<EqifyLogoProps> = ({
  size = 24,
  className = '',
  showText = false,
}) => {
  return (
    <div className={`flex items-center gap-2 select-none pointer-events-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
      >
        <defs>
          <linearGradient id="eqifyLogoBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e2638" />
            <stop offset="100%" stopColor="#0c1017" />
          </linearGradient>

          <linearGradient id="eqifyLogoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>

          <linearGradient id="eqifyLogoFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Squircle Base with Precision Border */}
        <rect
          x="2"
          y="2"
          width="60"
          height="60"
          rx="14"
          fill="url(#eqifyLogoBg)"
          stroke="#2d3a50"
          strokeWidth="2.5"
        />

        {/* Underlying EQ Curve Fill */}
        <path
          d="M 10 44 C 18 44, 22 20, 32 20 C 42 20, 46 44, 54 44 L 54 48 L 10 48 Z"
          fill="url(#eqifyLogoFill)"
        />

        {/* Equalizer Spectrum Bars */}
        <line x1="17" y1="45" x2="17" y2="38" stroke="#06b6d4" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
        <line x1="24.5" y1="45" x2="24.5" y2="28" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
        <line x1="32" y1="45" x2="32" y2="22" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" opacity="0.85" />
        <line x1="39.5" y1="45" x2="39.5" y2="28" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
        <line x1="47" y1="45" x2="47" y2="38" stroke="#06b6d4" strokeWidth="3" strokeLinecap="round" opacity="0.45" />

        {/* Primary Sweeping Parametric EQ Curve */}
        <path
          d="M 10 44 C 18 44, 22 20, 32 20 C 42 20, 46 44, 54 44"
          stroke="url(#eqifyLogoGrad)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Apex Resonant Filter Node Dot */}
        <circle cx="32" cy="20" r="5" fill="#f59e0b" />
        <circle cx="32" cy="20" r="2.2" fill="#ffffff" />
      </svg>

      {showText && (
        <span className="font-extrabold tracking-wider text-sm flex items-center">
          <span className="text-amber-400">EQ</span>
          <span className="text-slate-100">ify</span>
        </span>
      )}
    </div>
  );
};

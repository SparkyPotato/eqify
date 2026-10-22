import React, { useState, useRef, useEffect, useCallback } from 'react';

interface RotaryKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  isLogarithmic?: boolean;
  unit?: string;
  formatValue?: (val: number) => string;
  onChange: (val: number) => void;
  accentColor?: string;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  value,
  min,
  max,
  step = 0.1,
  isLogarithmic = false,
  unit = '',
  formatValue,
  onChange,
  accentColor = '#eab308',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [inputText, setInputText] = useState('');
  const dragStartY = useRef(0);
  const dragStartValue = useRef(0);

  // Normalize value to 0..1 range
  const toNorm = useCallback(
    (v: number): number => {
      const clamped = Math.max(min, Math.min(max, v));
      if (isLogarithmic) {
        const logMin = Math.log10(min);
        const logMax = Math.log10(max);
        return (Math.log10(clamped) - logMin) / (logMax - logMin);
      }
      return (clamped - min) / (max - min);
    },
    [min, max, isLogarithmic]
  );

  // From 0..1 to value
  const fromNorm = useCallback(
    (norm: number): number => {
      const clampedNorm = Math.max(0, Math.min(1, norm));
      if (isLogarithmic) {
        const logMin = Math.log10(min);
        const logMax = Math.log10(max);
        return Math.pow(10, logMin + clampedNorm * (logMax - logMin));
      }
      return min + clampedNorm * (max - min);
    },
    [min, max, isLogarithmic]
  );

  const norm = toNorm(value);
  // Knobs typically rotate from -135deg to +135deg (total 270deg)
  const angle = -135 + norm * 270;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return;
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartValue.current = value;
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY; // upward is positive
      const sensitivity = 200; // pixels for full range
      const startNorm = toNorm(dragStartValue.current);
      const newNorm = Math.max(0, Math.min(1, startNorm + deltaY / sensitivity));
      let newVal = fromNorm(newNorm);

      if (step > 0 && !isLogarithmic) {
        newVal = Math.round(newVal / step) * step;
      }
      onChange(newVal);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, toNorm, fromNorm, step, isLogarithmic, onChange]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const currentNorm = toNorm(value);
    const newNorm = Math.max(0, Math.min(1, currentNorm + dir * 0.03));
    let newVal = fromNorm(newNorm);
    if (step > 0 && !isLogarithmic) {
      newVal = Math.round(newVal / step) * step;
    }
    onChange(newVal);
  };

  const displayText = formatValue
    ? formatValue(value)
    : `${value > 0.001 && unit.includes('dB') ? '+' : ''}${value.toFixed(1)}${unit ? ' ' + unit : ''}`;

  const handleInputSubmit = () => {
    setIsEditing(false);
    const parsed = parseFloat(inputText);
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(clamped);
    }
  };

  // SVG arc calculations
  const radius = 22;
  const strokeWidth = 3;
  const cx = 28;
  const cy = 28;
  const circumference = 2 * Math.PI * radius;
  // 270 degrees arc
  const arcTotal = (270 / 360) * circumference;
  const strokeDashoffset = arcTotal * (1 - norm);

  return (
    <div className="flex flex-col items-center select-none" onWheel={handleWheel}>
      {label ? (
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
          {label}
        </span>
      ) : null}

      <div
        className="relative cursor-ns-resize group"
        onMouseDown={handleMouseDown}
        onDoubleClick={() => {
          setInputText(value.toString());
          setIsEditing(true);
        }}
      >
        <svg width="56" height="56" className="transform rotate-[135deg]">
          {/* Background track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="transparent"
            stroke="#262c38"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcTotal} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Active progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="transparent"
            stroke={accentColor}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcTotal} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{
              filter: isDragging ? `drop-shadow(0 0 4px ${accentColor})` : undefined,
            }}
          />
        </svg>

        {/* Center Knob Body */}
        <div
          className="absolute inset-[9px] rounded-full bg-[#181c24] border border-[#343c4e] flex items-center justify-center shadow-inner group-hover:border-slate-500 transition-colors"
          style={{
            transform: `rotate(${angle}deg)`,
          }}
        >
          {/* Pointer tick */}
          <div
            className="absolute top-1 w-1 h-2 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        </div>
      </div>

      {/* Numeric value badge */}
      {isEditing ? (
        <input
          type="text"
          autoFocus
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onBlur={handleInputSubmit}
          onKeyDown={(e) => e.key === 'Enter' && handleInputSubmit()}
          className="w-16 mt-1 text-center bg-slate-900 border border-amber-500 text-xs text-white rounded px-1 py-0.5 outline-none font-mono"
        />
      ) : (
        <button
          onClick={() => {
            setInputText(value.toString());
            setIsEditing(true);
          }}
          className="mt-1 px-2 py-0.5 text-xs font-mono font-medium text-slate-200 bg-[#171b24] hover:bg-[#202634] border border-[#2b3344] rounded cursor-text transition-colors"
        >
          {displayText}
        </button>
      )}
    </div>
  );
};

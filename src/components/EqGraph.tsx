import React, { useRef, useState, useEffect, useMemo } from 'react';
import type { FilterBand, ToneGeneratorState } from '../types/eq';
import {
  FREQ_TICKS,
  freqToX,
  xToFreq,
  gainToY,
  yToGain,
  getGainTicks,
  formatFreq,
  formatFreqFull,
} from '../utils/biquad';
import { RotaryKnob } from './RotaryKnob';
import { PeakFilterIcon, LowShelfFilterIcon, HighShelfFilterIcon } from './FilterIcons';
import {
  Power,
  Trash2,
  ArrowUpDown,
  Lock,
  Unlock,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AudioWaveform,
} from 'lucide-react';

interface EqGraphProps {
  filters: FilterBand[];
  selectedFilterIndex: number | null;
  onSelectFilter: (index: number | null) => void;
  onUpdateFilter: (index: number, updated: Partial<FilterBand>) => void;
  onDeleteFilter: (index: number) => void;
  onAddFilterAt: (freq: number, gain: number) => void;
  totalCurve: number[];
  filterCurves: number[][];
  freqs: number[];
  preamp: number;
  toneState?: ToneGeneratorState;
  onUpdateToneState?: (updated: Partial<ToneGeneratorState>) => void;
}

export const EqGraph: React.FC<EqGraphProps> = ({
  filters,
  selectedFilterIndex,
  onSelectFilter,
  onUpdateFilter,
  onDeleteFilter,
  onAddFilterAt,
  totalCurve,
  filterCurves,
  freqs,
  preamp,
  toneState,
  onUpdateToneState,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 460 });
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isDraggingTone, setIsDraggingTone] = useState(false);
  const rafRef = useRef<number | null>(null);
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);
  const pendingToneFreqRef = useRef<number | null>(null);
  const toneRafRef = useRef<number | null>(null);

  // Zoom scale state: dB range (±30 dB, ±20 dB default, ±15 dB, ±12 dB, ±9 dB, ±6 dB, ±3 dB)
  const ZOOM_LEVELS = useMemo(() => [30, 20, 15, 12, 9, 6, 3], []);
  const DEFAULT_ZOOM_INDEX = 1; // 20 dB (±20 dB)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const maxGain = ZOOM_LEVELS[zoomIndex];
  const minGain = -maxGain;
  const gainTicks = useMemo(() => getGainTicks(maxGain), [maxGain]);

  const handleZoomIn = () => {
    setZoomIndex((prev) => Math.min(ZOOM_LEVELS.length - 1, prev + 1));
  };

  const handleZoomOut = () => {
    setZoomIndex((prev) => Math.max(0, prev - 1));
  };

  const handleResetZoom = () => {
    setZoomIndex(DEFAULT_ZOOM_INDEX);
  };

  const handleGraphWheel = (e: React.WheelEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-dot]') ||
      target.closest('[data-inspector]') ||
      target.closest('button') ||
      target.closest('input')
    ) {
      return;
    }
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else if (e.deltaY > 0) {
      handleZoomOut();
    }
  };

  // Resize observer to keep graph perfectly responsive
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    };
    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Cleanup pending animation frames on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (toneRafRef.current !== null) {
        cancelAnimationFrame(toneRafRef.current);
      }
    };
  }, []);

  const { width, height } = dimensions;
  const paddingLeft = 46;
  const paddingRight = 20;
  const paddingTop = 24;
  const paddingBottom = 34;

  // Preamp clipping threshold
  const thresholdDb = -preamp;
  const thresholdY = gainToY(thresholdDb, height, paddingTop, paddingBottom, minGain, maxGain);

  // Selected filter object
  const selectedFilter =
    selectedFilterIndex !== null && selectedFilterIndex >= 0 && selectedFilterIndex < filters.length
      ? filters[selectedFilterIndex]
      : null;

  // Tone generator state helpers
  const isTonePlaying = !!(toneState && toneState.isPlaying);
  const toneX = isTonePlaying
    ? freqToX(toneState.freq, width, paddingLeft, paddingRight)
    : 0;

  const handleToneMove = (clientX: number) => {
    if (!containerRef.current || !onUpdateToneState) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const clampedX = Math.max(paddingLeft, Math.min(width - paddingRight, mouseX));
    const newFreq = Math.round(xToFreq(clampedX, width, paddingLeft, paddingRight));
    const safeFreq = Math.max(20, Math.min(20000, newFreq));

    pendingToneFreqRef.current = safeFreq;
    if (toneRafRef.current === null) {
      toneRafRef.current = requestAnimationFrame(() => {
        toneRafRef.current = null;
        if (pendingToneFreqRef.current !== null) {
          onUpdateToneState({ freq: pendingToneFreqRef.current });
        }
      });
    }
  };

  const handleTonePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setIsDraggingTone(true);
  };

  const handleTonePointerUp = (e: React.PointerEvent) => {
    if (toneRafRef.current !== null) {
      cancelAnimationFrame(toneRafRef.current);
      toneRafRef.current = null;
    }
    pendingToneFreqRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // safe
    }
    setIsDraggingTone(false);
  };

  // Handle dragging filter dots
  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    if (isLocked) {
      onSelectFilter(index);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraggingIndex(index);
    onSelectFilter(index);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDraggingTone) {
      handleToneMove(e.clientX);
      return;
    }
    if (draggingIndex === null || isLocked) return;
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    pendingPointRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (draggingIndex === null || pendingPointRef.current === null) return;
        const { x, y } = pendingPointRef.current;
        const newFreq = Math.round(xToFreq(x, width, paddingLeft, paddingRight));
        const newGain = parseFloat(
          yToGain(y, height, paddingTop, paddingBottom, minGain, maxGain).toFixed(1)
        );

        onUpdateFilter(draggingIndex, {
          freq: Math.max(20, Math.min(20000, newFreq)),
          gain: Math.max(-20, Math.min(20, newGain)),
        });
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingTone) {
      handleTonePointerUp(e);
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingPointRef.current = null;
    if (draggingIndex !== null) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        // safe
      }
      setDraggingIndex(null);
    }
  };

  // Adjust Q with mouse wheel on dot
  const handleDotWheel = (index: number, e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isLocked) return;
    const currentQ = filters[index]?.q || 1.41;
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    const newQ = Math.max(0.1, Math.min(10.0, parseFloat((currentQ + delta).toFixed(2))));
    onUpdateFilter(index, { q: newQ });
  };

  // Double click canvas to add new band
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isLocked || !containerRef.current) return;
    const target = e.target as HTMLElement;
    // Prevent adding filters when double clicking buttons, inputs, knobs, inspector popover, or dots
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('[data-inspector]') ||
      target.closest('[data-dot]')
    ) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (
      mouseX >= paddingLeft &&
      mouseX <= width - paddingRight &&
      mouseY >= paddingTop &&
      mouseY <= height - paddingBottom
    ) {
      const freq = Math.round(xToFreq(mouseX, width, paddingLeft, paddingRight));
      const gain = parseFloat(
        yToGain(mouseY, height, paddingTop, paddingBottom, minGain, maxGain).toFixed(1)
      );
      onAddFilterAt(freq, gain);
    }
  };

  // Generate SVG path for total EQ curve
  const totalCurvePath = useMemo(() => {
    if (!freqs.length || !totalCurve.length) return '';
    let path = '';
    for (let i = 0; i < freqs.length; i++) {
      const x = freqToX(freqs[i], width, paddingLeft, paddingRight);
      const y = gainToY(totalCurve[i], height, paddingTop, paddingBottom, minGain, maxGain);
      if (i === 0) {
        path += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      } else {
        path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
    }
    return path;
  }, [freqs, totalCurve, width, height, paddingLeft, paddingRight, paddingTop, paddingBottom, minGain, maxGain]);

  // Generate SVG area path under total curve for glow fill
  const totalCurveAreaPath = useMemo(() => {
    if (!totalCurvePath || !freqs.length) return '';
    const startX = freqToX(freqs[0], width, paddingLeft, paddingRight);
    const endX = freqToX(freqs[freqs.length - 1], width, paddingLeft, paddingRight);
    const zeroY = gainToY(0, height, paddingTop, paddingBottom, minGain, maxGain);
    return `${totalCurvePath} L ${endX} ${zeroY} L ${startX} ${zeroY} Z`;
  }, [totalCurvePath, freqs, width, height, paddingLeft, paddingRight, paddingTop, paddingBottom, minGain, maxGain]);

  // Generate individual filter curve paths
  const individualPaths = useMemo(() => {
    if (!filterCurves.length || !freqs.length) return [];
    return filterCurves.map((curve, idx) => {
      const filter = filters[idx];
      if (!filter || !filter.enabled) return '';
      let path = '';
      for (let i = 0; i < freqs.length; i++) {
        const x = freqToX(freqs[i], width, paddingLeft, paddingRight);
        const y = gainToY(curve[i], height, paddingTop, paddingBottom, minGain, maxGain);
        if (i === 0) {
          path += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        } else {
          path += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        }
      }
      return path;
    });
  }, [filterCurves, freqs, filters, width, height, paddingLeft, paddingRight, paddingTop, paddingBottom, minGain, maxGain]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#12151b] overflow-hidden select-none border border-[#1e232d] rounded-2xl shadow-2xl flex flex-col justify-between"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onWheel={handleGraphWheel}
    >
      {/* Floating Zoom & Reset Controls */}
      <div
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute top-2.5 right-3 z-40 flex items-center bg-[#151922]/90 backdrop-blur-md border border-[#273142] rounded-xl p-1 gap-1 shadow-lg select-none"
      >
        <button
          onClick={handleZoomOut}
          disabled={zoomIndex === 0}
          className="p-1.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-[#1f2735] rounded-lg transition-colors cursor-pointer"
          title="Zoom Out (Expand dB scale)"
        >
          <ZoomOut size={13} />
        </button>

        <span
          className="px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-300 min-w-[50px] text-center"
          title="Current vertical scale range (Scroll wheel on graph to zoom)"
        >
          ±{maxGain} dB
        </span>

        <button
          onClick={handleZoomIn}
          disabled={zoomIndex === ZOOM_LEVELS.length - 1}
          className="p-1.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 disabled:hover:text-slate-400 hover:bg-[#1f2735] rounded-lg transition-colors cursor-pointer"
          title="Zoom In (Magnify dB scale)"
        >
          <ZoomIn size={13} />
        </button>

        <div className="w-[1px] h-3.5 bg-[#252e3e] mx-0.5" />

        <button
          onClick={handleResetZoom}
          disabled={zoomIndex === DEFAULT_ZOOM_INDEX}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer ${
            zoomIndex !== DEFAULT_ZOOM_INDEX
              ? 'text-amber-400 hover:bg-amber-500/15'
              : 'text-slate-500 opacity-40 hover:text-slate-500'
          }`}
          title="Reset Zoom to Default (±20 dB)"
        >
          <RotateCcw size={11} />
          <span>Reset</span>
        </button>

        <div className="w-[1px] h-3.5 bg-[#252e3e] mx-0.5" />

        <button
          onClick={() => setIsLocked(!isLocked)}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
            isLocked
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#1f2735]'
          }`}
          title={isLocked ? 'Graph is Locked (Click to Unlock editing)' : 'Lock Graph Editing (Prevent accidental adjustments)'}
        >
          {isLocked ? <Lock size={12} className="text-amber-400" /> : <Unlock size={12} />}
          <span>{isLocked ? 'Locked' : 'Lock'}</span>
        </button>
      </div>

      {/* Main SVG Graph */}
      <svg
        width={width}
        height={height}
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <defs>
          {/* Subtle gradient fill under master curve */}
          <linearGradient id="eqGlowGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eab308" stopOpacity="0.22" />
            <stop offset="60%" stopColor="#eab308" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#eab308" stopOpacity="0.0" />
          </linearGradient>

          {/* Dark red clipping gradient for area above preamp ceiling */}
          <linearGradient id="clipRedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7f1d1d" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#991b1b" stopOpacity="0.35" />
          </linearGradient>

          {/* Clip path defining region strictly above the preamp threshold */}
          <clipPath id="clippingZone">
            <rect
              x={paddingLeft}
              y={paddingTop}
              width={width - paddingLeft - paddingRight}
              height={Math.max(0, thresholdY - paddingTop)}
            />
          </clipPath>
        </defs>

        {/* Horizontal dB Grid Lines */}
        {gainTicks.map((gain) => {
          const y = gainToY(gain, height, paddingTop, paddingBottom, minGain, maxGain);
          const isZero = gain === 0;
          return (
            <g key={`gain-${gain}`}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke={isZero ? '#2e4238' : '#1a202b'}
                strokeWidth={isZero ? 1.5 : 1}
                strokeDasharray={isZero ? undefined : '2 3'}
              />
              <text
                x={paddingLeft - 8}
                y={y + 3.5}
                fill={isZero ? '#4ade80' : '#4b5563'}
                fontSize="10"
                fontFamily="monospace"
                textAnchor="end"
              >
                {gain > 0 ? `+${gain}dB` : `${gain}dB`}
              </text>
            </g>
          );
        })}

        {/* Vertical Log Frequency Grid Lines */}
        {FREQ_TICKS.map((freq) => {
          const x = freqToX(freq, width, paddingLeft, paddingRight);
          const isMajor = [20, 50, 100, 500, 1000, 5000, 10000, 20000].includes(freq);
          return (
            <g key={`freq-${freq}`}>
              <line
                x1={x}
                y1={paddingTop}
                x2={x}
                y2={height - paddingBottom}
                stroke={isMajor ? '#1f2735' : '#161b24'}
                strokeWidth={1}
              />
              {isMajor && (
                <text
                  x={x}
                  y={height - paddingBottom + 16}
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {formatFreq(freq)}
                </text>
              )}
            </g>
          );
        })}

        {/* Individual Filter Curves (faint background lines) */}
        {individualPaths.map((path, idx) => {
          const filter = filters[idx];
          if (!path || !filter) return null;
          const isSelected = selectedFilterIndex === idx;
          const color = filter.color || '#eab308';
          return (
            <path
              key={`indiv-${filter.id || idx}`}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={isSelected ? 1.8 : 1.0}
              strokeOpacity={isSelected ? 0.75 : 0.35}
              strokeDasharray={isSelected ? undefined : '4 3'}
            />
          );
        })}

        {/* Preamp Threshold Ceiling Line */}
        {thresholdDb <= maxGain && thresholdDb >= minGain && (
          <g>
            <line
              x1={paddingLeft}
              y1={thresholdY}
              x2={width - paddingRight}
              y2={thresholdY}
              stroke="#ef4444"
              strokeWidth="1.2"
              strokeDasharray="4 3"
              strokeOpacity="0.65"
            />
            <text
              x={width - paddingRight - 8}
              y={thresholdY - 4}
              fill="#ef4444"
              fontSize="9"
              fontFamily="monospace"
              fontWeight="bold"
              textAnchor="end"
              opacity="0.85"
            >
              PREAMP CEILING ({thresholdDb >= 0 ? `+${thresholdDb.toFixed(1)}` : thresholdDb.toFixed(1)} dB)
            </text>
          </g>
        )}

        {/* Master Total Curve Area Glow */}
        {totalCurveAreaPath && (
          <path d={totalCurveAreaPath} fill="url(#eqGlowGradient)" />
        )}

        {/* Master Total Curve Line */}
        {totalCurvePath && (
          <path
            d={totalCurvePath}
            fill="none"
            stroke="#eab308"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: 'drop-shadow(0 0 6px rgba(234, 179, 8, 0.45))',
            }}
          />
        )}

        {/* Highlight Area Above Preamp Threshold in Dark Red */}
        {totalCurveAreaPath && thresholdDb <= maxGain && (
          <path
            d={totalCurveAreaPath}
            fill="url(#clipRedGradient)"
            clipPath="url(#clippingZone)"
          />
        )}

        {/* Highlight Curve Line Above Preamp Threshold in Dark Red */}
        {totalCurvePath && thresholdDb <= maxGain && (
          <path
            d={totalCurvePath}
            fill="none"
            stroke="#b91c1c"
            strokeWidth="3.0"
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath="url(#clippingZone)"
            style={{
              filter: 'drop-shadow(0 0 8px rgba(185, 28, 28, 0.85))',
            }}
          />
        )}

        {/* Draggable Vertical Cyan Line when Tone Generator is Playing */}
        {isTonePlaying && (
          <g className="pointer-events-none">
            <rect
              x={toneX - 12}
              y={paddingTop}
              width={24}
              height={Math.max(0, height - paddingTop - paddingBottom)}
              fill="#06b6d4"
              opacity={isDraggingTone ? 0.09 : 0.04}
            />
            <line
              x1={toneX}
              y1={paddingTop}
              x2={toneX}
              y2={height - paddingBottom}
              stroke="#06b6d4"
              strokeWidth={isDraggingTone ? 2.5 : 1.5}
              strokeDasharray={isDraggingTone ? undefined : '5 3'}
              opacity={isDraggingTone ? 1.0 : 0.85}
              style={{
                filter: isDraggingTone
                  ? 'drop-shadow(0 0 8px rgba(6, 182, 212, 0.95))'
                  : 'drop-shadow(0 0 5px rgba(6, 182, 212, 0.75))',
              }}
            />
          </g>
        )}
      </svg>

      {/* Interactive Filter Highlight Dots & Draggable Tone Line */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Draggable Vertical Cyan Line Handle & Frequency Tag */}
        {isTonePlaying && (
          <div
            data-tone-handle="true"
            style={{
              left: `${toneX}px`,
              top: `${paddingTop}px`,
              height: `${Math.max(0, height - paddingTop - paddingBottom)}px`,
              transform: 'translateX(-50%)',
            }}
            className={`absolute w-8 pointer-events-auto z-35 flex flex-col items-center justify-start cursor-ew-resize select-none group transition-opacity ${
              isDraggingTone ? 'opacity-100' : 'opacity-90 hover:opacity-100'
            }`}
            onPointerDown={handleTonePointerDown}
            onPointerMove={(e) => {
              if (isDraggingTone) {
                handleToneMove(e.clientX);
              }
            }}
            onPointerUp={handleTonePointerUp}
            onPointerCancel={handleTonePointerUp}
            onDoubleClick={(e) => e.stopPropagation()}
            title="Drag horizontally to adjust tone frequency"
          >
            {/* Top Frequency Badge Pill */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] font-bold tracking-tight transition-all shadow-xl -translate-y-2.5 pointer-events-none ${
                isDraggingTone
                  ? 'bg-[#091824] text-cyan-200 border-2 border-cyan-300 ring-2 ring-cyan-400/50 scale-105 shadow-[0_0_16px_rgba(6,182,212,0.6)]'
                  : 'bg-[#0d1620]/95 text-cyan-300 border border-cyan-500/70 group-hover:border-cyan-400 group-hover:bg-[#091824] shadow-[0_0_10px_rgba(6,182,212,0.4)]'
              }`}
            >
              <AudioWaveform size={11} className="text-cyan-400 shrink-0" />
              <span className="whitespace-nowrap">{formatFreqFull(toneState.freq)}</span>
            </div>
          </div>
        )}

        {filters.map((filter, idx) => {
          const x = freqToX(filter.freq, width, paddingLeft, paddingRight);
          const y = gainToY(filter.gain, height, paddingTop, paddingBottom, minGain, maxGain);
          const isSelected = selectedFilterIndex === idx;
          const isHovered = hoveredIndex === idx;
          const isDragging = draggingIndex === idx;
          const color = filter.color || '#eab308';

          return (
            <div
              key={filter.id || idx}
              data-dot="true"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute pointer-events-auto z-30 group ${
                isLocked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
              }`}
              onPointerDown={(e) => handlePointerDown(idx, e)}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              onWheel={(e) => handleDotWheel(idx, e)}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {/* Outer soft focus ring when selected/hovered (no ping animation) */}
              {(isSelected || isHovered || isDragging) && (
                <div
                  className="absolute inset-[-4px] rounded-full opacity-35 pointer-events-none transition-all"
                  style={{
                    backgroundColor: color,
                    boxShadow: `0 0 8px ${color}`,
                  }}
                />
              )}

              {/* Bandwidth Q indicator whiskers on hover/drag */}
              {(isHovered || isDragging || isSelected) && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-[2px] rounded-full pointer-events-none opacity-40 transition-all"
                  style={{
                    backgroundColor: color,
                    width: `${Math.max(20, Math.min(140, 100 / (filter.q || 1)))}px`,
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              )}

              {/* Highlight Dot Body */}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shadow-lg transition-transform ${
                  isSelected
                    ? 'ring-2 ring-white scale-110'
                    : 'hover:scale-110 opacity-90 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: filter.enabled ? color : '#374151',
                  color: '#0f172a',
                  boxShadow: `0 0 10px ${filter.enabled ? color : '#000'}80`,
                }}
              >
                {idx + 1}
              </div>

              {/* Mini Tooltip above dot */}
              {(isHovered || isDragging) && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-slate-700 text-[10px] text-white px-2 py-0.5 rounded shadow-xl whitespace-nowrap pointer-events-none z-50 flex items-center">
                  <span className="font-mono font-medium">{formatFreqFull(filter.freq)}</span>
                  <span className="text-slate-400 mx-1">|</span>
                  <span className="font-mono text-amber-300">
                    {filter.gain >= 0 ? `+${filter.gain.toFixed(1)}` : filter.gain.toFixed(1)} dB
                  </span>
                  <span className="text-slate-400 mx-1">|</span>
                  <span className="font-mono text-cyan-300">Q {filter.q.toFixed(2)}</span>
                  {isLocked && <span className="text-amber-400 font-semibold ml-1.5 flex items-center gap-0.5"><Lock size={10} /> Locked</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Filter Inspector Popover (Docked at bottom center, exactly like Screenshot 1) */}
      {selectedFilter && selectedFilterIndex !== null && (
        <div
          data-inspector="true"
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-[#161b24]/95 backdrop-blur-md border border-[#2d3546] rounded-xl px-5 py-3 shadow-2xl flex items-center gap-6 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          {/* Left: Band number + filter type selector pills */}
          <div className="flex flex-col items-center gap-2 pr-4 border-r border-[#262f3f]">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono text-slate-100">
                {selectedFilterIndex + 1}
              </span>
              <button
                disabled={isLocked}
                onClick={() =>
                  onUpdateFilter(selectedFilterIndex, { enabled: !selectedFilter.enabled })
                }
                className={`p-1.5 rounded-md transition-colors ${
                  isLocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                } ${
                  selectedFilter.enabled
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
                }`}
                title={selectedFilter.enabled ? 'Filter Enabled' : 'Filter Disabled'}
              >
                <Power size={13} />
              </button>
            </div>

            {/* Filter Type Selector Buttons (Peak, Low Shelf, High Shelf) */}
            <div className={`flex items-center bg-[#10131a] p-1 rounded-lg border border-[#262e3d] gap-1 ${
              isLocked ? 'opacity-40 pointer-events-none' : ''
            }`}>
              <button
                disabled={isLocked}
                onClick={() => onUpdateFilter(selectedFilterIndex, { filter_type: 'PK' })}
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                  selectedFilter.filter_type === 'PK'
                    ? 'bg-amber-500 text-slate-950 shadow-md ring-1 ring-amber-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1b222e]'
                }`}
                title="Peak / Bell Filter"
              >
                <PeakFilterIcon size={18} strokeWidth={2.2} />
              </button>
              <button
                disabled={isLocked}
                onClick={() => onUpdateFilter(selectedFilterIndex, { filter_type: 'LSC' })}
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                  selectedFilter.filter_type === 'LSC'
                    ? 'bg-amber-500 text-slate-950 shadow-md ring-1 ring-amber-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1b222e]'
                }`}
                title="Low Shelf Filter"
              >
                <LowShelfFilterIcon size={18} strokeWidth={2.2} />
              </button>
              <button
                disabled={isLocked}
                onClick={() => onUpdateFilter(selectedFilterIndex, { filter_type: 'HSC' })}
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-all cursor-pointer ${
                  selectedFilter.filter_type === 'HSC'
                    ? 'bg-amber-500 text-slate-950 shadow-md ring-1 ring-amber-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1b222e]'
                }`}
                title="High Shelf Filter"
              >
                <HighShelfFilterIcon size={18} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          {/* Center: Rotary Knobs for FREQ, GAIN, Q */}
          <div className={`flex items-center gap-5 ${isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
            <RotaryKnob
              label="FREQ"
              value={selectedFilter.freq}
              min={20}
              max={20000}
              isLogarithmic={true}
              formatValue={formatFreqFull}
              onChange={(f) => onUpdateFilter(selectedFilterIndex, { freq: Math.round(f) })}
              accentColor="#06b6d4"
            />
            <RotaryKnob
              label="GAIN"
              value={selectedFilter.gain}
              min={-20}
              max={20}
              step={0.1}
              unit="dB"
              onChange={(g) => onUpdateFilter(selectedFilterIndex, { gain: g })}
              accentColor="#eab308"
            />
            <RotaryKnob
              label="Q"
              value={selectedFilter.q}
              min={0.1}
              max={10.0}
              step={0.05}
              formatValue={(q) => q.toFixed(2)}
              onChange={(q) => onUpdateFilter(selectedFilterIndex, { q })}
              accentColor="#10b981"
            />
          </div>

          {/* Right: Quick actions (Invert gain, Delete, Tone Jump) */}
          <div className="flex flex-col gap-1.5 pl-3 border-l border-[#262f3f]">
            <button
              disabled={isLocked}
              onClick={() =>
                onUpdateFilter(selectedFilterIndex, { gain: -selectedFilter.gain })
              }
              className={`p-1.5 rounded transition-colors ${
                isLocked
                  ? 'opacity-30 cursor-not-allowed text-slate-500'
                  : 'text-slate-400 hover:text-amber-400 hover:bg-slate-800/80 cursor-pointer'
              }`}
              title={isLocked ? 'Locked' : 'Invert Gain'}
            >
              <ArrowUpDown size={14} />
            </button>
            <button
              disabled={isLocked}
              onClick={() => onDeleteFilter(selectedFilterIndex)}
              className={`p-1.5 rounded transition-colors ${
                isLocked
                  ? 'opacity-30 cursor-not-allowed text-slate-500'
                  : 'text-slate-400 hover:text-red-400 hover:bg-slate-800/80 cursor-pointer'
              }`}
              title={isLocked ? 'Locked' : 'Delete Band'}
            >
              <Trash2 size={14} />
            </button>
            {/* Cyan Tone Button - enabled when tone generator is playing to jump tone to filter frequency */}
            <button
              disabled={!isTonePlaying}
              onClick={() => {
                if (isTonePlaying && onUpdateToneState) {
                  onUpdateToneState({ freq: selectedFilter.freq });
                }
              }}
              className={`p-1.5 rounded transition-all ${
                isTonePlaying
                  ? Math.round(toneState.freq) === Math.round(selectedFilter.freq)
                    ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.45)] cursor-pointer'
                    : 'text-cyan-400 hover:text-cyan-200 hover:bg-cyan-500/20 border border-cyan-500/40 cursor-pointer'
                  : 'opacity-25 text-slate-600 border border-transparent cursor-not-allowed'
              }`}
              title={
                isTonePlaying
                  ? `Jump Tone to ${formatFreqFull(selectedFilter.freq)}`
                  : 'Tone Generator is stopped (Start tone to jump to filter frequency)'
              }
            >
              <AudioWaveform size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

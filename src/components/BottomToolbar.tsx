import React from 'react';
import { Power, Play, Square } from 'lucide-react';
import { RotaryKnob } from './RotaryKnob';
import type { ToneGeneratorState } from '../types/eq';

interface BottomToolbarProps {
  isBypassed: boolean;
  onToggleBypass: () => void;
  preamp: number;
  onPreampChange: (val: number) => void;
  recommendedPreamp: number;
  autoPreamp: boolean;
  onToggleAutoPreamp: (val: boolean) => void;
  toneState: ToneGeneratorState;
  onToggleTonePlay: () => void;
  onUpdateToneState: (updated: Partial<ToneGeneratorState>) => void;
}

export const BottomToolbar: React.FC<BottomToolbarProps> = ({
  isBypassed,
  onToggleBypass,
  preamp,
  onPreampChange,
  recommendedPreamp: _recommendedPreamp,
  autoPreamp,
  onToggleAutoPreamp,
  toneState,
  onToggleTonePlay,
  onUpdateToneState,
}) => {
  return (
    <div className="w-full bg-[#12151b] border-t border-[#1e232d] select-none">
      {/* Controls Row */}
      <div className="px-4 py-2.5 flex items-center gap-3 overflow-x-auto">
        {/* BIG MASTER POWER BUTTON - EXACT SQUARE MATCHING PREAMP HEIGHT */}
        <button
          onClick={onToggleBypass}
          className={`h-[88px] w-[88px] rounded-2xl flex items-center justify-center transition-all border cursor-pointer select-none shrink-0 ${
            !isBypassed
              ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-slate-950 border-amber-300 shadow-[0_0_24px_rgba(245,158,11,0.45)] active:scale-95'
              : 'bg-[#151922] text-slate-500 border-[#1e2533] hover:text-slate-300 hover:border-slate-500 active:scale-95'
          }`}
          title={isBypassed ? 'EQ is Bypassed (Click to Enable)' : 'EQ is Active (Click to Bypass)'}
        >
          <Power
            size={36}
            className={`transition-transform duration-200 ${
              !isBypassed ? 'stroke-[3] text-slate-950 scale-110' : 'stroke-[2.2] text-slate-500'
            }`}
          />
        </button>

        {/* PREAMP SECTION - Height 88px */}
        <div className="relative h-[88px] flex items-center gap-4 border border-[#1e2533] bg-[#151922] px-4 py-2 rounded-2xl shrink-0">
          <span className="absolute -top-2 left-4 px-1.5 bg-[#12151b] text-[10px] font-bold tracking-wider text-slate-400 uppercase select-none pointer-events-none z-10">
            PREAMP
          </span>
          <div className={autoPreamp ? 'opacity-40 pointer-events-none transition-opacity' : 'transition-opacity'}>
            <RotaryKnob
              label=""
              value={preamp}
              min={-20}
              max={0.0}
              step={0.5}
              unit="dB"
              onChange={(val) => onPreampChange(Math.min(0.0, Math.max(-20, val)))}
              accentColor="#eab308"
            />
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => onToggleAutoPreamp(!autoPreamp)}
              className={`px-3 py-1.5 text-[11px] font-bold tracking-wider rounded-lg transition-all border cursor-pointer ${
                autoPreamp
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.45)]'
                  : 'bg-[#1b212d] text-slate-400 border-[#2d374a] hover:text-slate-200 hover:border-slate-500'
              }`}
              title={autoPreamp ? 'Auto Preamp Enabled (Control greyed out, dynamically updated)' : 'Enable Auto Preamp'}
            >
              AUTO
            </button>
            <span className="text-[10px] font-mono text-slate-400 font-semibold">
              {preamp.toFixed(1)} dB
            </span>
          </div>
        </div>

        {/* INLINED TONE GENERATOR - Height 88px matching PREAMP & Power */}
        <div className="relative h-[88px] flex-1 border border-[#1e2533] bg-[#151922] rounded-2xl min-w-0">
          <span className="absolute -top-2 left-4 px-1.5 bg-[#12151b] text-[10px] font-bold tracking-wider text-slate-400 uppercase select-none pointer-events-none z-10">
            TONE
          </span>
          <div className="h-full w-full flex items-center justify-start gap-6 px-5 rounded-2xl min-w-0 overflow-x-auto custom-scrollbar">
            {/* Tone Play / Stop Button */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={onToggleTonePlay}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-md cursor-pointer ${
                  toneState.isPlaying
                    ? 'bg-cyan-400 text-slate-950 ring-2 ring-cyan-300 shadow-[0_0_16px_rgba(6,182,212,0.5)] scale-105'
                    : 'bg-[#1a212d] hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 hover:border-cyan-400'
                }`}
                title={toneState.isPlaying ? 'Stop Tone Generator' : 'Play Tone Generator'}
              >
                {toneState.isPlaying ? (
                  <Square size={18} className="fill-current" />
                ) : (
                  <Play size={20} className="fill-current ml-0.5" />
                )}
              </button>
            </div>

            {/* Tone Volume Slider */}
            <div className="flex flex-col shrink-0 min-w-[150px]">
              <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1">
                LEVEL
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="-40"
                  max="0"
                  step="0.5"
                  value={toneState.volumeDb}
                  onChange={(e) => onUpdateToneState({ volumeDb: parseFloat(e.target.value) })}
                  className="w-28 accent-cyan-400 cursor-pointer h-1.5 bg-[#0d1017] rounded-lg"
                  title="Tone Volume"
                />
                <span className="font-mono text-xs text-slate-200 font-semibold whitespace-nowrap min-w-[54px] text-right">
                  {toneState.volumeDb.toFixed(1)} dB
                </span>
              </div>
            </div>

            {/* Hint message on right */}
            {toneState.isPlaying && (
              <div className="hidden md:flex items-center text-xs text-cyan-400/80 font-mono ml-auto pr-3 gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                <span>Drag cyan line on graph to adjust frequency</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import type { FilterBand, ToneGeneratorState } from '../types/eq';
import { formatFreqFull } from '../utils/biquad';
import { FilterTypeIcon } from './FilterIcons';
import { Play, Square, X, ChevronUp, ChevronDown } from 'lucide-react';

interface ToneGeneratorBarProps {
  state: ToneGeneratorState;
  filters: FilterBand[];
  onTogglePlay: () => void;
  onUpdateState: (updated: Partial<ToneGeneratorState>) => void;
  onClose: () => void;
}

const ISO_THIRD_OCTAVE_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
  500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
  6300, 8000, 10000, 12500, 16000, 20000,
];

export const ToneGeneratorBar: React.FC<ToneGeneratorBarProps> = ({
  state,
  filters,
  onTogglePlay,
  onUpdateState,
  onClose,
}) => {
  const [isEditingFreq, setIsEditingFreq] = useState(false);
  const [freqInput, setFreqInput] = useState('');

  // Step frequency up / down based on octave step setting
  const stepFrequency = (direction: 1 | -1) => {
    const current = state.freq;
    if (state.octStep === '1/3') {
      let closestIdx = 0;
      let minDiff = Infinity;
      ISO_THIRD_OCTAVE_FREQS.forEach((f, idx) => {
        const diff = Math.abs(f - current);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      });
      const nextIdx = Math.max(0, Math.min(ISO_THIRD_OCTAVE_FREQS.length - 1, closestIdx + direction));
      onUpdateState({ freq: ISO_THIRD_OCTAVE_FREQS[nextIdx] });
    } else if (state.octStep === '1') {
      const factor = direction > 0 ? 2.0 : 0.5;
      const nextFreq = Math.max(20, Math.min(20000, Math.round(current * factor)));
      onUpdateState({ freq: nextFreq });
    } else {
      // Full range fine step
      const step = current < 100 ? 5 : current < 1000 ? 50 : 500;
      const nextFreq = Math.max(20, Math.min(20000, current + direction * step));
      onUpdateState({ freq: nextFreq });
    }
  };

  const handleFreqSubmit = () => {
    setIsEditingFreq(false);
    let val = parseFloat(freqInput.replace(/k/i, '000'));
    if (!isNaN(val)) {
      val = Math.max(20, Math.min(20000, Math.round(val)));
      onUpdateState({ freq: val });
    }
  };

  return (
    <div className="mx-auto my-2 px-4 py-2.5 bg-[#1b222d]/95 backdrop-blur-md border border-[#2d374a] rounded-full shadow-2xl flex items-center gap-4 text-xs select-none max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-150">
      {/* Title */}
      <span className="font-bold tracking-widest text-slate-400 text-[11px] pl-1">
        TONE
      </span>

      {/* Play / Stop Button (matching teal circular button in screenshot) */}
      <button
        onClick={onTogglePlay}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-md ${
          state.isPlaying
            ? 'bg-teal-500 text-slate-950 ring-2 ring-teal-400 scale-105'
            : 'bg-teal-600 hover:bg-teal-500 text-slate-950 hover:scale-105'
        }`}
        title={state.isPlaying ? 'Stop Tone' : 'Play Tone'}
      >
        {state.isPlaying ? (
          <Square size={13} className="fill-current" />
        ) : (
          <Play size={14} className="fill-current ml-0.5" />
        )}
      </button>

      {/* Frequency Display / Input with mini step arrows */}
      <div className="flex items-center bg-[#131720] border border-[#283244] rounded-lg px-2 py-1 gap-1">
        {isEditingFreq ? (
          <input
            type="text"
            autoFocus
            value={freqInput}
            onChange={(e) => setFreqInput(e.target.value)}
            onBlur={handleFreqSubmit}
            onKeyDown={(e) => e.key === 'Enter' && handleFreqSubmit()}
            className="w-16 bg-transparent text-teal-400 font-mono font-bold text-center outline-none"
          />
        ) : (
          <button
            onClick={() => {
              setFreqInput(state.freq.toString());
              setIsEditingFreq(true);
            }}
            className="font-mono font-bold text-slate-200 hover:text-teal-400 transition-colors w-16 text-center"
            title="Click to enter frequency"
          >
            {formatFreqFull(state.freq)}
          </button>
        )}

        <div className="flex flex-col ml-0.5">
          <button
            onClick={() => stepFrequency(1)}
            className="text-slate-400 hover:text-teal-400 transition-colors"
          >
            <ChevronUp size={11} />
          </button>
          <button
            onClick={() => stepFrequency(-1)}
            className="text-slate-400 hover:text-teal-400 transition-colors"
          >
            <ChevronDown size={11} />
          </button>
        </div>
      </div>

      {/* Volume Slider with Teal Thumb & dB display */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min="-40"
          max="0"
          step="0.5"
          value={state.volumeDb}
          onChange={(e) => onUpdateState({ volumeDb: parseFloat(e.target.value) })}
          className="w-24 accent-teal-400 cursor-pointer h-1.5 bg-[#121620] rounded-lg"
        />
        <span className="font-mono text-[11px] text-slate-300 w-14 text-right">
          {state.volumeDb.toFixed(1)} dB
        </span>
      </div>

      {/* Waveform Selector (Sine | Pink) */}
      <div className="flex items-center bg-[#131720] p-0.5 rounded-full border border-[#283244]">
        <button
          onClick={() => onUpdateState({ waveType: 'sine' })}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
            state.waveType === 'sine'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Sine
        </button>
        <button
          onClick={() => onUpdateState({ waveType: 'pink' })}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
            state.waveType === 'pink'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Pink
        </button>
      </div>

      {/* Octave Step Selector (Full | 1 | 1/3 OCT) */}
      <div className="flex items-center bg-[#131720] p-0.5 rounded-full border border-[#283244]">
        <button
          onClick={() => onUpdateState({ octStep: 'full' })}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
            state.octStep === 'full'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Full
        </button>
        <button
          onClick={() => onUpdateState({ octStep: '1' })}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
            state.octStep === '1'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          1
        </button>
        <button
          onClick={() => onUpdateState({ octStep: '1/3' })}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
            state.octStep === '1/3'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          ⅓
        </button>
        <span className="text-[10px] uppercase text-slate-500 font-bold px-1.5">
          OCT
        </span>
      </div>

      {/* Channel Selector (L | Both | R) */}
      <div className="flex items-center bg-[#131720] p-0.5 rounded-full border border-[#283244]">
        <button
          onClick={() => onUpdateState({ channel: 'L' })}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
            state.channel === 'L'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          L
        </button>
        <button
          onClick={() => onUpdateState({ channel: 'Both' })}
          className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
            state.channel === 'Both'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Both
        </button>
        <button
          onClick={() => onUpdateState({ channel: 'R' })}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
            state.channel === 'R'
              ? 'bg-teal-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          R
        </button>
      </div>

      {/* Filter Frequency Snap Trackers (matching screenshot 2 sweep icons) */}
      <div className="flex items-center gap-1.5 border-l border-[#2d374a] pl-2.5">
        {filters.slice(0, 4).map((f, i) => (
          <button
            key={f.id || i}
            onClick={() => onUpdateState({ freq: f.freq })}
            className="w-7 h-7 rounded-full bg-[#131720] hover:bg-teal-500/20 text-slate-400 hover:text-teal-400 border border-[#283244] flex items-center justify-center transition-all hover:scale-105 shadow-inner"
            title={`Snap tone to Filter ${i + 1} (${f.filter_type} at ${formatFreqFull(f.freq)})`}
          >
            <FilterTypeIcon type={f.filter_type} size={14} strokeWidth={2.2} />
          </button>
        ))}
      </div>

      {/* Close Button */}
      <button
        onClick={onClose}
        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-full transition-colors ml-auto"
        title="Close Tone Generator"
      >
        <X size={15} />
      </button>
    </div>
  );
};

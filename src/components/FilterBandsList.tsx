import React, { useState } from 'react';
import type { FilterBand } from '../types/eq';
import { formatFreqFull } from '../utils/biquad';
import { FilterTypeIcon } from './FilterIcons';
import { Power, Plus, Trash2, RotateCcw, GripVertical } from 'lucide-react';

interface FilterBandsListProps {
  filters: FilterBand[];
  selectedFilterIndex: number | null;
  onSelectFilter: (index: number) => void;
  onUpdateFilter: (index: number, updated: Partial<FilterBand>) => void;
  onDeleteFilter: (index: number) => void;
  onAddFilter: () => void;
  onResetFilters: () => void;
  onReorderFilters: (fromIndex: number, toIndex: number) => void;
}

export const FilterBandsList: React.FC<FilterBandsListProps> = ({
  filters,
  selectedFilterIndex,
  onSelectFilter,
  onUpdateFilter,
  onDeleteFilter,
  onAddFilter,
  onResetFilters,
  onReorderFilters,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', `${index}`);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    // Only clear if leaving container
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      onReorderFilters(draggedIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="w-80 h-full bg-[#12151b] border border-[#1e232d] rounded-2xl flex flex-col select-none overflow-hidden shadow-2xl">
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e232d]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-wider text-slate-300">
            {filters.length} BANDS
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onAddFilter}
            className="p-1.5 text-slate-300 hover:text-white bg-[#1e2533] hover:bg-[#283244] border border-[#2e394e] rounded-md transition-colors"
            title="Add Band"
          >
            <Plus size={14} className="text-amber-400" />
          </button>
          <button
            onClick={onResetFilters}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#1e2533] rounded-md border border-transparent hover:border-[#2e394e] transition-colors"
            title="Restore changes to profile"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* Filter Rows Scrollable Container */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5 custom-scrollbar">
        {filters.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs">
            No filter bands yet.
            <div className="mt-2 text-slate-400">
              Click <span className="text-amber-400 font-bold">+</span> above or double-click the graph to add a band.
            </div>
          </div>
        ) : (
          filters.map((filter, index) => {
            const isSelected = selectedFilterIndex === index;
            const isDragging = draggedIndex === index;
            const isDragOver = dragOverIndex === index;
            const color = filter.color || '#eab308';

            return (
              <div
                key={filter.id || index}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelectFilter(index)}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg border transition-all cursor-pointer ${
                  isDragging
                    ? 'opacity-35 border-dashed border-amber-500/70 bg-[#12161f]'
                    : isDragOver
                    ? 'border-amber-400 bg-[#1c2333] shadow-lg ring-1 ring-amber-400/50'
                    : isSelected
                    ? 'bg-[#1a202c] border-amber-500/50 shadow-md ring-1 ring-amber-500/30'
                    : 'bg-[#151921] border-[#1e2430] hover:bg-[#181e28] hover:border-[#283142]'
                }`}
              >
                {/* Left: Drag grip + Index badge + Power toggle + Type icon */}
                <div className="flex items-center gap-1.5">
                  {/* Grip handle */}
                  <div
                    className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 transition-colors -ml-1 pr-0.5"
                    title="Drag to reorder band"
                  >
                    <GripVertical size={13} />
                  </div>

                  {/* Colored accent vertical line / number */}
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-1 h-5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-mono font-bold text-slate-200 w-3 text-center">
                      {index + 1}
                    </span>
                  </div>

                  {/* Power toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateFilter(index, { enabled: !filter.enabled });
                    }}
                    className={`p-1 rounded hover:bg-slate-700/50 transition-colors ${
                      filter.enabled ? 'text-amber-400' : 'text-slate-600'
                    }`}
                    title={filter.enabled ? 'Disable filter' : 'Enable filter'}
                  >
                    <Power size={12} />
                  </button>

                  {/* Filter Type SVG Icon */}
                  <div
                    className="w-6 h-6 flex items-center justify-center rounded bg-[#10131a] text-slate-300 border border-[#222938]"
                    title={`Filter Type: ${filter.filter_type}`}
                  >
                    <FilterTypeIcon type={filter.filter_type} size={15} strokeWidth={2} />
                  </div>
                </div>

                {/* Center: Frequency, Gain, Q */}
                <div className="flex items-center gap-2 text-xs font-mono shrink-0">
                  <span className="text-slate-200 font-medium w-15 text-right">
                    {formatFreqFull(filter.freq)}
                  </span>
                  <span
                    className={`w-13 text-right font-medium ${
                      filter.gain > 0
                        ? 'text-amber-400'
                        : filter.gain < 0
                        ? 'text-cyan-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {filter.gain > 0 ? `+${filter.gain.toFixed(1)}` : filter.gain.toFixed(1)} dB
                  </span>
                  <span className="text-slate-400 w-8 text-right">
                    {filter.q.toFixed(2)}
                  </span>
                </div>

                {/* Right: Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFilter(index);
                  }}
                  className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors shrink-0 ml-0.5"
                  title="Delete filter band"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

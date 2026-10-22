import { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { FilterBand, EqProfile, ToneGeneratorState } from './types/eq';
import {
  calculateFrequencyResponse,
  startToneGenerator,
  updateToneGenerator,
  stopToneGenerator,
  checkEqualizerApoStatus,
  setEqualizerApoInclude,
  applyEqConfig,
  getProfiles,
  saveProfile,
  deleteProfile,
  readCurrentApoConfig,
  getLastPreset,
  setLastPreset,
} from './services/audioBridge';
import { EqGraph } from './components/EqGraph';
import { FilterBandsList } from './components/FilterBandsList';
import { BottomToolbar } from './components/BottomToolbar';
import { ImportModal } from './components/ImportModal';
import { EqifyLogo } from './components/EqifyLogo';
import { computeFastCurves, DEFAULT_EVAL_FREQS } from './utils/biquad';
import {
  FileDown,
  Save,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  Minus,
  Square,
  X,
} from 'lucide-react';

const PALETTE = [
  '#06b6d4', // cyan
  '#10b981', // green
  '#f97316', // orange
  '#a855f7', // purple
  '#14b8a6', // teal
  '#ec4899', // pink
  '#eab308', // gold / yellow
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#ef4444', // red
];

export default function App() {
  const [filters, setFilters] = useState<FilterBand[]>([]);
  const [preamp, setPreamp] = useState<number>(0.0);
  const [autoPreamp, setAutoPreamp] = useState<boolean>(true);
  const autoPreampRef = useRef<boolean>(true);
  const [isBypassed, setIsBypassed] = useState<boolean>(true);
  const [selectedFilterIndex, setSelectedFilterIndex] = useState<number | null>(null);
  const [currentProfileName, setCurrentProfileName] = useState<string>('(No Preset)');

  // Real-time curve data computed synchronously with 0 lag on any filter change
  const curveData = useMemo(() => computeFastCurves(filters, DEFAULT_EVAL_FREQS), [filters]);
  const freqs = curveData.freqs;
  const totalCurve = curveData.totalCurve;
  const filterCurves = curveData.filterCurves;
  const [recommendedPreamp, setRecommendedPreamp] = useState<number>(0.0);

  // EqualizerAPO target file
  const [apoTargetFile, setApoTargetFile] = useState<string>('eqify.txt');

  // Tone Generator state
  const [toneState, setToneState] = useState<ToneGeneratorState>({
    isPlaying: false,
    freq: 1000,
    volumeDb: -12.0,
    waveType: 'sine',
    octStep: '1',
    channel: 'Both',
  });

  // Modals & Profile Dropdown
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState<boolean>(false);
  const [newProfileName, setNewProfileName] = useState<string>('');
  const [activeProfileSnapshot, setActiveProfileSnapshot] = useState<EqProfile | null>(null);
  const [justSaved, setJustSaved] = useState<boolean>(false);
  const [profiles, setProfiles] = useState<EqProfile[]>([]);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const newProfileInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileDropdownRef.current &&
        !profileDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProfileDropdownOpen(false);
      }
    }
    if (isProfileDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileDropdownOpen]);

  // Throttle timer ref for Rust response computation & APO sync
  const rustCalcTimerRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);

  // Keep recommended preamp & auto-preamp in sync when curve updates
  useEffect(() => {
    setRecommendedPreamp(curveData.recommendedPreamp);
    if (autoPreampRef.current) {
      const autoVal = parseFloat(curveData.recommendedPreamp.toFixed(1));
      setPreamp((prev) => (Math.abs(prev - autoVal) > 0.05 ? autoVal : prev));
    }
  }, [curveData.recommendedPreamp]);

  // Multithreaded background computation in Rust + debounced EqualizerAPO sync
  useEffect(() => {
    // 1. Multithreaded background computation in Rust for status & verification
    if (rustCalcTimerRef.current) clearTimeout(rustCalcTimerRef.current);
    rustCalcTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await calculateFrequencyResponse(filters, preamp, 300);
        setRecommendedPreamp(res.recommended_preamp_db);
      } catch (err) {
        console.error('Curve computation in Rust failed:', err);
      }
    }, 80);

    // 2. Debounced auto-sync to EqualizerAPO target file
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(async () => {
      try {
        await applyEqConfig(filters, preamp, isBypassed, apoTargetFile);
      } catch (err) {
        console.error('Auto-sync to EqualizerAPO failed:', err);
      }
    }, 100);
  }, [filters, preamp, isBypassed, apoTargetFile]);

  const handleLoadProfile = async (profile: EqProfile, sourceFile?: string) => {
    setAutoPreamp(false);
    autoPreampRef.current = false;
    const colored = profile.filters.map((f, i) => ({
      ...f,
      id: `${i + 1}`,
      color: PALETTE[i % PALETTE.length],
    }));
    setFilters(colored);
    setPreamp(profile.preamp);
    setCurrentProfileName(profile.name);
    setLastPreset(profile.name);
    localStorage.setItem('eqify_last_selected_preset', profile.name);
    if (sourceFile) {
      localStorage.setItem('eqify_last_source_file', sourceFile);
    } else if (profile.name.endsWith('.txt')) {
      localStorage.setItem('eqify_last_source_file', profile.name);
    } else {
      localStorage.removeItem('eqify_last_source_file');
    }
    setActiveProfileSnapshot({
      name: profile.name,
      preamp: profile.preamp,
      filters: profile.filters.map((f) => ({ ...f })),
    });

    const target = sourceFile || (profile.name.endsWith('.txt') ? profile.name : apoTargetFile);
    if (target !== apoTargetFile) {
      setApoTargetFile(target);
    }
    try {
      const status = await checkEqualizerApoStatus(target);
      setIsBypassed(!status.is_included);
    } catch (err) {
      console.warn('Status check failed:', err);
    }
  };

  // Initial load: check EqualizerAPO status, fetch profiles, and restore previously selected preset
  useEffect(() => {
    async function init() {
      try {
        const loadedProfiles = await getProfiles();
        setProfiles(loadedProfiles);

        // Retrieve previously selected preset
        let lastPresetName = await getLastPreset();
        if (!lastPresetName) {
          lastPresetName = localStorage.getItem('eqify_last_selected_preset');
        }
        const lastSourceFile = localStorage.getItem('eqify_last_source_file') || undefined;

        let presetToLoad: EqProfile | null = null;
        let fileToLoad: string | undefined = lastSourceFile;

        if (lastPresetName) {
          const match = loadedProfiles.find((p) => p.name === lastPresetName);
          if (match) {
            presetToLoad = match;
          } else if (lastSourceFile && lastSourceFile.endsWith('.txt')) {
            try {
              const imported = await readCurrentApoConfig(lastSourceFile);
              if (imported && imported.filters && imported.filters.length > 0) {
                presetToLoad = imported;
                fileToLoad = lastSourceFile;
              }
            } catch {
              // ignore
            }
          }
        }

        // Fallback to most recent profile if available
        if (!presetToLoad && loadedProfiles.length > 0) {
          presetToLoad = loadedProfiles[0];
          fileToLoad = undefined;
        }

        if (presetToLoad) {
          await handleLoadProfile(presetToLoad, fileToLoad);
        } else {
          const status = await checkEqualizerApoStatus(apoTargetFile);
          setIsBypassed(!status.is_included);
        }
      } catch (err) {
        console.error('Initial init error:', err);
      }
    }
    init();
  }, []);

  // Tone generator updates in Rust
  const handleToggleTonePlay = async () => {
    const nextPlaying = !toneState.isPlaying;
    const nextState = { ...toneState, isPlaying: nextPlaying };
    setToneState(nextState);

    if (nextPlaying) {
      await startToneGenerator(nextState);
    } else {
      await stopToneGenerator();
    }
  };

  const handleUpdateToneState = async (updated: Partial<ToneGeneratorState>) => {
    const nextState = { ...toneState, ...updated };
    setToneState(nextState);

    if (nextState.isPlaying) {
      if (updated.waveType && updated.waveType !== toneState.waveType) {
        // Wave type changed, restart stream
        await startToneGenerator(nextState);
      } else {
        await updateToneGenerator(nextState);
      }
    }
  };

  // Filter modifications
  const handleUpdateFilter = (index: number, updated: Partial<FilterBand>) => {
    setFilters((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updated };
      return next;
    });
  };

  const handleDeleteFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
    setSelectedFilterIndex((current) => {
      if (current === null) return null;
      if (current === index) return null;
      if (current > index) return current - 1;
      return current;
    });
  };

  const handleAddFilter = () => {
    setFilters((prev) => {
      const newIndex = prev.length + 1;
      const newFilter: FilterBand = {
        id: `${Date.now()}`,
        enabled: true,
        filter_type: 'PK',
        freq: 1000,
        gain: 0.0,
        q: 1.41,
        color: PALETTE[(newIndex - 1) % PALETTE.length],
      };
      return [...prev, newFilter];
    });
    setSelectedFilterIndex(filters.length);
  };

  const handleAddFilterAt = (freq: number, gain: number) => {
    setFilters((prev) => {
      const newIndex = prev.length + 1;
      const newFilter: FilterBand = {
        id: `${Date.now()}`,
        enabled: true,
        filter_type: 'PK',
        freq,
        gain,
        q: 1.41,
        color: PALETTE[(newIndex - 1) % PALETTE.length],
      };
      return [...prev, newFilter];
    });
    setSelectedFilterIndex(filters.length);
  };

  const handleResetFilters = () => {
    if (activeProfileSnapshot) {
      setAutoPreamp(false);
      autoPreampRef.current = false;
      const colored = activeProfileSnapshot.filters.map((f, i) => ({
        ...f,
        id: `${i + 1}`,
        color: PALETTE[i % PALETTE.length],
      }));
      setFilters(colored);
      setPreamp(activeProfileSnapshot.preamp);
    } else {
      setFilters((prev) =>
        prev.map((f) => ({
          ...f,
          gain: 0.0,
        }))
      );
    }
  };

  const handleReorderFilters = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setFilters((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });

    if (selectedFilterIndex === fromIndex) {
      setSelectedFilterIndex(toIndex);
    } else if (
      selectedFilterIndex !== null &&
      selectedFilterIndex > fromIndex &&
      selectedFilterIndex <= toIndex
    ) {
      setSelectedFilterIndex(selectedFilterIndex - 1);
    } else if (
      selectedFilterIndex !== null &&
      selectedFilterIndex < fromIndex &&
      selectedFilterIndex >= toIndex
    ) {
      setSelectedFilterIndex(selectedFilterIndex + 1);
    }
  };

  // Profile actions
  const handleSaveProfile = async (name: string) => {
    try {
      const profile: EqProfile = {
        name,
        preamp,
        filters: filters.map((f) => ({
          id: f.id,
          enabled: f.enabled,
          filter_type: f.filter_type,
          freq: f.freq,
          gain: f.gain,
          q: f.q,
        })),
      };
      await saveProfile(profile);
      await applyEqConfig(filters, preamp, isBypassed, apoTargetFile);

      setCurrentProfileName(name);
      setLastPreset(name);
      localStorage.setItem('eqify_last_selected_preset', name);
      localStorage.setItem('eqify_last_source_file', apoTargetFile);
      setActiveProfileSnapshot({
        name: profile.name,
        preamp: profile.preamp,
        filters: profile.filters.map((f) => ({ ...f })),
      });
      const updatedProfiles = await getProfiles();
      setProfiles(updatedProfiles);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch (err) {
      console.error('Failed to save profile / config:', err);
    }
  };

  const handleQuickSave = async () => {
    if (currentProfileName && currentProfileName !== '(No Preset)') {
      await handleSaveProfile(currentProfileName);
    } else {
      setIsProfileDropdownOpen(true);
      setTimeout(() => {
        newProfileInputRef.current?.focus();
      }, 50);
    }
  };

  const handleSaveNewFromDropdown = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProfileName.trim();
    if (!name) return;
    await handleSaveProfile(name);
    setNewProfileName('');
    setIsProfileDropdownOpen(false);
  };

  const handleDeleteProfile = async (name: string) => {
    await deleteProfile(name);
    const updatedProfiles = await getProfiles();
    setProfiles(updatedProfiles);
    if (currentProfileName === name) {
      setCurrentProfileName('(No Preset)');
      setActiveProfileSnapshot(null);
      setLastPreset('');
      localStorage.removeItem('eqify_last_selected_preset');
      localStorage.removeItem('eqify_last_source_file');
    }
  };

  const handleNewPreset = () => {
    setFilters([]);
    setSelectedFilterIndex(null);
    setPreamp(0.0);
    setCurrentProfileName('(No Preset)');
    setActiveProfileSnapshot(null);
    setApoTargetFile('eqify.txt');
    setLastPreset('');
    localStorage.removeItem('eqify_last_selected_preset');
    localStorage.removeItem('eqify_last_source_file');
  };

  const handleTogglePower = async () => {
    const nextIncluded = isBypassed;
    try {
      await setEqualizerApoInclude(nextIncluded, apoTargetFile);
      setIsBypassed(!nextIncluded);
    } catch (err) {
      console.error('Failed to update config.txt include:', err);
    }
  };

  const handleToggleAutoPreamp = (enabled: boolean) => {
    setAutoPreamp(enabled);
    autoPreampRef.current = enabled;
    if (enabled) {
      const autoVal = parseFloat(recommendedPreamp.toFixed(1));
      setPreamp(autoVal);
    }
  };

  const handleMinimizeWindow = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke('app_window_minimize');
    } catch {
      try {
        await getCurrentWindow().minimize();
      } catch (err) {
        console.warn('Window minimize failed:', err);
      }
    }
  };

  const handleToggleMaximizeWindow = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke('app_window_toggle_maximize');
    } catch {
      try {
        await getCurrentWindow().toggleMaximize();
      } catch (err) {
        console.warn('Window toggle maximize failed:', err);
      }
    }
  };

  const handleCloseWindow = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke('app_window_close');
    } catch {
      try {
        await getCurrentWindow().close();
      } catch (err) {
        console.warn('Window close failed:', err);
      }
    }
  };

  const handleHeaderMouseDown = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }
    if (e.button === 0) {
      try {
        await getCurrentWindow().startDragging();
      } catch (err) {
        console.warn('Start dragging failed:', err);
      }
    }
  };

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }
    handleToggleMaximizeWindow();
  };

  return (
    <div className="w-screen h-screen bg-[#0d0f14] text-slate-100 flex flex-col overflow-hidden font-sans select-none">
      {/* Top Header Bar */}
      <header
        data-tauri-drag-region="deep"
        onMouseDown={handleHeaderMouseDown}
        onDoubleClick={handleHeaderDoubleClick}
        className="h-12 px-4 bg-[#141820] border-b border-[#1f2533] flex items-center justify-between select-none z-30 cursor-default"
      >
        {/* Left: Brand logo & Preset pill */}
        <div data-tauri-drag-region="deep" className="flex items-center gap-4">
          <div data-tauri-drag-region="deep" className="flex items-center">
            <EqifyLogo size={26} showText={true} />
          </div>

          {/* Profile Selector Dropdown */}
          <div
            className="relative"
            ref={profileDropdownRef}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
              className="flex items-center gap-2 bg-[#1b212c] hover:bg-[#222a38] px-3.5 py-1.5 rounded-xl border border-[#2a3446] hover:border-slate-500 text-xs transition-colors cursor-pointer select-none"
              title="Select Profile"
            >
              <span className="text-slate-200 font-medium truncate max-w-[180px]">
                {currentProfileName || '(No Preset)'}
              </span>
              <ChevronDown
                size={13}
                className={`text-slate-400 transition-transform duration-150 ${
                  isProfileDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Dropdown Menu */}
            {isProfileDropdownOpen && (
              <div
                className="absolute left-0 top-full mt-1.5 w-72 bg-[#141820] border border-[#232b3b] rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col py-1 animate-in fade-in zoom-in-95 duration-100"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-[#1c2230] flex items-center justify-between">
                  <span>Saved Profiles ({profiles.length})</span>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-0.5 custom-scrollbar py-1">
                  {profiles.length === 0 ? (
                    <div className="px-3 py-3 text-center text-slate-500 text-xs">
                      No saved profiles yet
                    </div>
                  ) : (
                    profiles.map((p) => {
                      const isCurrent = p.name === currentProfileName;
                      return (
                        <div
                          key={p.name}
                          onClick={() => {
                            handleLoadProfile(p);
                            setIsProfileDropdownOpen(false);
                          }}
                          className={`group flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                            isCurrent
                              ? 'bg-amber-500/15 text-amber-400 font-semibold'
                              : 'text-slate-300 hover:bg-[#1c2230] hover:text-white'
                          }`}
                        >
                          <span className="truncate pr-2">{p.name}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProfile(p.name);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-400 hover:bg-red-500/15 rounded transition-all cursor-pointer"
                            title={`Delete "${p.name}"`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Save New Profile Input */}
                <div className="p-2 border-t border-[#1c2230] bg-[#0e1117]/80">
                  <form onSubmit={handleSaveNewFromDropdown} className="flex items-center gap-1.5">
                    <input
                      ref={newProfileInputRef}
                      type="text"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="Save as new profile..."
                      className="flex-1 bg-[#161a22] border border-[#273040] rounded-lg px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-amber-500"
                    />
                    <button
                      type="submit"
                      disabled={!newProfileName.trim()}
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                      title="Save Profile"
                    >
                      Save
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Draggable Spacer */}
        <div data-tauri-drag-region="deep" className="flex-1 h-full min-w-8" />

        {/* Right: Utility & Window controls */}
        <div className="flex items-center gap-1.5">
          {/* New Preset (Clear) Button */}
          <button
            onClick={handleNewPreset}
            className="p-1.5 rounded-lg transition-colors cursor-pointer text-slate-400 hover:text-slate-200 hover:bg-[#1e2533]"
            title="New Preset (Clear current filters)"
          >
            <Plus size={16} />
          </button>

          {/* Save Current Profile Button */}
          <button
            onClick={handleQuickSave}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              justSaved
                ? 'text-emerald-400 bg-emerald-500/15'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1e2533]'
            }`}
            title={
              currentProfileName && currentProfileName !== '(No Preset)'
                ? `Save "${currentProfileName}"`
                : 'Save as profile'
            }
          >
            {justSaved ? <Check size={16} className="text-emerald-400" /> : <Save size={16} />}
          </button>

          {/* Import Configuration (.txt) Button */}
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="p-1.5 rounded-lg transition-colors cursor-pointer text-slate-400 hover:text-slate-200 hover:bg-[#1e2533]"
            title="Import Configuration (.txt)"
          >
            <FileDown size={16} />
          </button>

          {/* Window control buttons */}
          <div className="flex items-center ml-2 border-l border-[#242c3b] pl-2 gap-1">
            <button
              onClick={handleMinimizeWindow}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-[#222a38] active:bg-[#2a3446] rounded transition-colors cursor-pointer"
              title="Minimize"
            >
              <Minus size={13} />
            </button>
            <button
              onClick={handleToggleMaximizeWindow}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-[#222a38] active:bg-[#2a3446] rounded transition-colors cursor-pointer"
              title="Maximize / Restore"
            >
              <Square size={11} />
            </button>
            <button
              onClick={handleCloseWindow}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-red-600 active:bg-red-700 rounded transition-colors cursor-pointer"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace (Graph on Left + Bands Sidebar on Right) */}
      <main className="flex-1 flex overflow-hidden p-2 gap-2 relative">
        {/* Frequency Response Graph Area */}
        <div className="flex-1 h-full relative">
          <EqGraph
            filters={filters}
            selectedFilterIndex={selectedFilterIndex}
            onSelectFilter={setSelectedFilterIndex}
            onUpdateFilter={handleUpdateFilter}
            onDeleteFilter={handleDeleteFilter}
            onAddFilterAt={handleAddFilterAt}
            totalCurve={totalCurve}
            filterCurves={filterCurves}
            freqs={freqs}
            preamp={preamp}
            toneState={toneState}
            onUpdateToneState={handleUpdateToneState}
          />
        </div>

        {/* Right Sidebar: Bands List */}
        <FilterBandsList
          filters={filters}
          selectedFilterIndex={selectedFilterIndex}
          onSelectFilter={setSelectedFilterIndex}
          onUpdateFilter={handleUpdateFilter}
          onDeleteFilter={handleDeleteFilter}
          onAddFilter={handleAddFilter}
          onResetFilters={handleResetFilters}
          onReorderFilters={handleReorderFilters}
        />
      </main>

      {/* Bottom Control Bar */}
      <BottomToolbar
        isBypassed={isBypassed}
        onToggleBypass={handleTogglePower}
        preamp={preamp}
        onPreampChange={setPreamp}
        recommendedPreamp={recommendedPreamp}
        autoPreamp={autoPreamp}
        onToggleAutoPreamp={handleToggleAutoPreamp}
        toneState={toneState}
        onToggleTonePlay={handleToggleTonePlay}
        onUpdateToneState={handleUpdateToneState}
      />

      {/* Modals */}
      {isImportModalOpen && (
        <ImportModal
          onImportProfile={handleLoadProfile}
          onClose={() => setIsImportModalOpen(false)}
        />
      )}
    </div>
  );
}

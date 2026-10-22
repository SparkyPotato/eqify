import React, { useState, useEffect, useRef } from 'react';
import type { EqProfile } from '../types/eq';
import { listApoTxtFiles, readCurrentApoConfig, parseApoConfigContent } from '../services/audioBridge';
import { FileText, FolderOpen, Upload, X, FileDown, RotateCw } from 'lucide-react';

interface ImportModalProps {
  onImportProfile: (profile: EqProfile, sourceFile?: string) => void;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  onImportProfile,
  onClose,
}) => {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await listApoTxtFiles();
      setFiles(list);
    } catch (err) {
      console.error('Failed to list files:', err);
      setErrorMsg('Could not read EqualizerAPO config directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleImportNamedFile = async (filename: string) => {
    setErrorMsg(null);
    try {
      const profile = await readCurrentApoConfig(filename);
      onImportProfile(profile, filename);
      onClose();
    } catch (err) {
      setErrorMsg(`Import failed: ${err}`);
    }
  };

  const handleBrowseCustomFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const content = await file.text();
      const profile = await parseApoConfigContent(content, file.name);
      onImportProfile(profile, file.name);
      onClose();
    } catch (err) {
      setErrorMsg(`Failed to parse ${file.name}: ${err}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none">
      <div className="bg-[#141820] border border-[#232b3b] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1f2635] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <FileDown size={17} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Import Configuration
              </h2>
              <p className="text-[11px] text-slate-400">
                Choose a .txt file from EqualizerAPO or Peace
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-[#1e2533] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Directory Info */}
        <div className="px-5 py-2.5 bg-[#0e1117] border-b border-[#1b212d] flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-2 truncate">
            <FolderOpen size={14} className="text-amber-400 shrink-0" />
            <span className="truncate font-mono text-[10px] text-slate-300">
              C:\Program Files\EqualizerAPO\config
            </span>
          </div>
          <button
            onClick={loadFiles}
            className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors cursor-pointer"
            title="Refresh files"
          >
            <RotateCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Files List */}
        <div className="p-4 flex-1 overflow-y-auto space-y-1.5 custom-scrollbar min-h-[160px]">
          {loading ? (
            <div className="flex items-center justify-center h-28 text-xs text-slate-500">
              Scanning configuration files...
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 text-center text-xs text-slate-500 gap-1">
              <span>No .txt files found in EqualizerAPO directory</span>
              <span className="text-[10px] text-slate-600">Use the Browse button below to pick any file</span>
            </div>
          ) : (
            files.map((file) => {
              const isSelected = selectedFile === file;
              return (
                <div
                  key={file}
                  onClick={() => setSelectedFile(file)}
                  onDoubleClick={() => handleImportNamedFile(file)}
                  className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500/15 border-amber-500/50 text-slate-100 shadow'
                      : 'bg-[#181d27] border-[#222938] hover:border-slate-600 text-slate-300 hover:text-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <FileText
                      size={15}
                      className={isSelected ? 'text-amber-400' : 'text-slate-400'}
                    />
                    <span className="font-mono text-xs font-semibold truncate">
                      {file}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleImportNamedFile(file);
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors shadow-sm cursor-pointer ml-2"
                  >
                    Import
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="px-5 py-2 text-xs text-red-400 bg-red-500/10 border-t border-red-500/20">
            {errorMsg}
          </div>
        )}

        {/* Footer with Browse other file button */}
        <div className="px-5 py-3 border-t border-[#1f2635] bg-[#11141b] flex items-center justify-between gap-3">
          <input
            type="file"
            ref={fileInputRef}
            accept=".txt"
            onChange={handleBrowseCustomFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1a202c] hover:bg-[#232b3b] text-slate-300 border border-[#2b3548] hover:border-slate-500 transition-colors cursor-pointer"
          >
            <Upload size={13} />
            <span>Browse file...</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-[#1a202c] transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

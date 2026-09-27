import React, { useState } from 'react';
import { useFileStore } from '../stores/useFileStore';
import { useI18n } from '../services/i18n';
import { FolderInput, X } from 'lucide-react';

interface MoveFileModalProps {
  filePath: string | null;
  onClose: () => void;
}

export default function MoveFileModal({ filePath, onClose }: MoveFileModalProps) {
  const { folders, moveFile } = useFileStore();
  const { t } = useI18n();
  const [targetFolder, setTargetFolder] = useState('');
  const [loading, setLoading] = useState(false);

  if (!filePath) return null;

  const fileName = filePath.split('/').pop() || filePath;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const success = await moveFile(filePath, targetFolder);
    setLoading(false);
    if (success) {
      onClose();
    } else {
      alert('Failed to move file');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-dark-800 border border-dark-500 rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <FolderInput className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-white">{t('btn_move_file')}</h3>
          </div>
          <button
            onClick={onClose}
            className="touch-btn text-muted hover:text-white p-1 rounded-lg hover:bg-dark-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source File Info */}
        <div className="text-xs text-muted flex flex-col gap-1 bg-dark-900/80 p-3 rounded-xl border border-dark-600/50">
          <span className="text-[10px] uppercase font-mono text-dark-500">File to move:</span>
          <span className="font-mono text-gray-200 font-semibold truncate">{fileName}</span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-300">{t('select_target_folder')}</label>
            <select
              value={targetFolder}
              onChange={(e) => setTargetFolder(e.target.value)}
              className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-accent focus:outline-none"
            >
              <option value="">(Root) {t('folder_root')}</option>
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="touch-btn px-4 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:bg-dark-700 transition"
            >
              {t('btn_cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="touch-btn px-5 py-2 rounded-xl bg-accent hover:bg-accent-light text-white text-xs font-bold shadow-md shadow-accent/25 transition disabled:opacity-50"
            >
              {loading ? 'Moving...' : t('btn_move_file')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

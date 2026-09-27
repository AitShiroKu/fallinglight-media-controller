import React, { useState } from 'react';
import { useFileStore } from '../stores/useFileStore';
import { useI18n } from '../services/i18n';
import { FolderPlus, X } from 'lucide-react';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateFolderModal({ isOpen, onClose }: CreateFolderModalProps) {
  const { currentFolder, createFolder } = useFileStore();
  const { t } = useI18n();
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = folderName.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    const success = await createFolder(trimmed);
    setLoading(false);
    if (success) {
      setFolderName('');
      onClose();
    } else {
      alert('Failed to create folder');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-dark-800 border border-dark-500 rounded-3xl p-6 shadow-2xl flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent/20 text-accent flex items-center justify-center">
              <FolderPlus className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-white">{t('folder_create_title')}</h3>
          </div>
          <button
            onClick={onClose}
            className="touch-btn text-muted hover:text-white p-1 rounded-lg hover:bg-dark-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Path Info */}
        <div className="text-xs text-muted flex items-center gap-1 bg-dark-900/80 px-3 py-2 rounded-xl border border-dark-600/50">
          <span>In:</span>
          <span className="font-mono text-accent font-semibold truncate">
            {currentFolder || t('folder_root')}
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder={t('folder_create_placeholder')}
            autoFocus
            className="w-full bg-dark-900 border border-dark-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent focus:outline-none"
          />

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
              disabled={!folderName.trim() || loading}
              className="touch-btn px-5 py-2 rounded-xl bg-accent hover:bg-accent-light text-white text-xs font-bold shadow-md shadow-accent/25 transition disabled:opacity-50"
            >
              {loading ? 'Creating...' : t('btn_add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

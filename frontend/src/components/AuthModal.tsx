import React, { useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useI18n } from '../services/i18n';
import { Radio, Lock, User, AlertCircle, Loader2 } from 'lucide-react';

export default function AuthModal() {
  const { isAuthenticated, isLoading, error, login, clearError } = useAuthStore();
  const { t } = useI18n();

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated || isLoading) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    await login(username, password);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-dark-800 border border-dark-500/80 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col gap-5">
        {/* Header Branding */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center text-white shadow-xl shadow-accent/30 mb-1">
            <Radio className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">FallingLight</h2>
          <p className="text-xs text-muted font-medium">{t('login_subtitle')}</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-400 text-xs animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-300">{t('label_username')}</label>
            <div className="relative flex items-center">
              <User className="w-4 h-4 text-dark-500 absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  clearError();
                  setUsername(e.target.value);
                }}
                className="w-full bg-dark-900 border border-dark-500/80 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition"
                placeholder="Username"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-300">{t('label_password')}</label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 text-dark-500 absolute left-3.5 pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  clearError();
                  setPassword(e.target.value);
                }}
                className="w-full bg-dark-900 border border-dark-500/80 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white placeholder-dark-500 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition"
                placeholder="Password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="touch-btn min-h-[46px] mt-2 w-full bg-accent hover:bg-accent-light text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-accent/25 transition active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <span>{t('btn_login')}</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

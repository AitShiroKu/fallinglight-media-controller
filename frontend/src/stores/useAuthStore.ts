import { create } from 'zustand';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string;
  error: string | null;

  checkAuth: () => Promise<boolean>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  username: '',
  error: null,

  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/check');
      const data = await res.json();
      const authed = !!data.authenticated;
      set({ isAuthenticated: authed, isLoading: false });
      return authed;
    } catch {
      set({ isAuthenticated: false, isLoading: false });
      return false;
    }
  },

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        set({ isAuthenticated: true, username, isLoading: false, error: null });
        return true;
      }
      set({ isAuthenticated: false, error: data.error || 'Login failed', isLoading: false });
      return false;
    } catch (err: any) {
      set({ isAuthenticated: false, error: err.message || 'Connection error', isLoading: false });
      return false;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      set({ isAuthenticated: false, username: '', error: null });
    }
  },

  clearError: () => set({ error: null }),
}));

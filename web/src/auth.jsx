import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, onboarding: null, authMethod: null });
  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setState({ loading: false, user: me.user, onboarding: me.onboarding, authMethod: me.authMethod });
    } catch {
      setState({ loading: false, user: null, onboarding: null, authMethod: null });
    }
  }, []);
  useEffect(() => {
    refresh();
    const onUnauth = () => setState({ loading: false, user: null, onboarding: null });
    const onOnb = () => refresh();
    window.addEventListener('td:unauthorized', onUnauth);
    window.addEventListener('td:onboarding', onOnb);
    return () => { window.removeEventListener('td:unauthorized', onUnauth); window.removeEventListener('td:onboarding', onOnb); };
  }, [refresh]);
  const logout = async () => { try { await api.post('/auth/logout'); } finally { setState({ loading: false, user: null, onboarding: null }); } };
  return <AuthCtx.Provider value={{ ...state, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const can = (user, ...roles) => roles.includes(user?.role);

export const canReview = (u) => ['SUPERADMIN', 'ADMIN', 'CASSIERE'].includes(u?.role);
export const canFinance = (u) => ['SUPERADMIN', 'ADMIN', 'FINANCE'].includes(u?.role);
export const canCount = (u) => ['SUPERADMIN', 'ADMIN', 'OPERATOR'].includes(u?.role);

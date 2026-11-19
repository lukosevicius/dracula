import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { AuthError, getProfile, logout as endSession, updateProfile, type UserProfile } from './auth-api';

type AuthState = 'loading' | 'signed-out' | 'signed-in' | 'unavailable';
type AuthContextValue = { state: AuthState; user: UserProfile | null; refresh: () => Promise<void>; setSignedIn: (user: UserProfile) => void; saveName: (name: string) => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(Platform.OS === 'web' ? 'loading' : 'signed-out');
  const [user, setUser] = useState<UserProfile | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    const request = ++generation.current;
    setState('loading');
    try { const result = await getProfile(); if (request === generation.current) { setUser(result.user); setState('signed-in'); } }
    catch (error) { if (request === generation.current) { setUser(null); setState(error instanceof AuthError && error.status === 401 ? 'signed-out' : 'unavailable'); } }
  }, []);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const setSignedIn = useCallback((profile: UserProfile) => { generation.current++; setUser(profile); setState('signed-in'); }, []);
  const expired = useCallback((error: unknown) => { if (error instanceof AuthError && error.status === 401) { generation.current++; setUser(null); setState('signed-out'); } }, []);
  const saveName = useCallback(async (name: string) => { try { const result = await updateProfile(name); setSignedIn(result.user); } catch (error) { expired(error); throw error; } }, [expired, setSignedIn]);
  const signOut = useCallback(async () => { try { await endSession(); generation.current++; setUser(null); setState('signed-out'); } catch (error) { expired(error); throw error; } }, [expired]);
  return <AuthContext.Provider value={{state,user,refresh,setSignedIn,saveName,signOut}}>{children}</AuthContext.Provider>;
}
export function useAuth() { const auth = useContext(AuthContext); if (!auth) throw new Error('AuthProvider is missing'); return auth; }

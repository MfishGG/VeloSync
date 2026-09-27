import { create } from "zustand";
import { clearTokens, setTokens } from "../api/client";
import { fetchMe, login as apiLogin, register as apiRegister, socialLogin as apiSocialLogin } from "../api/queries";
import type { SocialLoginResult, TokenPair, User } from "../api/types";

interface AuthState {
  token: string | null;
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: {
    username: string;
    password: string;
    email?: string;
    nickname?: string;
  }) => Promise<void>;
  socialLogin: (vars: { provider: string; code?: string; identity?: string }) => Promise<SocialLoginResult>;
  /** OAuth 回调页落地 token 用（user 缺省时自动拉取） */
  applyTokenPair: (access: string, refresh: string, user?: User | null) => void;
  logout: () => void;
  loadMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem("velosync_access"),
  user: null,

  applyTokenPair(access, refresh, user = null) {
    setTokens(access, refresh);
    set({ token: access, user });
    if (!user) void get().loadMe();
  },

  async login(username, password) {
    const pair = await apiLogin(username, password);
    setTokens(pair.access, pair.refresh);
    set({ token: pair.access, user: pair.user });
  },

  async register(payload) {
    const pair = await apiRegister(payload);
    setTokens(pair.access, pair.refresh);
    set({ token: pair.access, user: pair.user });
  },

  async socialLogin(vars) {
    const pair = await apiSocialLogin(vars);
    setTokens(pair.access, pair.refresh);
    set({ token: pair.access, user: pair.user });
    return pair;
  },

  logout() {
    clearTokens();
    set({ token: null, user: null });
  },

  async loadMe() {
    if (!get().token) return;
    try {
      const user = await fetchMe();
      set({ user });
    } catch {
      clearTokens();
      set({ token: null, user: null });
    }
  },
}));

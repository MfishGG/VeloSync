import { create } from "zustand";
import { clearTokens, setTokens } from "../api/client";
import { queryClient } from "../api/queryClient";
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

export const useAuthStore = create<AuthState>((set, get) => {
  /**
   * 清空登录态：本地凭证 + 内存 token + 全部查询缓存。
   *
   * 查询缓存必须一起清 —— 所有 queryKey 都是静态的（`qk.platforms`、`qk.matrix` …，
   * 不含用户标识），只清 token 的话，换账号登录后会在 staleTime 内直接命中
   * 上一个用户残留的数据。
   */
  const wipe = () => {
    clearTokens();
    queryClient.clear();
    set({ token: null, user: null });
  };

  return {
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

    logout: wipe,

    async loadMe() {
      if (!get().token) return;
      try {
        const user = await fetchMe();
        set({ user });
      } catch {
        // token 失效：同样走完整清理，避免残留数据被下一个账号看到
        wipe();
      }
    },
  };
});

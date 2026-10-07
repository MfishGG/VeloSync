import { QueryClient } from "@tanstack/react-query";

/**
 * 全局 QueryClient 单例。
 *
 * 单独抽成模块（而不是在 main.tsx 里就地创建）是为了让 `authStore` 能在退出登录时
 * 调用 `queryClient.clear()`。原因：这里所有 queryKey 都是静态的（`qk.platforms`、
 * `qk.matrix` 等，不含用户标识），若登出只清 token 不清缓存，下一个登录的账号会在
 * `staleTime` 内直接命中上一个用户残留的数据。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

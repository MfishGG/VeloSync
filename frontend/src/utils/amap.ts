/** 高德地图 JS API 2.0 动态加载器。
 *
 * Key 从环境变量读取（frontend/.env）：
 *   VITE_AMAP_KEY=你的 Web 端 Key
 *   VITE_AMAP_SECURITY_CODE=你的安全密钥（JS API 2.0 必填）
 * 未配置时 loadAMap() 直接 reject，调用方降级到内置 SVG 轨迹图。
 */

declare global {
  interface Window {
    AMap?: any;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

export const AMAP_KEY: string = (import.meta.env.VITE_AMAP_KEY as string) || "";
export const AMAP_SECURITY_CODE: string =
  (import.meta.env.VITE_AMAP_SECURITY_CODE as string) || "";

let pending: Promise<any> | null = null;

export function isAMapConfigured(): boolean {
  return Boolean(AMAP_KEY);
}

export function loadAMap(): Promise<any> {
  if (!AMAP_KEY) {
    return Promise.reject(new Error("未配置 VITE_AMAP_KEY"));
  }
  if (window.AMap) return Promise.resolve(window.AMap);
  if (pending) return pending;

  // 安全密钥必须在脚本加载前注入
  if (AMAP_SECURITY_CODE) {
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
  }

  pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}`;
    script.async = true;
    script.onload = () => {
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("高德地图脚本已加载但 AMap 未就绪，请检查 Key 是否有效"));
    };
    script.onerror = () => {
      pending = null;
      reject(new Error("高德地图脚本加载失败，请检查网络或 Key 配置"));
    };
    document.head.appendChild(script);
  });
  return pending;
}

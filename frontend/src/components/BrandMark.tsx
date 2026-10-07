import { useId } from "react";

/**
 * VeloSync 品牌标识 ·「速度线 + 环形同步箭头」
 *
 * 与小程序端 `wx-frontend/assets/brand/` 的品牌图标**同源**（同一套几何参数，按 64×64 归一化）：
 *   - 靛蓝对角渐变圆角方块（#818cf8 → #4338ca，圆角 0.225）
 *   - 白色环形双向同步箭头（两段 148° 圆弧，各自末端带实心箭头）
 *   - 内部三条长度递减的圆头速度线（左对齐，产生「加速」错觉）
 *
 * 静态资源副本见 `public/favicon.svg` —— 修改几何参数时两者需同步。
 */
export default function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  const gid = `vs-brand-${useId().replace(/:/g, "")}`;

  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="VeloSync">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="14.4" fill={`url(#${gid})`} />

      <g fill="none" stroke="#ffffff" strokeWidth="3.97">
        <path d="M13.91 26.81A18.816 18.816 0 0 1 50.09 26.81" />
        <path d="M50.09 37.19A18.816 18.816 0 0 1 13.91 37.19" />
      </g>

      <g fill="#ffffff">
        <path d="M-4.196 -5.158L5.129 0L-4.196 5.158Z" transform="translate(51.45 24.36) rotate(74)" />
        <path d="M-4.196 -5.158L5.129 0L-4.196 5.158Z" transform="translate(12.55 39.64) rotate(-106)" />
      </g>

      <g stroke="#ffffff" strokeWidth="3.33" strokeLinecap="round">
        <path d="M24.16 26.5H39.84" />
        <path d="M24.16 32H34.72" />
        <path d="M24.16 37.5H29.6" />
      </g>
    </svg>
  );
}

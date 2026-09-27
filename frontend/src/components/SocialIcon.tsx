/** 第三方平台图标：微信走矢量路径，QQ / 微博用文字标记（避免手绘变形） */

interface Props {
  code: string;
  className?: string;
}

export default function SocialIcon({ code, className = "h-5 w-5" }: Props) {
  if (code === "wechat") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M9.1 3C5.2 3 2 5.7 2 9c0 1.9 1 3.6 2.6 4.7l-.7 2.2 2.5-1.3c.8.2 1.6.3 2.5.3h.5a6 6 0 0 1-.2-1.5c0-3.4 3.2-6.1 7.1-6.1h.5C16.1 5 13 3 9.1 3Zm-2.6 4.2a1.05 1.05 0 1 1 0 2.1 1.05 1.05 0 0 1 0-2.1Zm5.2 0a1.05 1.05 0 1 1 0 2.1 1.05 1.05 0 0 1 0-2.1Z" />
        <path d="M22 14.1c0-3-2.9-5.4-6.4-5.4s-6.4 2.4-6.4 5.4c0 3 2.9 5.4 6.4 5.4c.8 0 1.5-.1 2.2-.3l2.1 1.1-.6-1.9c1.7-1 2.7-2.5 2.7-4.3Zm-8.5-1.4a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Zm4.4 0a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Z" />
      </svg>
    );
  }

  if (code === "qq") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <text
          x="12"
          y="17.5"
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fill="currentColor"
          fontFamily="system-ui, sans-serif"
        >
          QQ
        </text>
      </svg>
    );
  }

  if (code === "weibo") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <text
          x="12"
          y="17.5"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill="currentColor"
          fontFamily="system-ui, sans-serif"
        >
          微
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.25" />
      <circle cx="12" cy="9.5" r="3" fill="currentColor" />
      <path d="M5.5 20c1.2-3.4 3.6-5.1 6.5-5.1s5.3 1.7 6.5 5.1" fill="currentColor" />
    </svg>
  );
}

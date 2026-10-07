/**
 * VeloSync 品牌图标 · 位图生成器
 *
 * 唯一几何来源是 `public/favicon.svg`。本脚本把它渲染成 Web 端需要的各尺寸位图，
 * 保证 favicon / apple-touch-icon 与 UI 里内联的 `src/components/BrandMark.tsx`
 * 以及小程序端 `wx-frontend/assets/brand/` 三处完全一致。
 *
 * 依赖是「一次性工具」（@resvg/resvg-js），不写入项目 package.json，
 * 避免给 yarn 依赖树增加原生模块：
 *
 *   NODE_PATH=<装了 @resvg/resvg-js 的 node_modules 目录> \
 *     node tools/make_brand_icons.cjs
 *
 * 输出：public/favicon-16.png · public/favicon-32.png
 *       public/apple-touch-icon.png (180) · public/logo-512.png
 */
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const PUBLIC = path.join(path.dirname(__dirname), "public");
const svg = fs.readFileSync(path.join(PUBLIC, "favicon.svg"), "utf8");

const TARGETS = [
  ["favicon-16.png", 16],
  ["favicon-32.png", 32],
  ["apple-touch-icon.png", 180],
  ["logo-512.png", 512],
];

for (const [name, size] of TARGETS) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  fs.writeFileSync(path.join(PUBLIC, name), png);
  console.log(`  ${name.padEnd(22)} ${size}x${size}   ${(png.length / 1024).toFixed(1)} KB`);
}
console.log(`\n完成：${TARGETS.length} 个位图已写入 public/`);

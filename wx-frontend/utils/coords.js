/** WGS-84 ↔ GCJ-02 坐标转换（与 Web 端 utils/coords.ts、后端 coords.py 同源算法）。
 *
 * FIT 文件记录 WGS-84 原始坐标，微信内置地图使用 GCJ-02（火星坐标），
 * 直接绘制轨迹会有 300~600m 偏移，因此上屏前必须转换。
 */

const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/** WGS-84 → GCJ-02，返回 [lng, lat] */
function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((AXIS * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/** 批量转换轨迹点 [[lng, lat], ...] */
function trackToGcj02(track) {
  if (!Array.isArray(track)) return [];
  return track.map((p) => wgs84ToGcj02(p[0], p[1]));
}

/** 两点球面距离（米） */
function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const p1 = (lat1 * PI) / 180;
  const p2 = (lat2 * PI) / 180;
  const dp = p2 - p1;
  const dl = ((lng2 - lng1) * PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 轨迹 → 小程序 map 组件需要的 polylines
 * @param {[number,number][]} track 原始 WGS-84 轨迹
 * @param {{color?:string, width?:number, simplify?:number}} opts
 */
function toPolylines(track, opts) {
  const o = opts || {};
  const gcj = trackToGcj02(track);
  let pts = gcj;
  const step = o.simplify || 0;
  if (step > 1 && gcj.length > step) {
    pts = gcj.filter((_, i) => i % step === 0);
    if (pts[pts.length - 1] !== gcj[gcj.length - 1]) pts.push(gcj[gcj.length - 1]);
  }
  return [
    {
      points: pts.map((p) => ({ longitude: p[0], latitude: p[1] })),
      color: o.color || "#4f46e5",
      width: o.width || 4,
      arrowLine: true,
      borderColor: "#ffffff",
      borderWidth: 1,
    },
  ];
}

/** 计算轨迹的经纬度包围盒，用于 map 初始视野 */
function bounds(track) {
  const gcj = trackToGcj02(track || []);
  if (!gcj.length) return null;
  let minLng = gcj[0][0];
  let maxLng = gcj[0][0];
  let minLat = gcj[0][1];
  let maxLat = gcj[0][1];
  gcj.forEach((p) => {
    if (p[0] < minLng) minLng = p[0];
    if (p[0] > maxLng) maxLng = p[0];
    if (p[1] < minLat) minLat = p[1];
    if (p[1] > maxLat) maxLat = p[1];
  });
  return {
    minLng,
    maxLng,
    minLat,
    maxLat,
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
  };
}

module.exports = { wgs84ToGcj02, trackToGcj02, haversine, toPolylines, bounds };

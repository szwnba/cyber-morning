// 赛博早安 · 个人晨报生成器
// 每天抓取 5 个免费 API,生成一份静态早报页面到 docs/index.html
// Node >= 18,零依赖。用法: node generate.mjs
//
// 可用环境变量覆盖配置:
//   CITY_NAME      城市名(默认 上海)
//   LAT / LON      经纬度(默认 31.23 / 121.47)
//   NASA_API_KEY   NASA APOD key(默认 DEMO_KEY,建议去 api.nasa.gov 免费注册一个)
//   COINS          币种,逗号分隔(默认 bitcoin,ethereum,solana)

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONFIG = {
  city: process.env.CITY_NAME || '上海',
  lat: process.env.LAT || '31.23',
  lon: process.env.LON || '121.47',
  tz: 'Asia/Shanghai',
  nasaKey: process.env.NASA_API_KEY || 'DEMO_KEY',
  coins: (process.env.COINS || 'bitcoin,ethereum,solana').split(',').map(s => s.trim()),
};

// ---------- 工具 ----------

async function getJSON(url, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (opts, tz = CONFIG.tz) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, ...opts });
// 用 h23 小时制取北京时间小时数,避免部分 ICU 在午夜返回 "24"
const localHour = () =>
  parseInt(new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()), 10);

// 北京时区的年进度:第几天 / 一年过了百分之多少
function yearProgress(now) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  const total = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
  const doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  return { doy, total, pct: Math.round((doy / total) * 100), ymd };
}

// ---------- 数据抓取(每个都允许失败,互不影响) ----------

async function fetchApod() {
  const d = await getJSON(`https://api.nasa.gov/planetary/apod?api_key=${CONFIG.nasaKey}&thumbs=true`);
  if (d.media_type !== 'image') throw new Error('今日是视频/其他媒体类型');
  return { title: d.title, explanation: d.explanation, image: d.url, copyright: d.copyright };
}

const WMO = {
  0: ['晴', '☀️'], 1: ['大部晴朗', '🌤️'], 2: ['局部多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
  51: ['毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['浓毛毛雨', '🌧️'],
  56: ['冻毛毛雨', '🌧️'], 57: ['冻毛毛雨', '🌧️'],
  61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
  80: ['阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
  85: ['阵雪', '🌨️'], 86: ['阵雪', '❄️'],
  95: ['雷暴', '⛈️'], 96: ['雷暴伴冰雹', '⛈️'], 99: ['雷暴伴冰雹', '⛈️'],
};

function clothingAdvice({ temp, pop, wind, desc }) {
  const bits = [];
  if (pop >= 40 || /雨|雪|雷|雹/.test(desc)) bits.push('带伞');
  if (temp >= 28) bits.push('短袖就好');
  else if (temp >= 22) bits.push('短袖,备件薄外套');
  else if (temp >= 15) bits.push('长袖或夹克');
  else if (temp >= 5) bits.push('卫衣或厚外套');
  else bits.push('羽绒服安排上');
  if (wind >= 30) bits.push('风大,压住头发');
  if (temp >= 28 && /晴/.test(desc)) bits.push('注意防晒');
  return bits.join(' · ');
}

async function fetchWeather() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', CONFIG.lat);
  url.searchParams.set('longitude', CONFIG.lon);
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m');
  url.searchParams.set('hourly', 'temperature_2m,weather_code');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('timezone', CONFIG.tz);
  url.searchParams.set('forecast_days', '2');
  const d = await getJSON(url);
  const c = d.current, day = d.daily;
  const [desc, icon] = WMO[c.weather_code] ?? ['未知天象', '🌙'];

  // 从当前小时起取未来 12 小时
  const { ymd } = yearProgress(new Date());
  const hh = String(localHour()).padStart(2, '0');
  const from = d.hourly.time.findIndex(t => t >= `${ymd}T${hh}:00`);
  const idx = from < 0 ? 0 : from;
  const hours = d.hourly.time.slice(idx, idx + 12).map((t, i) => ({
    label: i === 0 ? '现在' : t.slice(11, 16),
    temp: Math.round(d.hourly.temperature_2m[idx + i]),
    icon: (WMO[d.hourly.weather_code[idx + i]] ?? ['', ''])[1],
  }));

  const data = {
    city: CONFIG.city,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    wind: Math.round(c.wind_speed_10m),
    desc, icon, hours,
    tmin: Math.round(day.temperature_2m_min[0]),
    tmax: Math.round(day.temperature_2m_max[0]),
    pop: day.precipitation_probability_max?.[0] ?? 0,
  };
  data.advice = clothingAdvice(data);
  return data;
}

async function fetchHackerNews() {
  const ids = (await getJSON('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 10);
  const items = await Promise.all(
    ids.map(id => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null))
  );
  return items.filter(Boolean).map(it => ({
    title: it.title,
    url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
    score: it.score ?? 0,
    comments: it.descendants ?? 0,
  }));
}

async function fetchPoem() {
  const [p] = await getJSON('https://poetrydb.org/random');
  return { title: p.title, author: p.author, lines: p.lines.slice(0, 4) };
}

async function fetchCoins() {
  const ids = CONFIG.coins.join(',');
  const [usd, cny] = await Promise.all([
    getJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h&sparkline=true`),
    getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=cny`),
  ]);
  const fmtPrice = n => n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2);
  return usd.map(c => {
    const raw = c.sparkline_in_7d?.price ?? [];
    const step = Math.max(1, Math.floor(raw.length / 40));
    const spark = [];
    for (let i = 0; i < raw.length; i += step) spark.push(raw[i]);
    return {
      name: c.name,
      symbol: (c.symbol || '').toUpperCase(),
      usd: fmtPrice(c.current_price),
      cny: Math.round(cny[c.id]?.cny ?? 0).toLocaleString('zh-CN'),
      change: c.price_change_percentage_24h ?? 0,
      spark,
    };
  });
}

// ---------- SVG 小图 ----------

// 温度 12 小时曲线:折线 + 渐变面积 + 整点标签
function hoursChart(hours) {
  const W = 600, H = 172, padX = 26, top = 26, bottom = 108;
  const temps = hours.map(h => h.temp);
  const min = Math.min(...temps) - 1, max = Math.max(...temps) + 1;
  const x = i => padX + (i * (W - padX * 2)) / (hours.length - 1);
  const y = t => bottom - ((t - min) / (max - min)) * (bottom - top);
  const pts = hours.map((h, i) => `${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`).join(' ');
  const area = `M${x(0)},${bottom} L${pts.split(' ').join(' L')} L${x(hours.length - 1)},${bottom} Z`;
  const marks = hours.map((h, i) => {
    if (i % 3 !== 0 && i !== hours.length - 1) return '';
    const anchor = i === 0 ? 'start' : i === hours.length - 1 ? 'end' : 'middle';
    return `
    <text x="${x(i)}" y="${y(h.temp) - 12}" text-anchor="${anchor}" class="cv">${h.temp}°${i === 0 ? ' <tspan fill="#f5b841">现在</tspan>' : ''}</text>
    <text x="${x(i)}" y="134" text-anchor="${anchor}" class="cl">${esc(h.label)}</text>
    <text x="${x(i)}" y="158" text-anchor="${anchor}" class="ce">${h.icon}</text>`;
  }).join('');
  return `<svg class="hours" viewBox="0 0 ${W} ${H}" role="img" aria-label="未来12小时温度曲线">
    <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9cc3e5" stop-opacity=".28"/><stop offset="1" stop-color="#9cc3e5" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#hg)"/>
    <polyline points="${pts}" fill="none" stroke="#9cc3e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(0)}" cy="${y(temps[0])}" r="3.5" fill="#f5b841"/>
    ${marks}
  </svg>`;
}

// 币价 7 天迷你走势
function coinSpark(values, up, uid) {
  if (values.length < 2) return '';
  const W = 110, H = 34, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) =>
    `${(pad + (i * (W - pad * 2)) / (values.length - 1)).toFixed(1)},${(H - pad - ((v - min) / span) * (H - pad * 2)).toFixed(1)}`
  ).join(' ');
  const color = up ? '#e86a5d' : '#7fbf9e';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><linearGradient id="sg${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${pad},${H - pad} ${pts} ${W - pad},${H - pad}" fill="url(#sg${uid})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// 页脚星座分隔线
const CONSTELLATION = `<svg class="constel" viewBox="0 0 240 40" aria-hidden="true">
  <defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#9cc3e5"/><stop offset="1" stop-color="#f5b841"/>
  </linearGradient></defs>
  <polyline points="10,30 62,14 112,26 162,8 208,22 230,13" fill="none" stroke="url(#cg)" stroke-width="1" opacity=".55"/>
  <g opacity=".9">
    <circle cx="10" cy="30" r="2" fill="#9cc3e5"/><circle cx="62" cy="14" r="1.5" fill="#9cc3e5"/>
    <circle cx="112" cy="26" r="1.5" fill="#f5b841"/><circle cx="162" cy="8" r="2.2" fill="#f5b841"/>
    <circle cx="208" cy="22" r="1.5" fill="#f5b841"/><circle cx="230" cy="13" r="2" fill="#f5b841"/>
  </g>
</svg>`;

// ---------- 样式 ----------

const css = `
:root {
  --night: #0a0d18; --card: rgba(19, 26, 44, .62); --line: #232c44;
  --dawn: #f5b841; --dusk: #e8875d; --ice: #9cc3e5; --ink: #f2efe6; --muted: #8b93a8;
  --up: #e86a5d; --down: #7fbf9e;
  --serif: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", Georgia, serif;
  --sans: "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
  --gold-grad: linear-gradient(120deg, #fdf3d8 0%, #f5b841 55%, #e8875d 100%);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { color-scheme: dark; }
body {
  background:
    radial-gradient(120% 60% at 50% -8%, #1c2647 0%, rgba(28, 38, 71, 0) 55%),
    var(--night);
  color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--ice); text-decoration: none; transition: color .2s ease; }
a:hover { color: var(--dawn); }
a:focus-visible { outline: 2px solid var(--dawn); outline-offset: 2px; border-radius: 4px; }

/* ---- 头图:今日宇宙 ---- */
.hero { position: relative; min-height: min(78vh, 700px); background: var(--night); overflow: hidden; }
.hero img {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  animation: settle 7s ease-out both;
}
.hero::after {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(90% 70% at 50% 100%, rgba(10,13,24,0) 40%, rgba(10,13,24,.4) 100%),
    linear-gradient(180deg, rgba(10,13,24,.6) 0%, rgba(10,13,24,.05) 32%, rgba(10,13,24,.28) 60%, rgba(10,13,24,.96) 92%, var(--night) 100%);
}
@keyframes settle { from { transform: scale(1.06); } to { transform: scale(1); } }

.brand {
  position: absolute; top: 20px; right: 24px; z-index: 2;
  font-family: var(--mono); font-size: 10.5px; letter-spacing: .3em; color: rgba(242,239,230,.55);
  writing-mode: vertical-rl;
}
.hero-cap { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1; padding: 0 24px 30px; max-width: 769px; margin: 0 auto; }
.hero-date {
  font-family: var(--mono); font-size: 12.5px; letter-spacing: .16em; color: var(--ink);
  margin-bottom: 10px; animation: rise .7s ease-out both;
}
.hero-date .diamond { color: var(--dawn); }
.hero-date .pct { color: var(--muted); }
.hero-cap h1 {
  font-family: var(--serif); font-weight: 700;
  font-size: clamp(52px, 11vw, 88px); line-height: 1.1; letter-spacing: .1em;
  background: var(--gold-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: rise .9s .12s ease-out both;
}
@keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

.apod-note { max-width: 720px; margin: 0 auto; padding: 26px 24px 0; }
.apod-title {
  font-family: var(--mono); font-size: 12px; letter-spacing: .18em; text-transform: uppercase;
  background: var(--gold-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.apod-note p.expl { font-size: 13.5px; color: var(--muted); margin-top: 8px; }
.apod-note p.credit { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 8px; letter-spacing: .06em; }

/* ---- 签名:日出光谱线 ---- */
.spectrum {
  height: 2px; max-width: 720px; margin: 0 auto;
  background: linear-gradient(90deg, rgba(10,13,24,0) 0%, #2b3a67 26%, #7a4e8c 50%, #c86b3c 74%, #f5b841 96%);
  box-shadow: 0 0 18px rgba(245, 184, 65, .18);
}

main { max-width: 720px; margin: 0 auto; padding: 0 24px; }
section { padding: 44px 0 10px; }
.eyebrow {
  display: flex; align-items: center; gap: 10px;
  font-family: var(--mono); font-size: 12px; letter-spacing: .24em;
  color: var(--muted); text-transform: uppercase; margin-bottom: 16px;
}
.eyebrow::before { content: ""; width: 18px; height: 2px; background: var(--gold-grad); border-radius: 2px; }
.eyebrow b { color: var(--ink); font-weight: 500; }

.card {
  position: relative;
  background: var(--card);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border-radius: 20px; padding: 26px;
}
.card::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(155deg, rgba(245,184,65,.38), rgba(156,195,229,.16) 42%, rgba(255,255,255,.05) 78%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;
}

/* ---- 天气 ---- */
.wx-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.wx-city { font-size: 15px; color: var(--muted); letter-spacing: .08em; }
.wx-desc { font-size: 16px; }
.wx-desc .icon { font-size: 22px; margin-right: 6px; }
.wx-main { display: flex; align-items: flex-start; gap: 16px; margin-top: 4px; }
.wx-temp {
  font-family: var(--mono); font-size: clamp(56px, 13vw, 76px); font-weight: 500; line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.wx-temp sup { font-size: .38em; color: var(--dawn); font-weight: 400; }
.wx-feels { color: var(--muted); font-size: 13.5px; padding-top: 14px; font-family: var(--mono); }
.wx-sub { font-family: var(--mono); font-size: 12.5px; color: var(--muted); margin-top: 6px; }
.wx-sub i { font-style: normal; color: var(--ice); }
svg.hours { display: block; width: 100%; height: auto; margin-top: 18px; }
svg.hours .cv { font-family: var(--mono); font-size: 15px; fill: var(--ink); }
svg.hours .cl { font-family: var(--mono); font-size: 12.5px; fill: var(--muted); letter-spacing: .05em; }
svg.hours .ce { font-size: 15px; }
.advice {
  margin-top: 20px; padding: 12px 18px; border-radius: 12px;
  background: linear-gradient(120deg, rgba(245,184,65,.12), rgba(232,135,93,.07));
  border: 1px solid rgba(245,184,65,.26);
  font-size: 15px;
}
.advice::before { content: "→ "; color: var(--dawn); }

/* ---- 头条 ---- */
ol.news { list-style: none; counter-reset: rank; padding: 4px 0; }
ol.news li {
  counter-increment: rank; display: flex; gap: 16px; align-items: baseline;
  padding: 13px 14px; margin: 0 -14px; border-radius: 12px; transition: background .2s ease;
}
ol.news li:hover { background: rgba(255,255,255,.03); }
ol.news li + li { border-top: 1px solid rgba(35,44,68,.55); }
ol.news li::before {
  content: counter(rank, decimal-leading-zero);
  font-family: var(--mono); font-size: 13px; min-width: 24px;
  background: var(--gold-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.news .t { font-size: 16px; font-weight: 600; line-height: 1.55; }
.news .t a::after { content: " ↗"; font-size: .8em; opacity: 0; transition: opacity .2s ease; }
.news .t a:hover::after { opacity: .7; }
.news .m { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-top: 4px; letter-spacing: .04em; }

/* ---- 行情 ---- */
table.mkt { width: 100%; border-collapse: collapse; }
table.mkt td { padding: 15px 0; border-bottom: 1px solid rgba(35,44,68,.55); vertical-align: middle; }
table.mkt tr:last-child td { border-bottom: 0; }
.coin-name { font-weight: 600; font-size: 16px; white-space: nowrap; }
.coin-symbol { font-family: var(--mono); font-size: 11.5px; color: var(--muted); margin-left: 8px; letter-spacing: .08em; }
td.coin-spark { width: 116px; padding: 15px 14px; }
svg.spark { display: block; width: 110px; height: 34px; }
.coin-price { font-family: var(--mono); font-size: 17px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.coin-cny { display: block; font-size: 11.5px; color: var(--muted); font-weight: 400; margin-top: 3px; }
.chg { font-family: var(--mono); font-size: 12px; text-align: right; white-space: nowrap; }
.chg span { display: inline-block; padding: 3px 9px; border-radius: 999px; }
.chg.up span { color: var(--up); background: rgba(232,106,93,.1); }
.chg.down span { color: var(--down); background: rgba(127,191,158,.1); }
@media (max-width: 470px) { td.coin-spark { display: none; } }

/* ---- 诗 ---- */
section.poem { text-align: center; padding-bottom: 30px; }
.poem .orn { font-family: var(--serif); font-size: 44px; line-height: 1; background: var(--gold-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.poem blockquote {
  font-family: var(--serif); font-style: italic;
  font-size: clamp(18px, 4.4vw, 21px); line-height: 2.15;
  margin: 14px auto 0; max-width: 540px;
}
.poem .by {
  font-family: var(--mono); font-size: 12.5px; font-style: normal; color: var(--muted);
  margin-top: 20px; letter-spacing: .12em;
}
.poem .by::before { content: "—— "; }

/* ---- 页脚 ---- */
footer { max-width: 720px; margin: 0 auto; padding: 6px 24px 48px; text-align: center; }
svg.constel { width: 210px; height: 36px; margin: 8px auto 16px; display: block; }
footer .cols { font-family: var(--mono); font-size: 11.5px; color: var(--muted); line-height: 2.1; letter-spacing: .05em; }
footer .cols a { color: var(--ice); }

/* ---- 兜底 ---- */
.miss {
  font-size: 14px; color: var(--muted); padding: 16px 20px;
  border: 1px dashed rgba(139,147,168,.4); border-radius: 14px;
}
.miss::before { content: "✕ "; color: var(--up); }

@media (prefers-reduced-motion: reduce) {
  .hero img, .hero-cap h1, .hero-date { animation: none; }
  * { transition: none !important; }
}
`;

// ---------- HTML 渲染 ----------

function renderSection(eyebrowZh, eyebrowEn, inner) {
  return `<section><p class="eyebrow">${eyebrowZh} · <b>${eyebrowEn}</b></p>${inner}</section>`;
}

function ok(fallback, render) {
  return value => (value ? render(value) : fallback);
}

function render(data, now) {
  const hour = localHour();
  const greeting = hour < 5 ? '夜深了' : hour < 11 ? '早安' : hour < 13 ? '午安' : hour < 18 ? '午后好' : '晚上好';
  const dateLong = fmt({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  const genTime = fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const { doy, total, pct } = yearProgress(now);

  const hero = data.apod
    ? `<figure class="hero">
        <img src="${esc(data.apod.image)}" alt="${esc(data.apod.title)}">
        <span class="brand">赛博早安 · CYBER MORNING</span>
        <figcaption class="hero-cap">
          <p class="hero-date"><span class="diamond">◈</span> ${esc(dateLong)} <span class="pct">· 第 ${doy} 天 / ${total} · 已过 ${pct}%</span></p>
          <h1>${greeting}</h1>
        </figcaption>
      </figure>
      <div class="apod-note">
        <p class="apod-title">今日宇宙 · ${esc(data.apod.title)}</p>
        <p class="expl">${esc(data.apod.explanation)}</p>
        ${data.apod.copyright ? `<p class="credit">© ${esc(data.apod.copyright)} / NASA APOD</p>` : '<p class="credit">NASA APOD</p>'}
      </div>`
    : `<figure class="hero" style="background:linear-gradient(180deg,#0a0d18,#2b3a67 60%,#c86b3c)">
        <span class="brand">赛博早安 · CYBER MORNING</span>
        <figcaption class="hero-cap">
          <p class="hero-date"><span class="diamond">◈</span> ${esc(dateLong)} <span class="pct">· 第 ${doy} 天 / ${total} · 已过 ${pct}%</span></p>
          <h1>${greeting}</h1>
        </figcaption>
      </figure>
      <div class="apod-note"><p class="expl">今天的宇宙图信号弱,先看看窗外的天。</p></div>`;

  const weather = renderSection('你头顶的天', 'WEATHER',
    ok('<p class="miss">天气信号没收到</p>', w => `<div class="card">
      <div class="wx-head">
        <span class="wx-city">${esc(w.city)}</span>
        <span class="wx-desc"><span class="icon">${w.icon}</span>${esc(w.desc)}</span>
      </div>
      <div class="wx-main">
        <span class="wx-temp">${w.temp}<sup>°C</sup></span>
        <span class="wx-feels">体感 ${w.feels}°</span>
      </div>
      <p class="wx-sub">今日 <i>${w.tmin}° ~ ${w.tmax}°</i> · 降水概率 ${w.pop}% · 风 ${w.wind} km/h</p>
      ${hoursChart(w.hours)}
      <p class="advice">${esc(w.advice)}</p>
    </div>`)(data.weather));

  const news = renderSection('今晨技术头条', 'HACKER NEWS',
    ok('<p class="miss">头条信号没收到</p>', items => `<ol class="card news">
      ${items.map(it => `<li><div>
        <p class="t"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></p>
        <p class="m">▲ ${it.score} &nbsp;·&nbsp; 💬 ${it.comments}</p>
      </div></li>`).join('\n')}
    </ol>`)(data.news));

  const market = renderSection('币价行情', 'MARKETS',
    ok('<p class="miss">行情信号没收到</p>', coins => `<table class="mkt card">
      ${coins.map((c, i) => `<tr>
        <td><span class="coin-name">${esc(c.name)}</span><span class="coin-symbol">${esc(c.symbol)}</span></td>
        <td class="coin-spark">${coinSpark(c.spark, c.change >= 0, i)}</td>
        <td class="coin-price">$${esc(c.usd)}<span class="coin-cny">≈ ¥${esc(c.cny)}</span></td>
        <td class="chg ${c.change >= 0 ? 'up' : 'down'}"><span>${c.change >= 0 ? '▲' : '▼'} ${Math.abs(c.change).toFixed(2)}%</span></td>
      </tr>`).join('\n')}
    </table>`)(data.coins));

  const poem = renderSection('今日一诗', 'POETRY',
    ok('<p class="miss">缪斯今日失联</p>', p => `<div class="poem">
      <p class="orn">❝</p>
      <blockquote>
        ${p.lines.map(l => esc(l)).join('<br>')}
      </blockquote>
      <p class="by">${esc(p.author)},《${esc(p.title)}》</p>
    </div>`)(data.poem));

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0a0d18">
<title>赛博早安 · ${esc(dateLong)}</title>
<style>${css}</style>
</head>
<body>
${hero}
<div class="spectrum" role="presentation"></div>
<main>
${weather}
<div class="spectrum" role="presentation"></div>
${news}
<div class="spectrum" role="presentation"></div>
${market}
<div class="spectrum" role="presentation"></div>
${poem}
</main>
<footer>
  ${CONSTELLATION}
  <p class="cols">
    赛博早安 · 一份自动生成的晨报<br>
    信号来源:NASA APOD / Open-Meteo / HackerNews / CoinGecko / PoetryDB<br>
    生成于 ${esc(genTime)}(北京时间)
  </p>
</footer>
</body>
</html>`;
}

// ---------- 主流程 ----------

async function main() {
  const now = new Date();
  const [apod, weather, news, poem, coins] = await Promise.allSettled([
    fetchApod(), fetchWeather(), fetchHackerNews(), fetchPoem(), fetchCoins(),
  ]);
  const pick = r => (r.status === 'fulfilled' ? r.value : null);
  const data = { apod: pick(apod), weather: pick(weather), news: pick(news), poem: pick(poem), coins: pick(coins) };

  const html = render(data, now);
  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'docs');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'index.html');
  await writeFile(outPath, html, 'utf8');

  const status = Object.entries(data).map(([k, v]) => `${k}:${v ? 'ok' : 'MISS'}`).join('  ');
  console.log(`已生成 ${outPath}\n${status}`);
  if (Object.values(data).every(v => v === null)) {
    console.error('所有 API 都失败了,请检查网络');
    process.exit(1);
  }
}

main();

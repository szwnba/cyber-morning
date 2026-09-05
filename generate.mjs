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
const localHour = () => Number(fmt({ hour: 'numeric', hour12: false }).format(new Date()));

// ---------- 数据抓取(每个都允许失败,互不影响) ----------

async function fetchApod() {
  const d = await getJSON(`https://api.nasa.gov/planetary/apod?api_key=${CONFIG.nasaKey}&thumbs=true`);
  if (d.media_type !== 'image') throw new Error('今日是视频/其他媒体类型');
  return {
    title: d.title,
    explanation: d.explanation,
    image: d.url,
    copyright: d.copyright,
  };
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
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('timezone', CONFIG.tz);
  url.searchParams.set('forecast_days', '1');
  const d = await getJSON(url);
  const c = d.current, day = d.daily;
  const [desc, icon] = WMO[c.weather_code] ?? ['未知天象', '🌙'];
  const data = {
    city: CONFIG.city,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    wind: Math.round(c.wind_speed_10m),
    desc, icon,
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
    getJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`),
    getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=cny`),
  ]);
  const fmtPrice = n => n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2);
  return usd.map(c => ({
    name: c.name,
    symbol: (c.symbol || '').toUpperCase(),
    usd: fmtPrice(c.current_price),
    cny: Math.round(cny[c.id]?.cny ?? 0).toLocaleString('zh-CN'),
    change: c.price_change_percentage_24h ?? 0,
  }));
}

// ---------- HTML 渲染 ----------

const css = `
:root {
  --night: #0a0d18; --card: #131a2c; --line: #232c44;
  --dawn: #f5b841; --ice: #9cc3e5; --ink: #efeae0; --muted: #8b93a8;
  --up: #e86a5d; --down: #7fbf9e;
  --serif: "Noto Serif SC", "Songti SC", "SimSun", serif;
  --sans: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { color-scheme: dark; }
body {
  background: var(--night); color: var(--ink);
  font-family: var(--sans); font-size: 16px; line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--ice); text-decoration: none; }
a:hover { color: var(--dawn); }
a:focus-visible { outline: 2px solid var(--dawn); outline-offset: 2px; }

/* ---- 头图:今日宇宙 ---- */
.hero { position: relative; min-height: min(72vh, 640px); background: var(--card); overflow: hidden; }
.hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hero::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(10,13,24,.55) 0%, rgba(10,13,24,0) 35%, rgba(10,13,24,.92) 100%);
}
.hero-cap { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1; padding: 0 24px 28px; }
.hero-cap h1 {
  font-family: var(--serif); font-weight: 600;
  font-size: clamp(44px, 9vw, 76px); line-height: 1.15; letter-spacing: .08em;
  animation: rise .8s ease-out both;
}
.hero-date { font-family: var(--mono); font-size: 13px; letter-spacing: .18em; color: var(--ink); margin-bottom: 6px; }
.hero-date em { font-style: normal; color: var(--dawn); }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

.apod-note { max-width: 720px; margin: 0 auto; padding: 22px 24px 0; }
.apod-title { font-family: var(--mono); font-size: 12px; letter-spacing: .14em; color: var(--dawn); text-transform: uppercase; }
.apod-note p.expl { font-size: 13.5px; color: var(--muted); margin-top: 6px; }
.apod-note p.credit { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 6px; }

/* ---- 签名:日出光谱线 ---- */
.spectrum {
  height: 3px; max-width: 720px; margin: 0 auto;
  background: linear-gradient(90deg, #0a0d18 0%, #2b3a67 30%, #7a4e8c 55%, #c86b3c 78%, #f5b841 100%);
}
.spectrum.thin { height: 2px; opacity: .75; }

main { max-width: 720px; margin: 0 auto; padding: 0 24px 24px; }
section { padding: 34px 0 6px; }
.eyebrow {
  font-family: var(--mono); font-size: 12px; letter-spacing: .22em;
  color: var(--muted); text-transform: uppercase; margin-bottom: 14px;
}
.eyebrow b { color: var(--ink); font-weight: 500; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 22px; }

/* ---- 天气 ---- */
.wx-top { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; }
.wx-temp { font-family: var(--mono); font-size: clamp(48px, 10vw, 64px); font-weight: 500; line-height: 1; }
.wx-desc { font-size: 20px; }
.wx-desc .icon { font-size: 26px; margin-right: 4px; }
.wx-sub { font-family: var(--mono); font-size: 13px; color: var(--muted); margin-top: 10px; }
.wx-sub i { font-style: normal; color: var(--ice); }
.advice {
  margin-top: 16px; padding: 12px 16px; border-radius: 10px;
  background: rgba(245,184,65,.08); border: 1px solid rgba(245,184,65,.25);
  font-size: 15px;
}
.advice::before { content: "→ "; color: var(--dawn); }

/* ---- 头条 ---- */
ol.news { list-style: none; counter-reset: rank; }
ol.news li { counter-increment: rank; padding: 13px 0; border-bottom: 1px solid var(--line); display: flex; gap: 14px; }
ol.news li:last-child { border-bottom: 0; }
ol.news li::before {
  content: counter(rank, decimal-leading-zero);
  font-family: var(--mono); font-size: 13px; color: var(--dawn);
  padding-top: 3px; min-width: 24px;
}
.news .t { font-size: 15.5px; font-weight: 500; line-height: 1.5; }
.news .m { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-top: 3px; }

/* ---- 行情 ---- */
table.mkt { width: 100%; border-collapse: collapse; }
table.mkt td { padding: 12px 0; border-bottom: 1px solid var(--line); vertical-align: baseline; }
table.mkt tr:last-child td { border-bottom: 0; }
.coin-name { font-weight: 600; }
.coin-symbol { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-left: 8px; }
.coin-price { font-family: var(--mono); font-size: 17px; text-align: right; white-space: nowrap; }
.coin-cny { display: block; font-size: 12px; color: var(--muted); font-weight: 400; margin-top: 2px; }
.chg { font-family: var(--mono); font-size: 13px; text-align: right; white-space: nowrap; }
.chg.up { color: var(--up); } .chg.down { color: var(--down); }

/* ---- 诗 ---- */
section.poem { text-align: center; padding-bottom: 44px; }
.poem blockquote {
  font-family: var(--serif); font-size: clamp(17px, 4vw, 20px); line-height: 2.1;
  margin: 18px auto 0; max-width: 560px;
}
.poem .by {
  font-family: var(--mono); font-size: 12.5px; color: var(--muted); margin-top: 18px;
  letter-spacing: .1em;
}
.poem .by::before { content: "—— "; }

/* ---- 页脚 ---- */
footer { max-width: 720px; margin: 0 auto; padding: 0 24px 44px; }
footer .cols { font-family: var(--mono); font-size: 11.5px; color: var(--muted); line-height: 2; letter-spacing: .04em; }
footer .cols a { color: var(--ice); }

/* ---- 兜底 ---- */
.miss { font-size: 14px; color: var(--muted); }
.miss::before { content: "✕ "; color: var(--up); }

@media (prefers-reduced-motion: reduce) { .hero-cap h1 { animation: none; } }
`;

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

  const hero = data.apod
    ? `<figure class="hero">
        <img src="${esc(data.apod.image)}" alt="${esc(data.apod.title)}">
        <figcaption class="hero-cap">
          <p class="hero-date"><em>◈</em> ${esc(dateLong)}</p>
          <h1>${greeting}</h1>
        </figcaption>
      </figure>
      <div class="apod-note">
        <p class="apod-title">今日宇宙 · ${esc(data.apod.title)}</p>
        <p class="expl">${esc(data.apod.explanation)}</p>
        ${data.apod.copyright ? `<p class="credit">© ${esc(data.apod.copyright)} / NASA APOD</p>` : '<p class="credit">NASA APOD</p>'}
      </div>`
    : `<figure class="hero" style="background:linear-gradient(180deg,#0a0d18,#2b3a67)">
        <figcaption class="hero-cap">
          <p class="hero-date"><em>◈</em> ${esc(dateLong)}</p>
          <h1>${greeting}</h1>
        </figcaption>
      </figure>
      <div class="apod-note"><p class="expl">今天的宇宙图信号弱,先看看窗外的天。</p></div>`;

  const weather = renderSection('你头顶的天', 'WEATHER',
    ok('<p class="miss">天气信号没收到</p>', w => `<div class="card">
      <div class="wx-top">
        <span class="wx-temp">${w.temp}°</span>
        <span class="wx-desc"><span class="icon">${w.icon}</span>${esc(w.desc)}</span>
      </div>
      <p class="wx-sub">${esc(w.city)} · 体感 ${w.feels}° · 今日 <i>${w.tmin}° ~ ${w.tmax}°</i> · 降水概率 ${w.pop}% · 风 ${w.wind} km/h</p>
      <p class="advice">${esc(w.advice)}</p>
    </div>`)(data.weather));

  const news = renderSection('今晨技术头条', 'HACKER NEWS',
    ok('<p class="miss">头条信号没收到</p>', items => `<ol class="card news">
      ${items.map(it => `<li><div>
        <p class="t"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></p>
        <p class="m">▲ ${it.score} &nbsp;💬 ${it.comments}</p>
      </div></li>`).join('\n')}
    </ol>`)(data.news));

  const market = renderSection('币价行情', 'MARKETS',
    ok('<p class="miss">行情信号没收到</p>', coins => `<table class="mkt card" style="border-collapse:collapse">
      ${coins.map(c => `<tr>
        <td><span class="coin-name">${esc(c.name)}</span><span class="coin-symbol">${esc(c.symbol)}</span></td>
        <td class="coin-price">$${esc(c.usd)}<span class="coin-cny">≈ ¥${esc(c.cny)}</span></td>
        <td class="chg ${c.change >= 0 ? 'up' : 'down'}">${c.change >= 0 ? '▲' : '▼'} ${Math.abs(c.change).toFixed(2)}%</td>
      </tr>`).join('\n')}
    </table>`)(data.coins));

  const poem = renderSection('今日一诗', 'POETRY',
    ok('<p class="miss">缪斯今日失联</p>', p => `<blockquote>
      ${p.lines.map(l => esc(l)).join('<br>')}
      <p class="by">${esc(p.author)},《${esc(p.title)}》</p>
    </blockquote>`)(data.poem));

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>赛博早安 · ${esc(dateLong)}</title>
<style>${css}</style>
</head>
<body>
${hero}
<div class="spectrum" role="presentation"></div>
<main>
${weather}
<div class="spectrum thin" role="presentation"></div>
${news}
<div class="spectrum thin" role="presentation"></div>
${market}
<div class="spectrum thin" role="presentation"></div>
${poem}
</main>
<footer>
  <div class="spectrum thin" role="presentation" style="margin:0 0 18px"></div>
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

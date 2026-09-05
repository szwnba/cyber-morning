# 赛博早安 ☄️

一份每天自动生成的个人晨报网页:NASA 每日宇宙图做头图,本地天气 + 穿衣建议,HackerNews 前 10 头条,币价行情,以一首诗收尾。

全部数据来自免费公共 API,**无需付费、无需自建服务器**:生成逻辑是 GitHub Actions 定时跑一个零依赖的 Node 脚本,产出静态页面提交到仓库,由 GitHub Pages 展示。

| 信号源 | 用途 | 需要 Key? |
|---|---|---|
| [NASA APOD](https://api.nasa.gov/) | 头图 + 今日宇宙科普 | 建议(免费注册) |
| [Open-Meteo](https://open-meteo.com/) | 天气与穿衣建议 | 否 |
| [HackerNews](https://github.com/HackerNews/API) | 技术头条 × 10 | 否 |
| [CoinGecko](https://www.coingecko.com/en/api) | 币价与 24h 涨跌 | 否 |
| [PoetryDB](https://poetrydb.org/) | 今日一诗 | 否 |

## 部署步骤(约 5 分钟)

1. **创建 GitHub 仓库**,把本目录全部文件推上去(注意保留 `.github/` 目录)。

2. **开启 GitHub Pages**:仓库 Settings → Pages → Source 选 `Deploy from a branch`,分支选 `main`,目录选 `/docs`,保存。

3. **(可选)注册 NASA API key**:在 [api.nasa.gov](https://api.nasa.gov/) 免费申请,然后到仓库 Settings → Secrets and variables → Actions → New repository secret,名字填 `NASA_API_KEY`。不填也能跑,但脚本默认的 `DEMO_KEY` 是公共的,高峰期可能被限流(页面会优雅降级,只是没头图)。

4. **(可选)自定义城市和币种**:Settings → Secrets and variables → Actions → Variables 里添加:
   - `CITY_NAME` = `北京`,`LAT` = `39.90`,`LON` = `116.40`
   - `COINS` = `bitcoin,ethereum,solana`

   默认城市是上海(31.23, 121.47)。

5. 到 **Actions 页面**手动触发一次「赛博早安日报」验证全流程,然后每天北京时间 06:30 会自动更新。

## 本地预览

```bash
node generate.mjs   # 需要 Node 18+,零依赖
# 打开 docs/index.html
```

## 结构

```
generate.mjs               生成脚本:抓取 5 个 API → 单文件 HTML(内联样式)
docs/index.html            产物,GitHub Pages 从这里展示
.github/workflows/daily.yml 定时任务:每天 06:30(北京时间)生成并提交
```

单个 API 挂掉不影响整页生成,对应板块会显示「信号没收到」。

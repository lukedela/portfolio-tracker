const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json",
};

async function yahooGet(url) {
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status}`);
  }
  return res.json();
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function chartUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
}

async function fetchChartMeta(symbol) {
  const url = chartUrl(symbol);
  const data = await yahooGet(url);
  const meta = data?.chart?.result?.[0]?.meta;

  if (!meta?.regularMarketPrice) {
    throw new Error(`No chart data for ${symbol}`);
  }

  return meta;
}

function buildQuoteFromMeta(meta, symbol) {
  const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const changePercent =
    meta.regularMarketChangePercent ??
    (previousClose
      ? ((meta.regularMarketPrice - previousClose) / previousClose) * 100
      : null);

  return {
    symbol: meta.symbol || symbol,
    price: meta.regularMarketPrice,
    changePercent,
    change: meta.regularMarketChange ?? null,
    volume: meta.regularMarketVolume ?? null,
    currency: meta.currency || "USD",
    previousClose,
    marketCap: meta.marketCap ?? null,
    peRatio: meta.trailingPE ?? null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    analystTargetPrice: meta.targetMeanPrice ?? null,
    name: meta.shortName || meta.longName || symbol,
  };
}

function buildOverviewFromMeta(meta, symbol) {
  const quote = buildQuoteFromMeta(meta, symbol);
  return {
    symbol: quote.symbol,
    name: quote.name,
    currency: quote.currency,
    marketCap: quote.marketCap,
    peRatio: quote.peRatio,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
    analystTargetPrice: quote.analystTargetPrice,
    regularMarketChangePercent: quote.changePercent,
    dividendYield: meta.trailingAnnualDividendYield ?? meta.dividendYield ?? null,
    beta: meta.beta ?? null,
  };
}

app.get("/api/quote", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol query parameter" });
    }

    const meta = await fetchChartMeta(symbol);
    const quote = buildQuoteFromMeta(meta, symbol);

    res.json({
      symbol: quote.symbol,
      price: quote.price,
      changePercent: quote.changePercent,
      change: quote.change,
      volume: quote.volume,
      currency: quote.currency,
      previousClose: quote.previousClose,
    });
  } catch (err) {
    console.error("GET /api/quote", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/overview", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol query parameter" });
    }

    const meta = await fetchChartMeta(symbol);
    res.json(buildOverviewFromMeta(meta, symbol));
  } catch (err) {
    console.error("GET /api/overview", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol query parameter" });
    }

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=10`;
    const data = await yahooGet(url);
    const news = data?.news || [];

    const items = news.slice(0, 10).map((item) => ({
      title: item.title,
      url: item.link,
      source: item.publisher || item.source || "Yahoo Finance",
      publishedAt: item.providerPublishTime
        ? item.providerPublishTime * 1000
        : null,
      sentiment: mapNewsType(item.type),
    }));

    res.json({ symbol, items });
  } catch (err) {
    console.error("GET /api/news", err.message);
    res.status(500).json({ error: err.message });
  }
});

function mapNewsType(type) {
  const t = String(type || "").toUpperCase();
  if (t.includes("POSITIVE") || t.includes("BULL")) return "Bullish";
  if (t.includes("NEGATIVE") || t.includes("BEAR")) return "Bearish";
  return "Neutral";
}

app.get("/api/fx", async (req, res) => {
  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/CAD=X?interval=1d&range=1d";
    const data = await yahooGet(url);
    const meta = data?.chart?.result?.[0]?.meta;
    const rate = meta?.regularMarketPrice;

    if (!rate) {
      return res.status(404).json({ error: "USD/CAD rate unavailable" });
    }

    res.json({ from: "USD", to: "CAD", rate });
  } catch (err) {
    console.error("GET /api/fx", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname)));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Portfolio dashboard: http://localhost:${PORT}`);
});

const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || null;

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
  const change = meta.regularMarketChange ??
    (previousClose != null
      ? meta.regularMarketPrice - previousClose
      : null);
  const changePercent =
    meta.regularMarketChangePercent ??
    (previousClose != null
      ? ((meta.regularMarketPrice - previousClose) / previousClose) * 100
      : null);

  return {
    symbol: meta.symbol || symbol,
    price: meta.regularMarketPrice,
    changePercent,
    change,
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

app.get("/api/financials", async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    const modules = [
      "summaryDetail",
      "defaultKeyStatistics",
      "financialData",
      "incomeStatementHistory",
      "balanceSheetHistory",
      "cashflowStatementHistory",
      "earningsTrend",
    ].join(",");

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    const data = await yahooGet(url);
    const result = data?.quoteSummary?.result?.[0];

    if (!result) throw new Error(`No financial data for ${symbol}`);

    const sd  = result.summaryDetail || {};
    const ks  = result.defaultKeyStatistics || {};
    const fd  = result.financialData || {};
    const ish = result.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
    const bsh = result.balanceSheetHistory?.balanceSheetHistory?.[0] || {};
    const csh = result.cashflowStatementHistory?.cashflowStatements?.[0] || {};
    const et  = result.earningsTrend?.trend || [];

    function val(obj) {
      if (obj == null) return null;
      if (typeof obj === "object" && "raw" in obj) return obj.raw;
      return obj;
    }

    const revenue     = val(ish.totalRevenue);
    const netIncome   = val(ish.netIncome);
    const grossProfit = val(ish.grossProfit);
    const ebitda      = val(ish.ebitda) ?? val(fd.ebitda);
    const totalAssets = val(bsh.totalAssets);
    const totalDebt   = val(bsh.totalLiab);
    const equity      = val(bsh.totalStockholderEquity);
    const cash        = val(bsh.cash) ?? val(fd.totalCash);
    const freeCashFlow = val(csh.freeCashflow) ?? val(fd.freeCashflow);
    const operatingCF  = val(csh.totalCashFromOperatingActivities);

    const currentPrice  = val(fd.currentPrice);
    const targetMean    = val(fd.targetMeanPrice);
    const targetLow     = val(fd.targetLowPrice);
    const targetHigh    = val(fd.targetHighPrice);
    const recommendationKey = fd.recommendationKey || null;
    const numberOfAnalysts  = val(fd.numberOfAnalystOpinions);

    const fwdPE       = val(sd.forwardPE);
    const trailPE     = val(sd.trailingPE);
    const pbRatio     = val(ks.priceToBook);
    const psRatio     = val(ks.priceToSalesTrailing12Months) ?? val(sd.priceToSalesTrailing12Months);
    const evEbitda    = val(ks.enterpriseToEbitda);
    const evRevenue   = val(ks.enterpriseToRevenue);
    const beta        = val(sd.beta);
    const divYield    = val(sd.dividendYield);
    const payoutRatio = val(sd.payoutRatio);

    const revenueGrowth  = val(fd.revenueGrowth);
    const earningsGrowth = val(fd.earningsGrowth);
    const profitMargin   = val(fd.profitMargins);
    const grossMargin    = val(fd.grossMargins);
    const operatingMargin = val(fd.operatingMargins);
    const roe            = val(fd.returnOnEquity);
    const roa            = val(fd.returnOnAssets);
    const debtToEquity   = val(fd.debtToEquity);
    const currentRatio   = val(fd.currentRatio);
    const quickRatio     = val(fd.quickRatio);

    // Next year EPS estimate from trend
    const nextYearTrend = et.find(t => t.period === "+1y");
    const epsNextYear   = val(nextYearTrend?.earningsEstimate?.avg);
    const revenueNextYear = val(nextYearTrend?.revenueEstimate?.avg);

    const shortRatio = val(ks.shortRatio);
    const floatShares = val(ks.floatShares);
    const sharesOutstanding = val(ks.sharesOutstanding);
    const insiderPercent = val(ks.heldPercentInsiders);
    const institutionPercent = val(ks.heldPercentInstitutions);

    res.json({
      symbol,
      pricing: { currentPrice, targetMean, targetLow, targetHigh, recommendationKey, numberOfAnalysts },
      valuation: { fwdPE, trailPE, pbRatio, psRatio, evEbitda, evRevenue },
      income: { revenue, netIncome, grossProfit, ebitda, profitMargin, grossMargin, operatingMargin },
      growth: { revenueGrowth, earningsGrowth, epsNextYear, revenueNextYear },
      cashflow: { freeCashFlow, operatingCF },
      balanceSheet: { totalAssets, totalDebt, equity, cash, debtToEquity, currentRatio, quickRatio },
      returns: { roe, roa },
      dividends: { divYield, payoutRatio },
      risk: { beta, shortRatio },
      ownership: { floatShares, sharesOutstanding, insiderPercent, institutionPercent },
    });
  } catch (err) {
    console.error("GET /api/financials", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Session middleware
app.use(
  session({
    secret: "portfolio-dashboard-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: false,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

app.use(express.json());

// Authentication middleware
function requireAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) {
    // No password set, skip auth for local development
    return next();
  }
  if (req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

// Login endpoint
app.post("/api/login", (req, res) => {
  if (!DASHBOARD_PASSWORD) {
    return res.status(400).json({ error: "Password protection not configured" });
  }
  
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }
  
  if (password === DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  
  res.status(401).json({ error: "Invalid password" });
});

// Logout endpoint
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ success: true });
  });
});

// Check auth status
app.get("/api/auth-status", (req, res) => {
  res.json({ 
    authenticated: req.session.authenticated || !DASHBOARD_PASSWORD,
    passwordProtected: !!DASHBOARD_PASSWORD,
  });
});

// Middleware to serve login page or protect dashboard
app.use((req, res, next) => {
  // Always allow API endpoints and login.html
  if (req.path.startsWith("/api/") || req.path === "/login.html") {
    return next();
  }
  
  // If no password is set, allow all access (local development)
  if (!DASHBOARD_PASSWORD) {
    return next();
  }
  
  // If authenticated, allow access
  if (req.session.authenticated) {
    return next();
  }
  
  // For HTML requests, redirect to login
  if (req.path === "/" || req.path.endsWith(".html")) {
    return res.sendFile(path.join(__dirname, "login.html"));
  }
  
  // For other requests, deny access
  res.status(401).json({ error: "Unauthorized" });
});

app.use(express.static(path.join(__dirname)));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Portfolio dashboard: http://localhost:${PORT}`);
});

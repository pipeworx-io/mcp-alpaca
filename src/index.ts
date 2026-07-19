interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Alpaca MCP — real-time US stock market data via the Alpaca Market Data API
 * (data.alpaca.markets, v2). BYOK: free Alpaca accounts get real-time
 * IEX-feed data including extended hours; VWAP comes back on every bar.
 *
 * Tools:
 * - alpaca_snapshot: latest trade/quote, today's OHLCV, prev close, change %,
 *   latest minute bar (= the extended-hours price during pre/post market)
 * - alpaca_bars: historical OHLCV bars with per-bar VWAP and trade counts
 * - alpaca_intraday_vwap: session cumulative VWAP (from 04:00 ET) vs current
 *   price — answers "is X above or below VWAP right now" in one call
 *
 * Auth: `_apiKey` REQUIRED as "key_id:secret_key" (combined-credential
 * pattern, like kroger/dataforseo). Split on the FIRST colon; sent as
 * APCA-API-KEY-ID / APCA-API-SECRET-KEY headers. Free at alpaca.markets —
 * a paper-trading account is enough for market data.
 *
 * Feed: `iex` everywhere (the free-tier feed). `sip` needs a paid Alpaca
 * data subscription — the 403 subscription error is caught and explained.
 */


const BASE_URL = 'https://data.alpaca.markets/v2/stocks';

const KEY_DESC =
  'REQUIRED: your Alpaca credentials as "key_id:secret_key" — both halves joined by a colon. Free at alpaca.markets (a paper-trading account is enough for market data).';

const tools: McpToolExport['tools'] = [
  {
    name: 'alpaca_snapshot',
    description:
      'Real-time US stock snapshot with extended-hours coverage: latest trade price, bid/ask quote, today\'s OHLCV, previous close, change and change % vs previous close, plus the latest minute bar with its VWAP — during pre-market and after-hours the minute bar IS the live extended-hours price. Answers "pre-market price of OKTA", "overnight change %", "after-hours volume and high/low". Multiple symbols comma-separated (max 20). BYOK Alpaca (free account), real-time IEX feed. Example: alpaca_snapshot({ symbols: "OKTA,AAPL", _apiKey: "key_id:secret_key" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbols: {
          type: 'string',
          description: 'Comma-separated ticker symbols, e.g. "OKTA" or "BLK,AAPL,RHI,CTAS" (max 20)',
        },
        _apiKey: { type: 'string', description: KEY_DESC },
      },
      required: ['symbols', '_apiKey'],
    },
  },
  {
    name: 'alpaca_bars',
    description:
      'Historical US stock OHLCV bars with per-bar VWAP and trade count. Timeframes 1Min/5Min/15Min/1Hour/1Day; intraday bars include pre-market and after-hours sessions on the IEX feed. Each bar: {t, o, h, l, c, v, vwap, trades}. Use start/end ISO timestamps or a lookback shorthand like "2h", "5d". Multiple symbols comma-separated (max 20). BYOK Alpaca (free account). Example: alpaca_bars({ symbols: "AAPL", timeframe: "5Min", lookback: "1d", _apiKey: "key_id:secret_key" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbols: {
          type: 'string',
          description: 'Comma-separated ticker symbols, e.g. "AAPL,MSFT" (max 20)',
        },
        timeframe: {
          type: 'string',
          description: 'Bar size: "1Min", "5Min", "15Min", "1Hour", or "1Day" (default "5Min")',
        },
        start: {
          type: 'string',
          description: 'Start time, ISO/RFC-3339 (e.g. "2026-07-18T09:30:00-04:00") or date "2026-07-18"',
        },
        end: {
          type: 'string',
          description: 'End time, ISO/RFC-3339 or date (default: now)',
        },
        lookback: {
          type: 'string',
          description: 'Shorthand window ending now, instead of start/end: e.g. "30m", "2h", "1d", "5d", "2w"',
        },
        limit: {
          type: 'number',
          description: 'Max bars per symbol to return, 1-1000 (default 100)',
        },
        _apiKey: { type: 'string', description: KEY_DESC },
      },
      required: ['symbols', '_apiKey'],
    },
  },
  {
    name: 'alpaca_intraday_vwap',
    description:
      'Current session VWAP for US stocks — is the price above or below VWAP right now? Fetches today\'s 1-minute bars from 04:00 ET (pre-market included), computes the cumulative volume-weighted average price, and compares it to the latest trade. Returns current_price, session_vwap, above_vwap, and session volume per symbol. Answers "current VWAP for BLK, AAPL, RHI, CTAS — above or below?" in one call. Multiple symbols comma-separated (max 20). BYOK Alpaca (free account), real-time IEX feed. Example: alpaca_intraday_vwap({ symbols: "BLK,AAPL,RHI,CTAS", _apiKey: "key_id:secret_key" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbols: {
          type: 'string',
          description: 'Comma-separated ticker symbols, e.g. "BLK,AAPL,RHI,CTAS" (max 20)',
        },
        _apiKey: { type: 'string', description: KEY_DESC },
      },
      required: ['symbols', '_apiKey'],
    },
  },
];

// ── Auth ────────────────────────────────────────────────────────────

interface Creds {
  keyId: string;
  secret: string;
}

// Combined-credential pattern: split on the FIRST colon (Alpaca secrets can
// themselves contain colons in principle; key IDs never do).
function parseKey(raw: unknown): Creds {
  const key = String(raw ?? '').trim();
  const idx = key.indexOf(':');
  if (!key || idx < 1 || idx === key.length - 1) {
    throw new Error(
      'Alpaca requires _apiKey in the form "key_id:secret_key" — your API Key ID and Secret Key joined by a colon, e.g. "PKABC123:xYz789secret". Both values come from the same API-key screen at alpaca.markets (free; a paper-trading account is enough for market data).',
    );
  }
  return { keyId: key.slice(0, idx), secret: key.slice(idx + 1) };
}

// ── HTTP ────────────────────────────────────────────────────────────

async function alpacaError(res: Response, tool: string): Promise<Error> {
  let message = '';
  try {
    const text = await res.text();
    try {
      message = String((JSON.parse(text) as { message?: string }).message ?? '');
    } catch {
      message = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    }
  } catch {
    /* body unreadable — status alone will have to do */
  }
  if (res.status === 429) {
    return new Error(
      `Alpaca ${tool}: rate-limit (HTTP 429). The free tier allows 200 requests/min per account — wait a minute and retry, or batch symbols into one call (comma-separated, up to 20).`,
    );
  }
  if (/subscription/i.test(message)) {
    return new Error(
      `Alpaca ${tool}: the account's data subscription rejected this request (${message}). This pack uses feed=iex, the feed included with free accounts; the "sip" consolidated feed requires a paid Alpaca market-data subscription. If it persists, accept the market-data agreement in the alpaca.markets dashboard.`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    return new Error(
      `Alpaca ${tool}: auth rejected (HTTP ${res.status}). _apiKey must be "key_id:secret_key" — the API Key ID and Secret Key from alpaca.markets joined by a colon. Verify both halves are current (regenerating the key invalidates the old secret). Keys are free; a paper-trading account is enough for market data.`,
    );
  }
  return new Error(`Alpaca ${tool} error: HTTP ${res.status}${message ? ` — ${message}` : ''}`);
}

async function api(
  path: string,
  params: URLSearchParams,
  creds: Creds,
  tool: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${BASE_URL}${path}?${params}`, {
      headers: {
        'APCA-API-KEY-ID': creds.keyId,
        'APCA-API-SECRET-KEY': creds.secret,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw await alpacaError(res, tool);
    return res.json();
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(
        `Alpaca ${tool}: request timed out after 10s. Retry once; if it persists, reduce the symbol count or date range.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Symbols ─────────────────────────────────────────────────────────

function parseSymbols(args: Record<string, unknown>): string[] {
  const raw = String(args.symbols ?? args.symbol ?? args.tickers ?? args.ticker ?? '').trim();
  const syms = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (syms.length === 0) {
    throw new Error(
      'Alpaca tools require symbols — comma-separated tickers like "AAPL" or "BLK,AAPL,RHI,CTAS".',
    );
  }
  if (syms.length > 20) {
    throw new Error(
      `Alpaca tools accept up to 20 symbols per call (got ${syms.length}). Split the list into batches.`,
    );
  }
  return syms;
}

// ── Eastern-time session math ───────────────────────────────────────
// ET boundaries via Intl.DateTimeFormat('America/New_York') — the runtime's
// tz database handles DST, same technique as the mbta pack.

function etParts(d: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? 0 : Number(get('hour'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + Number(get('minute')),
  };
}

// Current ET UTC-offset as "-04:00" / "-05:00" — used to build RFC-3339
// timestamps pinned to ET wall-clock times (the 04:00 ET session start).
function etOffset(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  }).formatToParts(d);
  const v = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  const off = v.replace('GMT', '');
  return off || '-05:00';
}

const MARKET_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const MARKET_CLOSE_MIN = 16 * 60; // 16:00 ET

type Session = 'pre-market' | 'regular' | 'after-hours';

function classifySession(timestamp: string): Session {
  const { minutes } = etParts(new Date(timestamp));
  if (minutes < MARKET_OPEN_MIN) return 'pre-market';
  if (minutes >= MARKET_CLOSE_MIN) return 'after-hours';
  return 'regular';
}

// ── VWAP math (exported for unit tests) ─────────────────────────────
// Session cumulative VWAP = Σ(bar_vwap · bar_volume) / Σ(bar_volume).
// Bars missing `vw` fall back to close; zero-volume bars contribute nothing.

export function sessionVwap(bars: Array<{ v: number; vw?: number; c: number }>): number | null {
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const volume = b.v ?? 0;
    if (volume <= 0) continue;
    const price = b.vw ?? b.c;
    pv += price * volume;
    vol += volume;
  }
  return vol > 0 ? pv / vol : null;
}

// ── Upstream shapes ─────────────────────────────────────────────────

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
}

interface AlpacaTrade {
  t: string;
  p: number;
  s: number;
}

interface AlpacaQuote {
  t: string;
  bp: number;
  bs: number;
  ap: number;
  as: number;
}

interface AlpacaSnapshot {
  latestTrade?: AlpacaTrade;
  latestQuote?: AlpacaQuote;
  minuteBar?: AlpacaBar;
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}

function shapeBar(b: AlpacaBar) {
  return {
    t: b.t,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: b.v,
    vwap: b.vw ?? null,
    trades: b.n ?? null,
  };
}

const round = (x: number, dp = 4) => Math.round(x * 10 ** dp) / 10 ** dp;

// ── alpaca_snapshot ─────────────────────────────────────────────────

function shapeSnapshot(symbol: string, s: AlpacaSnapshot | undefined) {
  if (!s || (!s.latestTrade && !s.dailyBar && !s.minuteBar)) {
    return {
      symbol,
      error: `No data for "${symbol}" — verify it is a US exchange ticker (e.g. "OKTA", "BRK.B"). Company names like "Okta" are rejected upstream.`,
    };
  }
  const prevClose = s.prevDailyBar?.c ?? null;
  const lastPrice = s.latestTrade?.p ?? null;
  const change = lastPrice != null && prevClose != null ? round(lastPrice - prevClose, 4) : null;
  const changePct =
    lastPrice != null && prevClose != null && prevClose !== 0
      ? round(((lastPrice - prevClose) / prevClose) * 100, 3)
      : null;
  const minuteBar = s.minuteBar;
  const session = minuteBar ? classifySession(minuteBar.t) : null;
  return {
    symbol,
    latest_trade: s.latestTrade
      ? { price: s.latestTrade.p, size: s.latestTrade.s, time: s.latestTrade.t }
      : null,
    latest_quote: s.latestQuote
      ? {
          bid: s.latestQuote.bp,
          bid_size: s.latestQuote.bs,
          ask: s.latestQuote.ap,
          ask_size: s.latestQuote.as,
          time: s.latestQuote.t,
        }
      : null,
    today: s.dailyBar
      ? {
          open: s.dailyBar.o,
          high: s.dailyBar.h,
          low: s.dailyBar.l,
          close: s.dailyBar.c,
          volume: s.dailyBar.v,
          vwap: s.dailyBar.vw ?? null,
        }
      : null,
    previous_close: prevClose,
    change,
    change_percent: changePct,
    // During pre/post market the latest minute bar IS the live
    // extended-hours price/volume on the IEX feed.
    latest_minute_bar: minuteBar ? shapeBar(minuteBar) : null,
    session,
    extended_hours: session != null && session !== 'regular',
  };
}

async function snapshot(args: Record<string, unknown>, creds: Creds) {
  const symbols = parseSymbols(args);
  const params = new URLSearchParams({ symbols: symbols.join(','), feed: 'iex' });
  const data = (await api('/snapshots', params, creds, 'alpaca_snapshot')) as Record<
    string,
    AlpacaSnapshot
  >;
  return {
    feed: 'iex',
    count: symbols.length,
    note: 'change/change_percent compare the latest trade (extended hours included) to the previous regular-session close. latest_minute_bar.vwap is the most recent 1-minute VWAP; use alpaca_intraday_vwap for the full-session cumulative VWAP.',
    snapshots: symbols.map((sym) => shapeSnapshot(sym, data[sym])),
  };
}

// ── alpaca_bars ─────────────────────────────────────────────────────

const TIMEFRAMES: Record<string, string> = {
  '1min': '1Min',
  '5min': '5Min',
  '15min': '15Min',
  '1hour': '1Hour',
  '1h': '1Hour',
  '60min': '1Hour',
  '1day': '1Day',
  '1d': '1Day',
  daily: '1Day',
};

const LOOKBACK_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseLookback(raw: string): number {
  const m =
    /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks)$/i.exec(
      raw.trim(),
    );
  if (!m) {
    throw new Error(
      `Alpaca alpaca_bars: unrecognized lookback "${raw}". Use forms like "30m", "2h", "1d", "5d", "2w" — or pass explicit start/end ISO timestamps.`,
    );
  }
  return Number(m[1]) * LOOKBACK_MS[m[2][0].toLowerCase()];
}

async function bars(args: Record<string, unknown>, creds: Creds) {
  const symbols = parseSymbols(args);
  const rawTf = String(args.timeframe ?? '5Min').trim();
  const timeframe = TIMEFRAMES[rawTf.toLowerCase()];
  if (!timeframe) {
    throw new Error(
      `Alpaca alpaca_bars: timeframe must be one of 1Min, 5Min, 15Min, 1Hour, 1Day (got "${rawTf}").`,
    );
  }
  const limit = Math.min(Math.max(Number(args.limit ?? 100) || 100, 1), 1000);

  let start = args.start ? String(args.start).trim() : '';
  if (!start && args.lookback) {
    start = new Date(Date.now() - parseLookback(String(args.lookback))).toISOString();
  }
  if (!start) {
    // Sensible default window: enough history to fill `limit` bars.
    const defaults: Record<string, number> = {
      '1Min': 86_400_000,
      '5Min': 3 * 86_400_000,
      '15Min': 7 * 86_400_000,
      '1Hour': 14 * 86_400_000,
      '1Day': 200 * 86_400_000,
    };
    start = new Date(Date.now() - defaults[timeframe]).toISOString();
  }

  const params = new URLSearchParams({
    symbols: symbols.join(','),
    timeframe,
    start,
    feed: 'iex',
    limit: String(Math.min(limit * symbols.length, 10_000)),
    sort: 'asc',
  });
  if (args.end) params.set('end', String(args.end).trim());

  const data = (await api('/bars', params, creds, 'alpaca_bars')) as {
    bars?: Record<string, AlpacaBar[]>;
    next_page_token?: string | null;
  };
  const bySymbol = data.bars ?? {};
  return {
    feed: 'iex',
    timeframe,
    start,
    end: args.end ? String(args.end) : 'now',
    note: 'Intraday bars include pre-market and after-hours trading on the IEX feed. vwap is the per-bar volume-weighted average price.',
    truncated: Boolean(data.next_page_token),
    results: symbols.map((sym) => {
      const list = (bySymbol[sym] ?? []).slice(-limit);
      return {
        symbol: sym,
        bar_count: list.length,
        note:
          list.length === 0
            ? `No bars for "${sym}" in this window — verify the ticker and that the window covers a trading session.`
            : undefined,
        bars: list.map(shapeBar),
      };
    }),
  };
}

// ── alpaca_intraday_vwap ────────────────────────────────────────────

async function intradayVwap(args: Record<string, unknown>, creds: Creds) {
  const symbols = parseSymbols(args);
  const now = new Date();
  const { date: etDate } = etParts(now);
  const sessionStart = `${etDate}T04:00:00${etOffset(now)}`;

  // Today's 1-minute bars from 04:00 ET (pre-market start). Up to ~960
  // bars/symbol — paginate so a 20-symbol call still sees the full session.
  const bySymbol: Record<string, AlpacaBar[]> = {};
  let pageToken: string | null | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      symbols: symbols.join(','),
      timeframe: '1Min',
      start: sessionStart,
      feed: 'iex',
      limit: '10000',
      sort: 'asc',
    });
    if (pageToken) params.set('page_token', pageToken);
    const data = (await api('/bars', params, creds, 'alpaca_intraday_vwap')) as {
      bars?: Record<string, AlpacaBar[]>;
      next_page_token?: string | null;
    };
    for (const [sym, list] of Object.entries(data.bars ?? {})) {
      (bySymbol[sym] ??= []).push(...list);
    }
    pageToken = data.next_page_token;
    if (!pageToken) break;
  }

  const tradeData = (await api(
    '/trades/latest',
    new URLSearchParams({ symbols: symbols.join(','), feed: 'iex' }),
    creds,
    'alpaca_intraday_vwap',
  )) as { trades?: Record<string, AlpacaTrade> };
  const trades = tradeData.trades ?? {};

  return {
    feed: 'iex',
    session_date_et: etDate,
    session_start: sessionStart,
    note: 'session_vwap is the cumulative volume-weighted average price over all 1-minute IEX bars since 04:00 ET today (pre-market included). above_vwap compares the latest trade to it.',
    results: symbols.map((sym) => {
      const symBars = bySymbol[sym] ?? [];
      const vwap = sessionVwap(symBars);
      const trade = trades[sym];
      const price = trade?.p ?? null;
      if (vwap == null || price == null) {
        return {
          symbol: sym,
          error: `No session data for "${sym}" today — verify the ticker, and that a US trading session is underway or completed (weekends and market holidays have zero bars).`,
        };
      }
      return {
        symbol: sym,
        current_price: price,
        current_price_time: trade.t,
        session: classifySession(trade.t),
        session_vwap: round(vwap),
        above_vwap: price > vwap,
        distance_from_vwap_percent: round(((price - vwap) / vwap) * 100, 3),
        session_volume: symBars.reduce((s, b) => s + (b.v ?? 0), 0),
        bar_count: symBars.length,
      };
    }),
  };
}

// ── Dispatch ────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const creds = parseKey(args._apiKey);
  delete args._apiKey;
  switch (name) {
    case 'alpaca_snapshot':
      return snapshot(args, creds);
    case 'alpaca_bars':
      return bars(args, creds);
    case 'alpaca_intraday_vwap':
      return intradayVwap(args, creds);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;

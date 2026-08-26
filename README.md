# mcp-alpaca

Alpaca MCP — real-time US stock market data via the Alpaca Market Data API

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `alpaca_snapshot` | Real-time US stock snapshot with extended-hours coverage: latest trade price, bid/ask quote, today's OHLCV, previous close, change and change % vs previous close, plus the latest minute bar with its VWAP — during pre-market and after-hours the minute bar IS the live extended-hours price. Answers "pre-market price of OKTA", "overnight change %", "after-hours volume and high/low". Multiple symbols comma-separated (max 20). BYOK Alpaca (free account), real-time IEX feed. Example: alpaca_snapshot({ symbols: "OKTA,AAPL", _apiKey: "key_id:secret_key" }) |
| `alpaca_bars` | Historical US stock OHLCV bars with per-bar VWAP and trade count. Timeframes 1Min/5Min/15Min/1Hour/1Day; intraday bars include pre-market and after-hours sessions on the IEX feed. Each bar: {t, o, h, l, c, v, vwap, trades}. Use start/end ISO timestamps or a lookback shorthand like "2h", "5d". Multiple symbols comma-separated (max 20). BYOK Alpaca (free account). Example: alpaca_bars({ symbols: "AAPL", timeframe: "5Min", lookback: "1d", _apiKey: "key_id:secret_key" }) |
| `alpaca_intraday_vwap` | Current session VWAP for US stocks — is the price above or below VWAP right now? Fetches today's 1-minute bars from 04:00 ET (pre-market included), computes the cumulative volume-weighted average price, and compares it to the latest trade. Returns current_price, session_vwap, above_vwap, and session volume per symbol. Answers "current VWAP for BLK, AAPL, RHI, CTAS — above or below?" in one call. Multiple symbols comma-separated (max 20). BYOK Alpaca (free account), real-time IEX feed. Example: alpaca_intraday_vwap({ symbols: "BLK,AAPL,RHI,CTAS", _apiKey: "key_id:secret_key" }) |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "alpaca": {
      "url": "https://gateway.pipeworx.io/alpaca/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/alpaca/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Alpaca data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

#!/usr/bin/env node
import https from "https";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { initProxies, getAgent, proxyStatus, forceRefresh } from "./proxy-manager.js";
import { createTrendsClient } from "./trends-client.js";

const server = new Server(
  { name: "google-trends", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Запускаем загрузку прокси при старте (не блокирует инициализацию сервера)
initProxies().catch(() => {});

const trends = createTrendsClient({ getAgent, https });

// ─── инструменты ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "compare_keywords",
      description: "Compare search interest over time for up to 5 keywords",
      inputSchema: {
        type: "object",
        properties: {
          keywords: { type: "array", items: { type: "string" }, description: "Up to 5 keywords" },
          geo:      { type: "string", description: "Country code e.g. US, RU (default: worldwide)", default: "" },
          timeframe:{ type: "string", description: "e.g. today 12-m, today 5-y", default: "today 12-m" }
        },
        required: ["keywords"]
      }
    },
    {
      name: "get_related_queries",
      description: "Get top and rising related queries for a keyword",
      inputSchema: {
        type: "object",
        properties: {
          keyword:  { type: "string" },
          geo:      { type: "string", default: "" },
          timeframe:{ type: "string", default: "today 12-m" }
        },
        required: ["keyword"]
      }
    },
    // get_trending_searches отключён: Google стабильно возвращает HTML вместо JSON
    // на этом endpoint без residential-прокси (dailyTrends + realTimeTrends оба блокируются).
    // Включить обратно когда будет рабочий прокси-пул.
    {
      name: "get_interest_by_region",
      description: "Get search interest by region/country for a keyword",
      inputSchema: {
        type: "object",
        properties: {
          keyword:  { type: "string" },
          geo:      { type: "string", default: "" },
          timeframe:{ type: "string", default: "today 12-m" }
        },
        required: ["keyword"]
      }
    },
    {
      name: "proxy_status",
      description: "Show proxy pool status: source, working count, age, freshness, and validation progress",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "proxy_refresh",
      description: "Re-validate the current proxy source (PROXY_LIST or PROXY_LIST_FILE). Blocks until done. No-op for PROXY_URL single-proxy mode.",
      inputSchema: { type: "object", properties: {} }
    }
  ]
}));

// ─── обработчики ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "proxy_status") {
      const s = proxyStatus();
      if (!s.enabled) {
        return { content: [{ type: "text", text: s.message }] };
      }
      const lines = [
        `Source          : ${s.source}`,
        `Working proxies : ${s.working}`,
        `Last checked    : ${s.lastChecked}`,
        `Age             : ${s.ageMinutes !== null ? `${s.ageMinutes} min` : "—"}`,
        `Fresh (< ${s.ttlHours}h)  : ${s.fresh ? "yes" : "no"}`,
        `Refreshing now  : ${s.refreshing ? "yes" : "no"}`,
        `Progress        : ${s.progress ?? "—"}`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    if (name === "proxy_refresh") {
      const result = await forceRefresh();
      if (result.disabled) return { content: [{ type: "text", text: "Proxy disabled — unset PROXIES_ENABLED or set =true to enable" }] };
      if (result.single) return { content: [{ type: "text", text: result.message }] };
      if (result.empty) return { content: [{ type: "text", text: result.message }] };
      if (result.alreadyRunning) {
        const s = proxyStatus();
        return { content: [{ type: "text", text: `Already refreshing: ${s.progress}` }] };
      }
      return { content: [{ type: "text", text: `Done. Working proxies: ${result.working}. Last checked: ${result.lastChecked}` }] };
    }

    if (name === "compare_keywords") {
      const raw = await trends.interestOverTime({
        keyword: args.keywords, geo: args.geo ?? "", hl: "en-US", timezone: 0
      });
      const data = JSON.parse(raw);
      const timeline = data.default.timelineData.map(p => ({
        date: p.formattedAxisLabel,
        values: Object.fromEntries(args.keywords.map((k, i) => [k, p.value[i]]))
      }));
      return { content: [{ type: "text", text: JSON.stringify(timeline, null, 2) }] };
    }

    if (name === "get_related_queries") {
      const raw = await trends.relatedQueries({
        keyword: args.keyword, geo: args.geo ?? "", hl: "en-US"
      });
      const data = JSON.parse(raw);
      const result = data.default.rankedList.map(list => list.rankedKeyword);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // get_trending_searches отключён — см. комментарий в ListToolsRequestSchema

    if (name === "get_interest_by_region") {
      const raw = await trends.interestByRegion({
        keyword: args.keyword, geo: args.geo ?? "", hl: "en-US"
      });
      const data = JSON.parse(raw);
      const regions = data.default.geoMapData
        .sort((a, b) => b.value[0] - a.value[0])
        .slice(0, 20)
        .map(r => ({ region: r.geoName, value: r.value[0] }));
      return { content: [{ type: "text", text: JSON.stringify(regions, null, 2) }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };

  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

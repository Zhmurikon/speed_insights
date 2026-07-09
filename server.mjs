#!/usr/bin/env node
// PageSpeed Insights MCP-сервер (stdio, JSON-RPC 2.0, без внешних зависимостей).
//
// Отдаёт ИИ-агенту структурированные данные PageSpeed Insights — те же, что и
// pagespeed.web.dev (лабораторный Lighthouse + полевые данные CrUX).
//
// Ключ Google API берётся из (по приоритету):
//   1) переменной окружения PSI_API_KEY
//   2) файла ~/.claude/tools/psi-mcp/.psi_key
//
// Регистрация (user scope, доступен во всех проектах):
//   claude mcp add psi --scope user -- node ~/.claude/tools/psi-mcp/server.mjs

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PROTOCOL_VERSION = "2024-11-05";

function loadKey() {
  if (process.env.PSI_API_KEY) return process.env.PSI_API_KEY.trim();
  for (const p of [join(HERE, ".psi_key"), join(homedir(), ".psi_key")]) {
    if (existsSync(p)) return readFileSync(p, "utf8").trim();
  }
  return null;
}

async function fetchPsi(url, strategy) {
  const key = loadKey();
  const cats = ["performance", "accessibility", "best-practices", "seo"];
  const params = new URLSearchParams({ url, strategy });
  let qs = params.toString() + cats.map((c) => `&category=${c}`).join("");
  if (key) qs += `&key=${encodeURIComponent(key)}`;
  const res = await fetch(`${API}?${qs}`, {
    headers: { "User-Agent": "psi-mcp/1.0" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `PSI API HTTP ${res.status}: ${body.slice(0, 500)}` +
        (key ? "" : "\n(API-ключ не найден — задай PSI_API_KEY или ~/.claude/tools/psi-mcp/.psi_key)")
    );
  }
  return res.json();
}

// ── Разбор ответа в компактные структуры ──────────────────────────────────
function pickScores(data) {
  const cats = data?.lighthouseResult?.categories ?? {};
  const out = {};
  for (const [k, c] of Object.entries(cats)) {
    out[k] = typeof c.score === "number" ? Math.round(c.score * 100) : null;
  }
  return out;
}

function pickLab(data) {
  const audits = data?.lighthouseResult?.audits ?? {};
  const m = (id) => {
    const a = audits[id] ?? {};
    return { value: a.numericValue ?? null, display: a.displayValue ?? null, score: a.score ?? null };
  };
  return {
    LCP: m("largest-contentful-paint"),
    FCP: m("first-contentful-paint"),
    CLS: m("cumulative-layout-shift"),
    TBT: m("total-blocking-time"),
    SpeedIndex: m("speed-index"),
    TTI: m("interactive"),
  };
}

function pickField(data) {
  const le = data?.loadingExperience;
  if (!le?.metrics) return null;
  const out = { overall_category: le.overall_category ?? null };
  for (const [k, v] of Object.entries(le.metrics)) {
    out[k] = { percentile: v.percentile ?? null, category: v.category ?? null };
  }
  return out;
}

function pickOpportunities(data) {
  const audits = data?.lighthouseResult?.audits ?? {};
  const out = [];
  for (const [id, a] of Object.entries(audits)) {
    const saving = a?.details?.overallSavingsMs;
    if (saving > 0 && typeof a.score === "number" && a.score < 1) {
      out.push({ id, title: a.title, savings_ms: Math.round(saving), display: a.displayValue ?? null });
    }
  }
  out.sort((x, y) => y.savings_ms - x.savings_ms);
  return out.slice(0, 15);
}

function pickFailed(data) {
  const audits = data?.lighthouseResult?.audits ?? {};
  const out = [];
  for (const [id, a] of Object.entries(audits)) {
    if (typeof a.score === "number" && a.score < 1 && ["binary", "numeric"].includes(a.scoreDisplayMode)) {
      out.push({ id, title: a.title, score: a.score, display: a.displayValue ?? null });
    }
  }
  out.sort((x, y) => x.score - y.score);
  return out.slice(0, 40);
}

function summarize(data, strategy) {
  return {
    url: data.id,
    strategy,
    fetched_at: data?.lighthouseResult?.fetchTime ?? null,
    scores: pickScores(data),
    lab_metrics: pickLab(data),
    field_data_crux: pickField(data),
    top_opportunities: pickOpportunities(data),
    failed_audits: pickFailed(data),
  };
}

// ── Определения инструментов ──────────────────────────────────────────────
const TOOLS = [
  {
    name: "psi_audit",
    description:
      "Полный SEO/performance-аудит страницы через PageSpeed Insights (данные как на pagespeed.web.dev). " +
      "Возвращает баллы по 4 категориям, Core Web Vitals (лаб), полевые данные CrUX, топ проблем по экономии и проваленные аудиты.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Полный URL страницы (с https://)" },
        strategy: { type: "string", enum: ["mobile", "desktop"], default: "mobile", description: "Устройство. По умолчанию mobile (Google mobile-first)." },
      },
      required: ["url"],
    },
  },
  {
    name: "psi_scores",
    description:
      "Быстрый обзор: только 4 балла (performance, accessibility, best-practices, seo) 0–100. Для проверки страниц пачкой.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Полный URL страницы" },
        strategy: { type: "string", enum: ["mobile", "desktop"], default: "mobile" },
      },
      required: ["url"],
    },
  },
  {
    name: "psi_core_web_vitals",
    description:
      "Только Core Web Vitals: лабораторные метрики (LCP, FCP, CLS, TBT, Speed Index, TTI) и полевые данные CrUX по реальным пользователям, если Google их накопил.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Полный URL страницы" },
        strategy: { type: "string", enum: ["mobile", "desktop"], default: "mobile" },
      },
      required: ["url"],
    },
  },
  {
    name: "psi_compare",
    description:
      "Сравнивает mobile и desktop для одного URL: баллы по категориям и ключевые CWV бок о бок. Два запроса к API.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Полный URL страницы" } },
      required: ["url"],
    },
  },
];

async function callTool(name, args) {
  const url = args?.url;
  if (!url) throw new Error("Не передан обязательный параметр 'url'.");
  const strategy = args?.strategy === "desktop" ? "desktop" : "mobile";

  if (name === "psi_audit") {
    return summarize(await fetchPsi(url, strategy), strategy);
  }
  if (name === "psi_scores") {
    const data = await fetchPsi(url, strategy);
    return { url: data.id, strategy, scores: pickScores(data) };
  }
  if (name === "psi_core_web_vitals") {
    const data = await fetchPsi(url, strategy);
    return { url: data.id, strategy, lab_metrics: pickLab(data), field_data_crux: pickField(data) };
  }
  if (name === "psi_compare") {
    const [m, d] = await Promise.all([fetchPsi(url, "mobile"), fetchPsi(url, "desktop")]);
    const brief = (data, s) => ({ scores: pickScores(data), core_web_vitals: pickLab(data), field: pickField(data) });
    return { url, mobile: brief(m), desktop: brief(d) };
  }
  throw new Error(`Неизвестный инструмент: ${name}`);
}

// ── JSON-RPC поверх stdio (newline-delimited) ─────────────────────────────
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

let inFlight = 0;
let stdinEnded = false;

async function handle(msg) {
  const { id, method, params } = msg;
  // Уведомления (без id) не требуют ответа.
  if (id === undefined || id === null) return;

  try {
    if (method === "initialize") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "psi", version: "1.0.0" },
        },
      });
    }
    if (method === "tools/list") {
      return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    }
    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments ?? {});
      return send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    }
    if (method === "ping") {
      return send({ jsonrpc: "2.0", id, result: {} });
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: `Ошибка: ${e.message}` }], isError: true },
    });
  }
}

// Режим самопроверки ключа: `node server.mjs --selftest [KEY]` → exit 0/1.
if (process.argv.includes("--selftest")) {
  const i = process.argv.indexOf("--selftest");
  const k = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : process.env.PSI_API_KEY || "";
  if (k) process.env.PSI_API_KEY = k;
  try {
    await fetchPsi("https://example.com/", "mobile");
    process.exit(0);
  } catch (e) {
    console.error(String(e?.message || e));
    process.exit(1);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) {
      try {
        const msg = JSON.parse(line);
        inFlight++;
        Promise.resolve(handle(msg)).finally(() => {
          inFlight--;
          if (stdinEnded && inFlight === 0) process.exit(0);
        });
      } catch {
        /* игнорируем битые строки */
      }
    }
  }
});
process.stdin.on("end", () => {
  stdinEnded = true;
  if (inFlight === 0) process.exit(0);
});

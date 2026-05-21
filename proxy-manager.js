import https from "https";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dir, "proxies.json");

const PROXIES_ENABLED = process.env.PROXIES_ENABLED !== "false";
const PROXY_URL_ENV = process.env.PROXY_URL || null;
const PROXY_LIST_ENV = process.env.PROXY_LIST || null;
const PROXY_LIST_FILE_ENV = process.env.PROXY_LIST_FILE || null;

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const CHECK_TIMEOUT = 10_000;
const CONCURRENCY = 50;
// autocomplete — самый лёгкий endpoint, всегда отвечает )]}' + JSON, без авторизации.
// Префикс может быть с запятой ()]}',) или без — проверяем только 4-байтный маркер.
const TEST_URL = "https://trends.google.com/trends/api/autocomplete/test?hl=en-US&tz=0";
export const TRENDS_MARKER = ")]}'";

let working = [];
let validating = false;
let lastChecked = null;
let validateProgress = null;
let sourceMode = "disabled"; // "single" | "env-list" | "env-file" | "disabled" | "none"

function makeAgent(proxyUrl) {
  if (proxyUrl.startsWith("socks")) return new SocksProxyAgent(proxyUrl);
  return new HttpsProxyAgent(proxyUrl);
}

export function normalize(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  if (/^(https?|socks5?h?):\/\//.test(t)) return t;
  return `http://${t}`;
}

function get(url, agent, timeoutMs = CHECK_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };

    const req = https.get(url, { agent, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
        if (body.includes(TRENDS_MARKER)) {
          done({ status: res.statusCode, body });
          res.destroy();
        }
      });
      res.on("end", () => done({ status: res.statusCode, body }));
      res.on("error", () => done({ status: res.statusCode, body }));
    });
    req.on("timeout", () => { req.destroy(); fail(new Error("timeout")); });
    req.on("error", fail);
  });
}

async function checkProxy(proxyUrl) {
  try {
    const agent = makeAgent(proxyUrl);
    const { status, body } = await get(TEST_URL, agent);
    if (status === 200 && body.includes(TRENDS_MARKER)) return true;
    return false;
  } catch {
    return false;
  }
}

async function loadCandidates() {
  if (PROXY_LIST_ENV) {
    sourceMode = "env-list";
    return PROXY_LIST_ENV.split(",").map(normalize).filter(Boolean);
  }
  if (PROXY_LIST_FILE_ENV) {
    try {
      const raw = await fs.readFile(PROXY_LIST_FILE_ENV, "utf-8");
      sourceMode = "env-file";
      return raw.split("\n").map(normalize).filter(Boolean);
    } catch (e) {
      // stderr — не корруптит stdio JSON-RPC канал MCP
      console.error(`[proxy-manager] PROXY_LIST_FILE unreadable: ${PROXY_LIST_FILE_ENV} — ${e.message}`);
      sourceMode = "none";
      return [];
    }
  }
  sourceMode = "none";
  return [];
}

export function hashList(list) {
  return crypto.createHash("sha1").update([...list].sort().join("\n")).digest("hex");
}

async function loadCache(expectedHash) {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data.inputHash !== expectedHash) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveCache(inputHash, validUrls) {
  lastChecked = new Date().toISOString();
  await fs.writeFile(CACHE_FILE, JSON.stringify({
    inputHash,
    lastChecked,
    working: validUrls,
  }, null, 2));
}

async function runCheck(candidates) {
  const results = [];
  let i = 0;
  validateProgress = { started: new Date().toISOString(), checked: 0, total: candidates.length, found: 0 };

  async function worker() {
    while (i < candidates.length) {
      const proxy = candidates[i++];
      const ok = await checkProxy(proxy);
      if (ok) { results.push(proxy); validateProgress.found++; }
      validateProgress.checked++;
    }
  }

  const n = Math.min(CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: n }, worker));
  validateProgress = null;
  return results;
}

async function validate(candidates, inputHash) {
  if (validating) return;
  validating = true;
  try {
    const valid = await runCheck(candidates);
    working = valid.map(url => ({ url, fails: 0 }));
    await saveCache(inputHash, valid);
  } finally {
    validating = false;
  }
}

function revalidateInBackground(candidates, inputHash) {
  validate(candidates, inputHash).catch(() => {});
}

export async function initProxies() {
  if (!PROXIES_ENABLED) { sourceMode = "disabled"; return; }

  if (PROXY_URL_ENV) {
    const url = normalize(PROXY_URL_ENV);
    if (url) {
      sourceMode = "single";
      working = [{ url, fails: 0 }];
      lastChecked = new Date().toISOString();
      return;
    }
  }

  const candidates = await loadCandidates();
  if (candidates.length === 0) return;
  const inputHash = hashList(candidates);

  const cache = await loadCache(inputHash);
  if (cache?.working?.length) {
    working = cache.working.map(url => ({ url, fails: 0 }));
    lastChecked = cache.lastChecked;
    const age = Date.now() - new Date(cache.lastChecked).getTime();
    if (age < CACHE_TTL_MS) return;
    revalidateInBackground(candidates, inputHash);
    return;
  }

  await validate(candidates, inputHash);
}

export function getAgent() {
  if (!PROXIES_ENABLED || working.length === 0) return null;

  if (sourceMode === "single") {
    const entry = working[0];
    return { agent: makeAgent(entry.url), onFail: () => entry.fails++ };
  }

  working = working.filter(p => p.fails < 3);
  if (working.length === 0) return null;

  const entry = working[Math.floor(Math.random() * working.length)];
  return { agent: makeAgent(entry.url), onFail: () => entry.fails++ };
}

export function proxyCount() {
  return working.length;
}

export function proxyStatus() {
  if (!PROXIES_ENABLED) {
    return {
      enabled: false,
      source: "disabled",
      working: 0,
      message: "Proxy disabled — direct requests. Unset PROXIES_ENABLED or set =true to enable.",
    };
  }
  const ageMs = lastChecked ? Date.now() - new Date(lastChecked).getTime() : null;
  const ageMin = ageMs !== null ? Math.round(ageMs / 60_000) : null;
  const fresh = ageMs !== null && ageMs < CACHE_TTL_MS;

  return {
    enabled: true,
    source: sourceMode,
    working: working.length,
    lastChecked: lastChecked ?? "never",
    ageMinutes: ageMin,
    fresh,
    ttlHours: CACHE_TTL_MS / 3_600_000,
    refreshing: validating,
    progress: validateProgress
      ? `${validateProgress.checked}/${validateProgress.total} checked, ${validateProgress.found} working (started ${validateProgress.started})`
      : null,
  };
}

export async function forceRefresh() {
  if (!PROXIES_ENABLED) return { disabled: true };
  if (sourceMode === "single") return { single: true, message: "PROXY_URL mode — nothing to revalidate" };
  if (validating) return { alreadyRunning: true };

  const candidates = await loadCandidates();
  if (candidates.length === 0) return { empty: true, message: "No proxies in source" };
  const inputHash = hashList(candidates);
  await validate(candidates, inputHash);
  return { done: true, working: working.length, lastChecked };
}
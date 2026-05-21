import googleTrends from "google-trends-api";

export const MAX_ATTEMPTS = 3;
export const looksLikeHtml = (v) => typeof v === "string" && v.trimStart().startsWith("<");

/**
 * Создаёт обёртку над google-trends-api с ретраями по прокси.
 * Failure trigger: исключение от библиотеки ИЛИ HTML-ответ (Google заблокировал).
 *
 * @param {object} deps
 * @param {() => {agent, onFail: () => void} | null} deps.getAgent
 * @param {{globalAgent: any}} deps.https
 * @param {number} [deps.maxAttempts]
 */
export function createTrendsClient({ getAgent, https, maxAttempts = MAX_ATTEMPTS }) {
  function withProxy(fn) {
    return async (...args) => {
      let lastErr = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const proxy = getAgent();
        const prev = https.globalAgent;
        if (proxy) https.globalAgent = proxy.agent;
        try {
          const result = await fn(...args);
          if (looksLikeHtml(result)) {
            if (proxy) proxy.onFail();
            lastErr = new Error("Google returned HTML — proxy blocked or rate limited");
            continue;
          }
          return result;
        } catch (err) {
          if (proxy) proxy.onFail();
          lastErr = err;
        } finally {
          https.globalAgent = prev;
        }
      }
      throw lastErr ?? new Error(`All ${maxAttempts} attempts failed`);
    };
  }

  return {
    interestOverTime: withProxy(googleTrends.interestOverTime.bind(googleTrends)),
    relatedQueries:   withProxy(googleTrends.relatedQueries.bind(googleTrends)),
    interestByRegion: withProxy(googleTrends.interestByRegion.bind(googleTrends)),
    realTimeTrends:   withProxy(googleTrends.realTimeTrends.bind(googleTrends)),
    dailyTrends:      withProxy(googleTrends.dailyTrends.bind(googleTrends)),
    _withProxy: withProxy,
  };
}

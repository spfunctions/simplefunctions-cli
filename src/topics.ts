/**
 * Topic → Kalshi series mapping
 *
 * Shared between dashboard, liquidity scanner, and other commands
 * that need to categorize markets by topic.
 */

export const TOPIC_SERIES: Record<string, string[]> = {
  oil:       ['KXWTIMAX', 'KXWTIW', 'KXWTID'],
  recession: ['KXRECSSNBER'],
  fed:       ['KXFEDDECISION'],
  cpi:       ['KXCPI'],
  gas:       ['KXAAAGASM'],
  sp500:     ['KXINXY'],
}

/** Map a series prefix to a human-readable category name (for dashboard display) */
export const RISK_CATEGORIES: Record<string, string> = {
  KXWTIMAX: 'Oil',
  KXWTI: 'Oil',
  KXRECSSNBER: 'Recession',
  KXAAAGASM: 'Gas',
  KXCPI: 'Inflation',
  KXINXY: 'S&P 500',
  KXFEDDECISION: 'Fed Rate',
  KXUNEMPLOYMENT: 'Unemployment',
  KXCLOSEHORMUZ: 'Hormuz',
}

/**
 * Given a ticker string, return the topic name (uppercased).
 * Matches longest prefix first to avoid ambiguity (e.g. KXWTIMAX before KXWTI).
 */
export function tickerToTopic(ticker: string): string {
  const sorted = Object.entries(TOPIC_SERIES)
    .flatMap(([topic, series]) => series.map(s => ({ prefix: s, topic })))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  for (const { prefix, topic } of sorted) {
    if (ticker.toUpperCase().startsWith(prefix)) return topic.toUpperCase()
  }
  return 'OTHER'
}

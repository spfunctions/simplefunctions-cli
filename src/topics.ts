/**
 * Topic → Kalshi series mapping
 *
 * Shared between dashboard, liquidity scanner, and other commands
 * that need to categorize markets by topic.
 *
 * Sourced from Kalshi's top series by volume (non-sports).
 * Run `sf scan` to discover new series.
 */

export const TOPIC_SERIES: Record<string, string[]> = {
  oil:          ['KXWTIMAX', 'KXWTIW', 'KXWTID', 'KXWTI'],
  gas:          ['KXAAAGASM', 'KXAAAGASW', 'KXCPIGAS'],
  fed:          ['KXFEDDECISION', 'KXFED', 'KXRATECUT', 'KXRATECUTCOUNT'],
  cpi:          ['KXCPI', 'KXCPIYOY'],
  recession:    ['KXRECSSNBER'],
  sp500:        ['KXINXY', 'KXINXU', 'KXINX'],
  nasdaq:       ['KXNASDAQ100', 'KXNASDAQ100U', 'KXNASDAQ100Y'],
  crypto:       ['KXBTCD', 'KXBTC', 'KXBTC15M', 'KXBTCMAXY', 'KXBTCMINY', 'KXBTCY',
                 'KXETHD', 'KXETH', 'KXETH15M', 'KXETHMAXY', 'KXETHMINY',
                 'KXSOL15M', 'KXXRP15M'],
  unemployment: ['KXU3', 'KXPAYROLLS'],
  gdp:          ['KXGDP'],
  treasury:     ['KXTNOTEW', 'KXTNOTED'],
  geopolitics:  ['KXCLOSEHORMUZ', 'KXHORMUZTRAFFICW', 'KXHORMUZTRAFFIC', 'KXHORMUZNORM',
                 'KXLEADERSOUT', 'KXLEADEROUT', 'KXMADUROOUT', 'KXKHAMENEIOUT'],
  elections:    ['PRES', 'KXFEDCHAIRNOM', 'KXPRESNOMD', 'KXPRESNOMR', 'KXPRESPERSON',
                 'KXNEXTPOPE', 'KXTRUMPOUT', 'KXCANADAPM'],
  politics:     ['KXGOVSHUT', 'KXGOVTSHUTDOWN', 'KXGOVSHUTLENGTH', 'KXGOVTCUTS',
                 'KXTRUMPMENTION', 'KXEOWEEK', 'KXGREENLAND', 'KXCANCOALITION'],
  centralbanks: ['KXCBDECISIONJAPAN', 'KXCBDECISIONENGLAND', 'KXCBDECISIONEU',
                 'KXCBDECISIONAUSTRALIA', 'KXCBDECISIONCANADA', 'KXCBDECISIONCHINA',
                 'KXCBDECISIONMEXICO', 'KXCBDECISIONKOREA'],
  forex:        ['KXUSDJPY'],
  tariffs:      ['KXTARIFFRATEPRC', 'KXTARIFFRATECAN', 'KXTARIFFRATECA',
                 'KXTARIFFRATEINDIA', 'KXTARIFFRATEBR', 'KXTARIFFRATEEU',
                 'KXTARIFFRATEJP', 'KXTARIFFRATEKR'],
  tech:         ['KXLLM1', 'KXTOPMODEL', 'KXALIENS'],
}

/** Map a series prefix to a human-readable category name (for dashboard display) */
export const RISK_CATEGORIES: Record<string, string> = {
  KXWTIMAX: 'Oil',
  KXWTIW: 'Oil',
  KXWTID: 'Oil',
  KXWTI: 'Oil',
  KXAAAGASM: 'Gas',
  KXAAAGASW: 'Gas',
  KXCPIGAS: 'Gas',
  KXRECSSNBER: 'Recession',
  KXCPI: 'Inflation',
  KXCPIYOY: 'Inflation',
  KXINXY: 'S&P 500',
  KXINXU: 'S&P 500',
  KXINX: 'S&P 500',
  KXNASDAQ100: 'Nasdaq',
  KXNASDAQ100U: 'Nasdaq',
  KXNASDAQ100Y: 'Nasdaq',
  KXFEDDECISION: 'Fed Rate',
  KXFED: 'Fed Rate',
  KXRATECUT: 'Fed Rate',
  KXRATECUTCOUNT: 'Fed Rate',
  KXBTCD: 'Bitcoin',
  KXBTC: 'Bitcoin',
  KXBTC15M: 'Bitcoin',
  KXETHD: 'Ethereum',
  KXETH: 'Ethereum',
  KXETH15M: 'Ethereum',
  KXU3: 'Unemployment',
  KXPAYROLLS: 'Jobs',
  KXGDP: 'GDP',
  KXTNOTEW: 'Treasury',
  KXTNOTED: 'Treasury',
  KXCLOSEHORMUZ: 'Hormuz',
  KXHORMUZTRAFFICW: 'Hormuz',
  KXHORMUZTRAFFIC: 'Hormuz',
  KXUSDJPY: 'USD/JPY',
  KXGOVSHUT: 'Govt Shutdown',
  KXGOVTSHUTDOWN: 'Govt Shutdown',
  PRES: 'Elections',
  KXFEDCHAIRNOM: 'Elections',
  KXTARIFFRATEPRC: 'Tariffs',
  KXCBDECISIONJAPAN: 'Central Banks',
  KXCBDECISIONENGLAND: 'Central Banks',
  KXCBDECISIONEU: 'Central Banks',
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

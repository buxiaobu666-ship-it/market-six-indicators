import { launch } from '@cloudflare/playwright';

// Temporary, authenticated read-only probe. No Telegram token and no schedule.
const sources = [
  ['vix', 'https://www.investing.com/indices/volatility-s-p-500', 'VIX'],
  ['vxn', 'https://fred.stlouisfed.org/series/VXNCLS', 'VXNCLS'],
  ['cape', 'https://www.multpl.com/shiller-pe', 'Current Shiller PE Ratio'],
  ['ndxPe', 'https://www.gurufocus.com/economic_indicators/6778/nasdaq-100-pe-ratio', 'Nasdaq 100 PE Ratio'],
  ['ahr999', 'https://ahr999.aix4u.com/', 'AHR999'],
  ['ltt', 'https://www.longtermtrends.com/market-cap-to-gdp-the-buffett-indicator/', 'Buffett Indicator'],
  ['buffett', 'https://www.gurufocus.com/economic_indicators/4602/usa-ratio-of-total-market-cap-over-gdp?search=usa', 'USA Ratio of Total Market Cap over GDP']
];

export default {
  async fetch(request, env) {
    if (!env.PROBE_KEY || request.headers.get('authorization') !== `Bearer ${env.PROBE_KEY}`) return new Response('Unauthorized', {status:401});
    if (request.method !== 'POST') return new Response('Use POST', {status:405});
    const browser = await launch(env.BROWSER);
    const rows = [];
    const startedAt = new Date().toISOString();
    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('target');
    const selectedSources = target === 'gf'
      ? sources.filter(([key]) => key === 'ndxPe' || key === 'buffett')
      : target === 'ltt'
        ? sources.filter(([key]) => key === 'ltt')
        : sources.filter(([key]) => key !== 'ltt');
    try {
      for (const [key, url, anchor] of selectedSources) {
        const page = await browser.newPage();
        try {
          const response = await page.goto(url, {waitUntil:'domcontentloaded', timeout:20000});
          const row = {key, url, status:response?.status(), checkedAt:new Date().toISOString()};
          if (!response?.ok()) {
            await page.waitForTimeout(12000);
            row.finalUrl = page.url();
            row.finalTitle = await page.title();
            row.finalText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500);
            rows.push(row);
            continue;
          }
          await page.waitForTimeout(1500);
          row.evidence = await page.evaluate(({key, anchor}) => {
            const text = document.body.innerText.replace(/\s+/g, ' ').trim();
            const index = text.toLowerCase().indexOf(anchor.toLowerCase());
            const samples = [];
            for (const match of text.matchAll(/(?:As of|Updated:|latest reading UTC|Current Shiller PE Ratio|Current Nasdaq|Closed)/gi)) {
              samples.push(text.slice(Math.max(0, match.index-150), match.index+400));
              if (samples.length >= 10) break;
            }
            return {
              title:document.title,
              excerpt:index >= 0 ? text.slice(Math.max(0,index-100), index+2200) : text.slice(0,1000),
              samples,
              ...(key === 'vix' ? {
                quote:document.querySelector('[data-test="instrument-price-last"]')?.textContent,
                status:document.querySelector('[data-test="instrument-header-details"]')?.textContent
              } : {})
            };
          }, {key, anchor});
          rows.push(row);
        } catch (error) {
          rows.push({key, url, error:String(error.message).split('\n')[0]});
        } finally { await page.close().catch(() => {}); }
      }
    } finally { await browser.close(); }
    return Response.json({startedAt, rows, note:'Access probe only; value/date/source validation is still required before enabling delivery.'});
  }
};

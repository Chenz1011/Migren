import { config } from './config.js';
import { log } from './log.js';

type Kind = 'discovery' | 'trigger' | 'execute' | 'error' | 'startup';

function isEnabled(kind: Kind): boolean {
  if (!config.telegramBotToken || !config.telegramChatId) return false;
  if (kind === 'discovery') return config.tgNotifyDiscovery;
  if (kind === 'trigger') return config.tgNotifyTrigger;
  if (kind === 'execute') return config.tgNotifyExecute;
  return true; // error, startup always on if TG configured
}

export async function sendTg(kind: Kind, text: string): Promise<void> {
  if (!isEnabled(kind)) return;
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.warn('telegram send failed', { status: res.status, body });
    }
  } catch (e: any) {
    log.warn('telegram error', { err: e?.message ?? String(e) });
  }
}

export const tg = {
  startup: (addr: string, ticker: string, size: string, route: string) =>
    sendTg(
      'startup',
      `*🤖 Migren started*\nTicker: *${ticker}*\nSize: *${size} ETH*\nRoute: *${route}*\nWallet: \`${addr}\``,
    ),
  discovery: (token: string, ticker: string) =>
    sendTg(
      'discovery',
      `*🎯 ${ticker} discovered*\n\`${token}\`\nWatching for migration + volume spike.`,
    ),
  trigger: (reason: string, detail: string) =>
    sendTg('trigger', `*🔥 Trigger: ${reason}*\n${detail}`),
  execute: (opts: { reason: string; token: string; sizeEth: string; txHash?: string; dryRun: boolean }) =>
    sendTg(
      'execute',
      [
        `*✅ Entry ${opts.dryRun ? '(DRY-RUN)' : 'EXECUTED'}*`,
        `Reason: *${opts.reason}*`,
        `Size: *${opts.sizeEth} ETH*`,
        `Token: \`${opts.token}\``,
        opts.txHash
          ? `[Tx on Blockscout](https://robinhoodchain.blockscout.com/tx/${opts.txHash})`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  error: (where: string, msg: string) => sendTg('error', `*❌ Error in ${where}*\n\`${msg}\``),
};

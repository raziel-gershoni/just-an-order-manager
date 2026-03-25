import { Bot } from 'grammy';

let _bot: Bot | null = null;
let _initialized = false;

export function getBot(): Bot {
  if (!_bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    _bot = new Bot(token);
  }
  return _bot;
}

export function ensureBotSetup(setup: (bot: Bot) => void): Bot {
  const bot = getBot();
  if (!_initialized) {
    setup(bot);
    _initialized = true;
  }
  return bot;
}

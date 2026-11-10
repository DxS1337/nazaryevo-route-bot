import { readFileSync, writeFileSync } from 'node:fs';
import { add, at, clock, moscowDate, parseWhen, plan, render, schedules } from './planner.mjs';
import { TrainService } from './yandex.mjs';
import { renderCard } from './card.mjs';
import { renderSchedule, scheduleNames } from './schedule-card.mjs';
import { withStatus, sendPhoto } from './delivery.mjs';
import { createWebhookServer } from './webhook.mjs';

function number(name, fallback, max = 180) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`Некорректная настройка ${name}`);
  return value;
}
const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) { console.error('Заполни TELEGRAM_BOT_TOKEN в файле .env и запусти снова.'); process.exit(1); }
const config = { busZhavoronki: number('BUS_ZHAVORONKI_MIN', 15), busOdintsovo: number('BUS_ODINTSOVO_MIN', 40), transfer: number('TRANSFER_MIN', 3), returnTransfer: number('RETURN_TRANSFER_MIN', 3), odintsovoTransfer: number('ODINTSOVO_TRANSFER_MIN', 5), walk: number('WALK_MIN', 0) };
const allowed = new Set((process.env.ALLOWED_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const trains = new TrainService(process.env.YANDEX_RASP_API_KEY?.trim());
const keyboard = { keyboard: [['➡️ В Одинцово', '🏠 В Назарьево'], ['🕒 Выбрать время', '📋 Расписание автобусов'], ['ℹ️ Как считается']], resize_keyboard: true };
let directions = {};
try { directions = JSON.parse(readFileSync('.directions.json', 'utf8')); } catch {}
function setDirection(chat, direction) {
  directions[chat] = direction;
  writeFileSync('.directions.json', JSON.stringify(directions));
}
const help = 'Сравниваю прямой №81 и маршрут через Жаворонки в обе стороны.\n\nНажми «В Одинцово» или «В Назарьево» — сразу покажу маршрут на сейчас. Направление запоминается. Для другой поездки пришли время: 14:30 или «завтра 08:00». Все даты и часы — московские.\n\n/back — вернуться в Назарьево сейчас\n/out — в Одинцово сейчас\n/time — выбрать время\n/schedule — карточки расписания автобусов\n/help — помощь';
async function telegram(method, body, timeout = 20000) {
  let response;
  try { response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) }); }
  catch { throw new Error('Сеть Telegram недоступна.'); }
  const data = await response.json();
  if (!data.ok) { const error = new Error(`Telegram: HTTP ${data.error_code || response.status}`); error.code = data.error_code; error.retryAfter = data.parameters?.retry_after; throw error; }
  return data.result;
}
const send = (chat, text) => telegram('sendMessage', { chat_id: chat, text, reply_markup: keyboard, link_preview_options: { is_disabled: true } });
async function route(chat, when, mode = 'now', direction = directions[chat] || 'out') {
  return withStatus(telegram, chat, 'Готовлю карточку маршрута…', async removeStatus => {
  const ready = add(when, config.walk);
  let all = [], fetchedAt, trainError;
  try {
    // Include the following day for the last bus and trains after midnight.
    const last = add(ready, 1440 + config.busZhavoronki + config.transfer);
    for (let day = at(moscowDate(ready), '00:00'); day <= last; day = add(day, 1440)) {
      const result = await trains.forDate(moscowDate(day), direction);
      all.push(...result.trains);
      if (!fetchedAt || result.fetchedAt < fetchedAt) fetchedAt = result.fetchedAt;
    }
  } catch (error) { trainError = error.message; all = []; fetchedAt = undefined; }
  const result = plan(ready, all, config, direction);
  try {
    const png = await renderCard(when, config, result, trainError, fetchedAt);
    await removeStatus();
    await sendPhoto(telegram, chat, png, 'route.png');
  } catch {
    await removeStatus();
    await send(chat, render(when, config, result, trainError, fetchedAt));
    return;
  }
  await telegram('sendMessage', { chat_id: chat,
    text: (trainError ? `⚠️ ${trainError}\n` : '') + 'Прибытие автобусов расчётное.\nДанные электричек: Яндекс.Расписания\nhttps://rasp.yandex.ru/',
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: '↻ Обновить', callback_data: `route:${direction}:${mode === 'now' ? 'now' : when.toISOString()}` }], [{ text: direction === 'out' ? '🏠 Обратно в Назарьево' : '➡️ В Одинцово', callback_data: `route:${direction === 'out' ? 'back' : 'out'}:now` }]] }
  });
  }, keyboard);
}
async function handle(update) {
  if (update.callback_query) {
    const query = update.callback_query;
    if (query.message?.chat.type !== 'private') return;
    if (allowed.size && !allowed.has(String(query.from.id))) return telegram('answerCallbackQuery', { callback_query_id: query.id, text: 'Доступ ограничен.' });
    await telegram('answerCallbackQuery', { callback_query_id: query.id, text: 'Обновляю маршрут…' });
    if (!query.data?.startsWith('route:')) return;
    const payload = query.data.slice(6);
    const direction = payload.startsWith('back:') ? 'back' : payload.startsWith('out:') ? 'out' : 'out';
    const value = /^(back|out):/.test(payload) ? payload.slice(payload.indexOf(':') + 1) : payload;
    const selected = value === 'now' ? new Date() : new Date(value);
    if (!Number.isFinite(+selected)) return;
    if (value !== 'now' && selected < new Date()) return send(query.message.chat.id, 'Выбранное время уже прошло. Нажми кнопку направления или выбери новое время.');
    trains.cache.clear();
    setDirection(query.message.chat.id, direction);
    return route(query.message.chat.id, selected, value === 'now' ? 'now' : 'selected', direction);
  }
  const message = update.message;
  if (!message || message.chat.type !== 'private' || !message.text) return;
  if (allowed.size && !allowed.has(String(message.from.id))) { await send(message.chat.id, 'Этот бот доступен владельцу и разрешённым пользователям.'); return; }
  const chat = message.chat.id;
  const text = message.text.trim();
  const command = text.split(/\s/)[0].split('@')[0];
  if (['/start', '/help'].includes(command)) return send(chat, help);
  if (['/back', '/out'].includes(command) || ['➡️ В Одинцово', '🏠 В Назарьево'].includes(text)) {
    const direction = command === '/back' || text === '🏠 В Назарьево' ? 'back' : 'out';
    setDirection(chat, direction);
    return route(chat, new Date(), 'now', direction);
  }
  if (text === 'ℹ️ Как считается') return send(chat, `Время — Europe/Moscow. Автобусы — по подтверждённым фотографиям, ежедневно. До Жаворонков ≈${config.busZhavoronki} мин, до Одинцова ≈${config.busOdintsovo} мин, включая остановки. До остановки: ${config.walk} мин. В Жаворонках автобус → электричка: ${config.transfer} мин. В Жаворонках электричка → автобус в Назарьево: ${config.returnTransfer} мин. В Одинцове автобус → электричка: ${config.odintsovoTransfer} мин. Текущий маршрут заканчивается у станции Одинцово; эти 5 минут к прибытию автобуса не прибавляются.\n\nПроверяю автобусы на 24 часа вперёд и электрички, на которые успеваешь. Сравниваю время прибытия, включая более поздние быстрые поезда. Расписание электричек кэшируется до 2 минут. Пробки и фактические задержки не учитываются.\n\nДанные электричек: Яндекс.Расписания — https://rasp.yandex.ru/`);
  if (command === '/schedule' || text === '📋 Расписание автобусов') {
    return withStatus(telegram, chat, 'Готовлю расписание автобусов…', async removeStatus => {
      try {
        const generatedAt = new Date();
        const cards = await Promise.all(Object.keys(scheduleNames).map(async key => ({ key, png: await renderSchedule(key, generatedAt) })));
        await removeStatus();
        for (const card of cards) await sendPhoto(telegram, chat, card.png, `${card.key}.png`);
        await send(chat, 'Расписание №81 в четырёх направлениях. Ежедневно, время московское. Нажми на карточку, чтобы открыть её на весь экран.');
      } catch {
        await removeStatus();
        await send(chat, 'Не удалось отправить все карточки. Расписание текстом:\n\n' + Object.entries(scheduleNames).map(([key, names]) => `${names.join(' → ')}\n${schedules[key]}`).join('\n\n'));
      }
    }, keyboard);
  }
  if (command === '/time' || text === '🕒 Выбрать время') return send(chat, 'Пришли время по Москве: 14:30, «завтра 08:00» или дату и время: 2026-11-12 09:00. Это время, когда ты готов выйти; время до остановки добавлю автоматически.');
  if (command === '/now' || text === '🚀 Уехать сейчас') return route(chat, new Date());
  try { return await route(chat, parseWhen(text), 'selected'); }
  catch (error) { return send(chat, error.message); }
}
const deliveryMode = process.env.BOT_MODE || 'polling';
if (!['polling', 'webhook'].includes(deliveryMode)) throw new Error('BOT_MODE: polling или webhook');
let webhookServer;
let ready = false;
if (deliveryMode === 'webhook') {
  webhookServer = createWebhookServer({ secret: process.env.WEBHOOK_SECRET, handle, isReady: () => ready });
  await new Promise(resolve => webhookServer.listen(Number(process.env.PORT || 10000), '0.0.0.0', resolve));
}
let offset = 0;
try { offset = Number(readFileSync('.poll-offset', 'utf8')) || 0; } catch {}
try {
  const me = await telegram('getMe', {});
  const webhook = await telegram('getWebhookInfo', {});
  if (deliveryMode === 'polling' && webhook.url) throw new Error('Бот подключён к хостингу через webhook. Локальный polling не запущен.');
  await telegram('setMyCommands', { commands: [{ command: 'now', description: 'Уехать в выбранном направлении' }, { command: 'back', description: 'Из Одинцова в Назарьево сейчас' }, { command: 'out', description: 'Из Назарьева в Одинцово сейчас' }, { command: 'time', description: 'Выбрать время по Москве' }, { command: 'schedule', description: 'Расписание автобусов №81' }, { command: 'help', description: 'Помощь' }] });
  if (deliveryMode === 'webhook') {
    const base = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
    if (!base || !base.startsWith('https://')) throw new Error('Для webhook нужен HTTPS-адрес PUBLIC_URL или RENDER_EXTERNAL_URL.');
    await telegram('setWebhook', { url: `${base.replace(/\/$/, '')}/telegram`, secret_token: process.env.WEBHOOK_SECRET, max_connections: 1, allowed_updates: ['message', 'callback_query'] });
  }
  ready = true;
  console.log(`Бот @${me.username} запущен (${deliveryMode}). Время: ${clock(new Date())} МСК.`);
} catch (error) { console.error(error.message); process.exit(1); }
let stopping = false;
function stop() { stopping = true; ready = false; if (webhookServer) webhookServer.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
while (deliveryMode === 'polling' && !stopping) {
  try {
    const updates = await telegram('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35000);
    for (const update of updates) {
      try { await handle(update); }
      catch { console.error('Не удалось обработать сообщение. Пользователь может повторить запрос.'); }
      offset = update.update_id + 1;
      writeFileSync('.poll-offset', String(offset));
    }
  } catch (error) {
    console.error(error.message);
    if ([401, 409].includes(error.code)) { process.exitCode = 1; break; }
    await new Promise(resolve => setTimeout(resolve, Math.min(error.retryAfter || 5, 60) * 1000));
  }
}

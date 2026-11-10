import { readFileSync } from 'node:fs';

export const schedules = JSON.parse(readFileSync(new URL('./schedules.json', import.meta.url), 'utf8'));
const MIN = 60000;
export function moscowDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function clock(d) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(d);
}
export function stamp(d, base) {
  return `${moscowDate(d) === moscowDate(base) ? '' : moscowDate(d) + ' '}${clock(d)}`;
}
export function at(date, time) { return new Date(`${date}T${time}:00+03:00`); }
export function add(d, minutes) { return new Date(d.getTime() + minutes * MIN); }
export function parseWhen(text, now = new Date()) {
  const match = text.trim().match(/^(?:(завтра|\d{4}-\d{2}-\d{2})\s+)?([01]?\d|2[0-3]):([0-5]\d)$/i);
  if (!match) throw new Error('Введи время 14:30, «завтра 08:00» или дату и время: 2026-11-12 09:00. Всё по Москве.');
  const day = match[1]?.toLowerCase();
  const date = day === 'завтра' ? moscowDate(add(now, 1440)) : day || moscowDate(now);
  const result = at(date, `${match[2].padStart(2, '0')}:${match[3]}`);
  if (!Number.isFinite(+result) || moscowDate(result) !== date) throw new Error('Такой даты не существует.');
  if (result < now) throw new Error('Это время уже прошло. Для следующего дня напиши «завтра 08:00».');
  if (result > add(now, 30 * 1440)) throw new Error('Можно выбрать поездку в пределах 30 дней.');
  return result;
}
export function departures(key, ready) {
  const out = [];
  for (let day = 0; day <= 1; day++) {
    const date = moscowDate(add(ready, day * 1440));
    for (const time of schedules[key].split(' ')) {
      const departure = at(date, time);
      if (departure >= ready && departure <= add(ready, 1440)) out.push(departure);
    }
  }
  return out.sort((a, b) => a - b);
}
export function plan(ready, trains, config, direction = 'out') {
  if (direction === 'back') {
    const direct = departures('odintsovo_nazaryevo', ready).map(departure => ({
      kind: 'direct', departure, arrival: add(departure, config.busOdintsovo)
    }));
    const via = [];
    for (const train of trains.filter(t => t.departure >= ready && t.departure <= add(ready, 1440))) {
      const busDeparture = departures('zhavoronki_nazaryevo', add(train.arrival, config.returnTransfer ?? 3))[0];
      if (busDeparture && busDeparture <= add(ready, 1440)) via.push({ kind: 'via', departure: train.departure, train, busDeparture, arrival: add(busDeparture, config.busZhavoronki) });
    }
    const trainOptions = [...via].sort((a, b) => a.departure - b.departure || a.train.arrival - b.train.arrival)
      .filter((r, i, all) => i === 0 || +r.departure !== +all[i - 1].departure || +r.train.arrival !== +all[i - 1].train.arrival).slice(0, 2);
    via.sort((a, b) => a.arrival - b.arrival || b.departure - a.departure);
    return { direct, via, direction, trainOptions };
  }
  const direct = departures('nazaryevo_odintsovo', ready).map(departure => ({
    kind: 'direct', departure, arrival: add(departure, config.busOdintsovo)
  }));
  const via = [];
  for (const departure of departures('nazaryevo_zhavoronki', ready)) {
    const busArrival = add(departure, config.busZhavoronki);
    const platformReady = add(busArrival, config.transfer);
    // Check every train: a later express can arrive before an earlier train.
    const options = trains.filter(t => t.departure >= platformReady).sort((a, b) => a.arrival - b.arrival || a.departure - b.departure);
    if (options[0]) via.push({ kind: 'via', departure, busArrival, arrival: options[0].arrival, train: options[0] });
  }
  direct.sort((a, b) => a.arrival - b.arrival);
  via.sort((a, b) => a.arrival - b.arrival || a.departure - b.departure);
  const bestBus = via[0];
  const trainOptions = bestBus ? trains.filter(t => t.departure >= add(bestBus.busArrival, config.transfer))
    .sort((a, b) => a.departure - b.departure || a.arrival - b.arrival)
    .filter((t, i, all) => i === 0 || +t.departure !== +all[i - 1].departure || +t.arrival !== +all[i - 1].arrival)
    .slice(0, 2).map(train => ({ ...bestBus, train, arrival: train.arrival })) : [];
  return { direct, via, direction, trainOptions };
}
export function render(when, config, result, trainError, fetchedAt) {
  const ready = add(when, config.walk);
  const bestDirect = result.direct[0], bestVia = result.via[0];
  const back = result.direction === 'back';
  config = { ...config, transfer: back ? config.returnTransfer ?? 3 : config.transfer };
  const lines = [back ? 'Одинцово → Назарьево' : 'Назарьево → Одинцово', `🕒 Поездка: ${moscowDate(when)} ${clock(when)} МСК`, `Готовность к отправлению: ${stamp(ready, when)}`];
  if (!trainError && bestDirect && bestVia) {
    const winner = bestDirect.arrival <= bestVia.arrival ? bestDirect : bestVia;
    const diff = Math.round(Math.abs(bestDirect.arrival - bestVia.arrival) / MIN);
    lines.push(`\n🏁 По расчёту ${winner.kind === 'direct' ? 'быстрее прямой автобус' : 'быстрее через Жаворонки'}${diff ? ` на ${diff} мин` : ' (прибытие одинаковое)'}.`);
  }
  if (bestDirect) lines.push(`\n🚌 Прямой №81\n${back ? 'Одинцово' : 'Назарьево'} ${stamp(bestDirect.departure, when)} → ${back ? 'Назарьево' : 'Одинцово'} ≈${stamp(bestDirect.arrival, when)}`);
  if (bestVia) lines.push(back
    ? `\n🚆 + 🚌 Через Жаворонки\nЭлектричка: Одинцово ${stamp(bestVia.departure, when)} → Жаворонки ${stamp(bestVia.train.arrival, when)}\n№81: ${stamp(bestVia.busDeparture, when)} → Назарьево ≈${stamp(bestVia.arrival, when)}`
    : `\n🚌 + 🚆 Через Жаворонки\n№81: Назарьево ${stamp(bestVia.departure, when)} → Жаворонки ≈${stamp(bestVia.busArrival, when)}\nЭлектричка: ${stamp(bestVia.train.departure, when)} → Одинцово ${stamp(bestVia.arrival, when)}\n${bestVia.train.title || 'Электричка'}`);
  if (result.trainOptions?.length) {
    lines.push(back ? '\nБлижайшая и следующая электрички из Одинцова:' : `\nДве электрички после автобуса ${stamp(bestVia.departure, when)}:`);
    result.trainOptions.forEach((r, i) => lines.push(`${i ? 'Следующая' : 'Ближайшая'}: ${stamp(r.train.departure, when)} → ${stamp(r.train.arrival, when)}${back ? `; №81 ${stamp(r.busDeparture, when)} → Назарьево ≈${stamp(r.arrival, when)}` : ' · Одинцово'}`));
    if (result.trainOptions.length === 1) lines.push('Следующая подходящая электричка не найдена.');
  }
  if (trainError) lines.push(`\n⚠️ ${trainError}\nСравнение маршрутов недоступно. Ниже — только расписание автобусов.`);
  else if (!bestVia) lines.push('\nПодходящая пересадка через Жаворонки в загруженном расписании не найдена.');
  lines.push(back
    ? `\nБлижайшие №81 в Назарьево:\nИз Одинцова: ${departures('odintsovo_nazaryevo', ready).slice(0, 3).map(d => stamp(d, when)).join(', ')}\nИз Жаворонков: ${departures('zhavoronki_nazaryevo', ready).slice(0, 3).map(d => stamp(d, when)).join(', ')}`
    : `\nБлижайшие автобусы из Назарьева:\nВ Одинцово: ${departures('nazaryevo_odintsovo', ready).slice(0, 3).map(d => stamp(d, when)).join(', ')}\nВ Жаворонки: ${departures('nazaryevo_zhavoronki', ready).slice(0, 3).map(d => stamp(d, when)).join(', ')}`);
  lines.push(`\nАвтобус: ≈${config.busZhavoronki} мин до Жаворонков / ≈${config.busOdintsovo} мин до Одинцова, включая остановки. Пересадка: ${config.transfer} мин. Пробки и фактические задержки не учтены. Горизонт отправления автобусов: 24 часа.`);
  if (fetchedAt) lines.push(`\nРасписание электричек получено ${stamp(fetchedAt, when)} МСК. Данные предоставлены сервисом Яндекс.Расписания: https://rasp.yandex.ru/`);
  return lines.join('\n');
}

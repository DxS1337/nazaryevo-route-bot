import sharp from 'sharp';
import { add, moscowDate, stamp } from './planner.mjs';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function cardSvg(when, config, result, trainError, fetchedAt) {
  const back = result.direction === 'back';
  config = { ...config, transfer: back ? config.returnTransfer ?? 3 : config.transfer };
  const d = result.direct[0], v = result.via[0];
  const compared = !trainError && d && v;
  const winner = compared ? (d.arrival <= v.arrival ? 'direct' : 'via') : null;
  const diff = compared ? Math.round(Math.abs(d.arrival - v.arrival) / 60000) : 0;
  const fastest = winner === 'direct' ? d : v;
  const t = (x, y, text, size = 25, color = '#eaf0f8', weight = 400) => `<text x="${x - 20}" y="${y}" font-size="${size * 1.15}" fill="${color}" font-weight="${weight}">${esc(text)}</text>`;
  const box = (y, h, fill, stroke = '#29364a') => `<rect x="22" y="${y}" width="1156" height="${h}" rx="24" fill="${fill}" stroke="${stroke}"/>`;
  const segment = (y, label, route, kind) => {
    const selected = winner === kind;
    let content = box(y, 215, selected ? '#132e2a' : '#172132', selected ? '#55dfb1' : '#29364a');
    content += t(66, y + 40, label, 27, selected ? '#69e8bc' : '#afc0d7', 600);
    if (!route) return content + t(66, y + 98, kind === 'via' ? 'Нет подтверждённой пересадки' : 'Нет рейса в ближайшие 24 часа', 26);
    const times = `${stamp(route.departure, when)}  →  ≈${stamp(route.arrival, when)}`;
    content += t(66, y + 103, times, times.length > 32 ? 32 : 54, '#ffffff', 700);
    if (kind === 'direct') {
      content += t(66, y + 142, back ? 'Станция Одинцово → Назарьево' : 'Назарьево → станция Одинцово', 25);
      content += t(66, y + 182, `Автобус №81 · в пути ≈${config.busOdintsovo} мин`, 23, '#9cacc1');
    } else if (back) {
      content += t(66, y + 142, `Электричка до Жаворонков: ${stamp(route.departure, when)} → ${stamp(route.train.arrival, when)}`, 22);
      content += t(66, y + 182, `№81: ${stamp(route.busDeparture, when)} → ≈${stamp(route.arrival, when)} · Назарьево`, 24, '#afc0d7');
    } else {
      content += t(66, y + 142, `№81 до Жаворонков: ${stamp(route.departure, when)} → ≈${stamp(route.busArrival, when)}`, 24);
      content += t(66, y + 182, `Электричка: ${stamp(route.train.departure, when)} → ${stamp(route.arrival, when)} · Одинцово`, 24, '#afc0d7');
    }
    return content;
  };
  let body = t(44, 58, 'НАЗАРЬЕВО / МАРШРУТ', 20, '#91a3bd', 600)
    + t(44, 112, back ? 'Из Одинцова в Назарьево' : 'До станции Одинцово', 40, '#ffffff', 700)
    + t(44, 153, `${moscowDate(when)} · ${stamp(when, when)} МСК · на остановке ${stamp(add(when, config.walk), when)}`, 23, '#afc0d7');
  body += box(183, 160, '#153c33', '#285b4d');
  body += t(66, 224, winner ? (diff ? 'БЫСТРЕЕ ПО РАСЧЁТУ' : 'ОДИНАКОВОЕ ВРЕМЯ ПРИБЫТИЯ') : 'РАСПИСАНИЕ АВТОБУСОВ', 20, '#69e8bc', 600);
  body += t(66, 273, winner ? (winner === 'direct' ? 'Прямой автобус' : 'Через Жаворонки') : 'Сравнение недоступно', 35, '#ffffff', 700);
  body += t(66, 314, winner ? `Прибытие ≈${stamp(fastest.arrival, when)}${diff ? ` · выигрыш ${diff} мин` : ' · прямой без пересадки'}` : (trainError ? 'Электрички временно недоступны' : 'Подходящая электричка не найдена'), 24, '#b7d7ce');
  body += segment(365, '01 / ПРЯМОЙ АВТОБУС', d, 'direct');
  body += segment(600, back ? '02 / ЭЛЕКТРИЧКА + АВТОБУС' : '02 / АВТОБУС + ЭЛЕКТРИЧКА', v, 'via');
  const options = result.trainOptions || [];
  const extra = options.length ? 250 : 0;
  if (options.length) {
    body += box(835, 235, '#172132');
    body += t(66, 875, back ? 'ЭЛЕКТРИЧКИ ИЗ ОДИНЦОВА' : `ЭЛЕКТРИЧКИ ПОСЛЕ АВТОБУСА ${stamp(v.departure, when)}`, 24, '#69e8bc', 600);
    options.forEach((r, i) => {
      const y = 920 + i * 82;
      body += t(66, y, `${i ? 'Следующая' : 'Ближайшая'}: ${stamp(r.train.departure, when)} → ${stamp(r.train.arrival, when)}`, 27, '#ffffff', 600);
      body += t(66, y + 32, back ? `Жаворонки · №81 ${stamp(r.busDeparture, when)} → Назарьево ≈${stamp(r.arrival, when)}` : 'Жаворонки → Одинцово', 22, '#afc0d7');
    });
    if (options.length === 1) body += t(66, 1018, 'Следующая подходящая электричка не найдена', 24, '#91a3bd');
  }
  body += t(44, 858 + extra, `Пересадка ${config.transfer} мин · Автобус ≈${config.busZhavoronki} / ${config.busOdintsovo} мин · Пробки не учтены`, 22, '#9cacc1');
  body += t(44, 900 + extra, `Яндекс.Расписания · rasp.yandex.ru${fetchedAt ? ` · обновлено ${stamp(fetchedAt, when)} МСК` : ''}`, 21, '#7488a4');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${930 + extra}"><rect width="1200" height="${930 + extra}" fill="#0c1422"/><g font-family="Segoe UI,DejaVu Sans,Arial,sans-serif">${body}</g></svg>`;
}
export async function renderCard(...args) { return sharp(Buffer.from(cardSvg(...args))).png().toBuffer(); }

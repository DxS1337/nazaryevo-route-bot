import sharp from 'sharp';
import { schedules, clock, moscowDate, at } from './planner.mjs';
export function departureWait(time, now) {
  const seconds = (at(moscowDate(now), time) - now) / 1000;
  if (seconds < 0) return { label: 'ушёл', passed: true };
  if (!seconds) return { label: 'сейчас', passed: false };
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return { label: hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${minutes} мин`, passed: false };
}
export const scheduleNames = {
  nazaryevo_zhavoronki: ['Назарьево', 'Жаворонки'],
  nazaryevo_odintsovo: ['Назарьево', 'Одинцово'],
  zhavoronki_nazaryevo: ['Жаворонки', 'Назарьево'],
  odintsovo_nazaryevo: ['Одинцово', 'Назарьево']
};
export function scheduleSvg(key, now = new Date()) {
  const names = scheduleNames[key];
  if (!names) throw new Error('Неизвестное направление');
  const times = schedules[key].split(' ');
  const rows = Math.ceil(times.length / 3);
  const height = 340 + rows * 66;
  const t = (x,y,value,size=28,color='#eaf0f8',weight=400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${value}</text>`;
  const waits = times.map(time => departureWait(time, now));
  const nextIndex = waits.findIndex(w => !w.passed);
  let body = `<rect x="28" y="28" width="130" height="54" rx="16" fill="#153c33"/>`
    + t(48,66,'№ 81',36,'#69e8bc',700) + t(180,64,'ЕЖЕДНЕВНО · МСК',25,'#91a3bd',600)
    + t(32,140,`${names[0]} → ${names[1]}`,48,'#ffffff',700)
    + t(32,187,`Отправления · сейчас ${clock(now)} МСК · ${moscowDate(now)}`,29,'#afc0d7')
    + t(32,238,`Первый ${times[0]}     /     Последний ${times.at(-1)}     /     ${times.length} рейсов`,27,'#afc0d7');
  for (let i=0;i<times.length;i++) {
    const col=Math.floor(i/rows), row=i%rows;
    const x=28+col*392,y=266+row*66;
    const next=i===nextIndex, wait=waits[i];
    body+=`<rect x="${x}" y="${y}" width="360" height="56" rx="14" fill="${next?'#153c33':'#172132'}" stroke="${next?'#55dfb1':'#29364a'}"/>`;
    body+=t(x+22,y+40,times[i],42,wait.passed?'#7488a4':next?'#69e8bc':'#ffffff',700);
    if (!wait.passed && wait.label !== 'сейчас') {
      body+=t(x+193,y+21,next?'ближайший · через':'через',15,next?'#69e8bc':'#91a3bd');
      body+=t(x+193,y+46,wait.label,23,next?'#69e8bc':'#afc0d7',600);
    } else body+=t(x+193,y+36,wait.label,23,wait.passed?'#7488a4':'#69e8bc',600);
  }
  body+=t(32,height-27,'По колонкам сверху вниз · Время ожидания рассчитано при создании карточки',23,'#91a3bd');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="#0c1422"/><g font-family="Segoe UI,DejaVu Sans,Arial,sans-serif">${body}</g></svg>`;
}
export async function renderSchedule(key, now) { return sharp(Buffer.from(scheduleSvg(key, now))).png().toBuffer(); }

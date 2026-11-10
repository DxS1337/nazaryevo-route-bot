const BASE = 'https://api.rasp.yandex-net.ru/v3.0/search/';
export class TrainService {
  constructor(key, fetchFn = fetch) { this.key = key; this.fetch = fetchFn; this.cache = new Map(); }
  async forDate(date, direction = 'out') {
    if (!this.key) throw new Error('Не подключён ключ Яндекс Расписаний.');
    const cacheKey = `${direction}:${date}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt.getTime() < 120000) return cached;
    const trains = [];
    for (let offset = 0; ; ) {
      const url = new URL(BASE);
      url.search = new URLSearchParams({ from: direction === 'back' ? 's9600721' : 's9601212', to: direction === 'back' ? 's9601212' : 's9600721', date,
        transport_types: 'suburban', result_timezone: 'Europe/Moscow', limit: '100', offset: String(offset), transfers: 'false', format: 'json' });
      let response;
      try { response = await this.fetch(url, { headers: { Authorization: this.key }, signal: AbortSignal.timeout(15000) }); }
      catch { throw new Error('Яндекс Расписания временно недоступны. Попробуй ещё раз.'); }
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Яндекс отклонил API-ключ. Проверь настройки.' : `Ошибка Яндекс Расписаний (HTTP ${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data.segments) || !Number.isInteger(data.pagination?.total)) throw new Error('Неожиданный ответ Яндекс Расписаний.');
      for (const segment of data.segments) {
        if (segment.has_transfers || segment.cancelled || segment.thread?.cancelled) continue;
        const departure = new Date(segment.departure), arrival = new Date(segment.arrival);
        if (!Number.isFinite(+departure) || !Number.isFinite(+arrival) || arrival <= departure) continue;
        trains.push({ departure, arrival, title: segment.thread?.title || 'Электричка' });
      }
      offset += data.segments.length;
      if (offset >= data.pagination.total) break;
      if (!data.segments.length || offset > 10000) throw new Error('Не удалось загрузить полное расписание электричек.');
    }
    const value = { trains, fetchedAt: new Date() };
    // Bound cache across different user-selected dates.
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(cacheKey, value);
    return value;
  }
}

// Сопоставление доменов конфигурации с текущим hostname.
// Чистые функции; не обращаются к состоянию расширения.

// Нормализует введённый пользователем домен для сравнения: убирает протокол,
// www., путь/query после первого "/", приводит к нижнему регистру.
function normalizeDomainForMatch(raw) {
    let d = String(raw || '').trim().toLowerCase();
    d = d.replace(/^[a-z]+:\/\//, '');   // http:// https://
    d = d.replace(/^www\./, '');
    d = d.split('/')[0];                 // отрезаем путь, если случайно вставили ссылку целиком
    d = d.split('?')[0].split('#')[0];
    return d;
}

// Домен из настроек считается совпавшим, если это ТОЧНО тот же хост или его
// поддомен (a.ggsel.net матчит ggsel.net) — но НЕ произвольная подстрока.
// Раньше использовался hostname.includes(d), из-за чего один сайт в базе мог
// случайно "перехватить" другой, если его домен оказывался подстрокой (или
// наоборот) — сайт находился, но не тот, что реально открыт.
function hostnameMatchesDomain(hostname, rawDomain) {
    const h = normalizeDomainForMatch(hostname);
    const d = normalizeDomainForMatch(rawDomain);
    if (!h || !d) return false;
    return h === d || h.endsWith('.' + d);
}

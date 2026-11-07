import { type BusinessCalendar, type ProjectConfig, WEEKDAYS } from "./config.js";

type LocalDate = { year: number; month: number; day: number };

const HOUR_MS = 60 * 60 * 1000;

/** Partes da data e hora de `ms` no fuso `timeZone`. */
function partsIn(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Diferença do fuso para o UTC no instante `ms`, em ms (ex.: -3 h em America/Sao_Paulo). */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(ms / 60_000) * 60_000;
}

/** Instante (ms) em que o relógio de parede do fuso marca `hhmm` na data `date`. */
function wallClockToMs(date: LocalDate, hhmm: string, timeZone: string): number {
  const [hour, minute] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = guess - offsetAt(guess, timeZone);
  // Perto de uma mudança de horário de verão, o deslocamento no instante achado pode ser outro.
  return guess - offsetAt(first, timeZone);
}

const nextDay = ({ year, month, day }: LocalDate): LocalDate => {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
};

const isoDate = ({ year, month, day }: LocalDate) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Feriados legais BR/SP/Mogi (não inclui pontos facultativos).
 * Fontes: leis federais 662/1949, 6.802/1980 e 14.759/2023;
 * lei SP 9.497/1997; http://www2.cmmc.com.br/feriados.
 */
function isMogiHoliday(date: LocalDate): boolean {
  const fixed = [
    "01-01",
    "04-21",
    "05-01",
    "07-09",
    "07-26",
    "09-01",
    "09-07",
    "10-12",
    "11-02",
    "11-15",
    "11-20",
    "12-25",
  ];
  if (fixed.includes(isoDate(date).slice(5))) return true;
  // Computus gregoriano (Meeus): Paixão de Cristo = Páscoa - 2, Corpus Christi = Páscoa + 60.
  const y = date.year;
  const a = y % 19,
    b = Math.floor(y / 100),
    c = y % 100;
  const d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(y, month - 1, day);
  const current = Date.UTC(y, date.month - 1, date.day);
  return current === easter - 2 * 86_400_000 || current === easter + 60 * 86_400_000;
}

/** Próximo início permitido: projetos pessoais ficam livres; empresa usa também feriados BR/SP/Mogi. */
export function nextProjectActivity(config: Pick<ProjectConfig, "activity" | "calendar">, now: number): number {
  return config.activity === "business-hours"
    ? addBusinessHours({ ...config.calendar, legalHolidays: true }, now, 0)
    : now;
}

function isWorkday(calendar: BusinessCalendar, date: LocalDate): boolean {
  const weekday = WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
  return (
    weekday !== undefined &&
    calendar.workdays.includes(weekday) &&
    !calendar.holidays.includes(isoDate(date)) &&
    !(calendar.legalHolidays && isMogiHoliday(date))
  );
}

/** Horas de um dia útil do calendário (ex.: 09:00–18:00 → 9). */
export function workdayHours(calendar: BusinessCalendar): number {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return h * 60 + m;
  };
  return (minutes(calendar.end) - minutes(calendar.start)) / 60;
}

/**
 * O instante em que se completam `hours` horas úteis a partir de `from`, contando só o expediente do calendário (dias
 * úteis, fora dos feriados, entre `start` e `end` no fuso). Um prazo que se completa exatamente no fim do expediente
 * cai no início do próximo, para lembretes e avisos saírem sempre dentro do horário.
 */
export function addBusinessHours(calendar: BusinessCalendar, from: number, hours: number): number {
  let remaining = hours * HOUR_MS;
  const p = partsIn(from, calendar.timezone);
  let date: LocalDate = { year: p.year, month: p.month, day: p.day };
  // Um calendário válido tem expediente toda semana; dez anos é folga para feriados em excesso.
  for (let i = 0; i < 3660; i++, date = nextDay(date)) {
    if (!isWorkday(calendar, date)) continue;
    const open = wallClockToMs(date, calendar.start, calendar.timezone);
    const close = wallClockToMs(date, calendar.end, calendar.timezone);
    const begin = Math.max(open, from);
    if (begin >= close) continue;
    if (close - begin > remaining) return begin + remaining;
    remaining -= close - begin;
  }
  throw new Error("o calendário do projeto não tem expediente nos próximos dez anos");
}

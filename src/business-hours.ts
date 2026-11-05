import { type BusinessCalendar, WEEKDAYS } from "./config.js";

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

function isWorkday(calendar: BusinessCalendar, date: LocalDate): boolean {
  const weekday = WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
  return weekday !== undefined && calendar.workdays.includes(weekday) && !calendar.holidays.includes(isoDate(date));
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

import { z } from "zod";

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const HourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM, de 00:00 a 23:59");

/** Dias da semana, na ordem de `Date.getUTCDay()`. */
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Expediente do projeto: os prazos das perguntas (lembrete, aviso) contam só horas dentro dele. */
export const BusinessCalendar = z
  .object({
    /** Inclui feriados legais BR/SP/Mogi; obrigatório implicitamente para activity: business-hours. */
    legalHolidays: z.boolean().optional(),
    timezone: z.string().refine(isTimeZone, { message: "fuso horário IANA desconhecido" }).default("UTC"),
    workdays: z.array(z.enum(WEEKDAYS)).min(1).default(["mon", "tue", "wed", "thu", "fri"]),
    /** Início e fim do expediente, no fuso do calendário. */
    start: HourMinute.default("09:00"),
    end: HourMinute.default("18:00"),
    /** Datas sem expediente (feriados), como AAAA-MM-DD no fuso do calendário. */
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD")).default([]),
  })
  .refine((c) => c.start < c.end, { message: "start precisa ser antes de end", path: ["end"] });
export type BusinessCalendar = z.infer<typeof BusinessCalendar>;

import type { ProjectConfig } from "../../../config.js";

/**
 * Calendário efetivo do projeto. A execução e os SLAs usam o mesmo calendário: no modo de horário útil, os feriados
 * legais entram sempre. Nos demais modos, a configuração vale como está.
 */
export function comCalendarioEfetivo(config: ProjectConfig): ProjectConfig {
  if (config.activity !== "business-hours") return config;
  return { ...config, calendar: { ...config.calendar, legalHolidays: true } };
}

export interface OpcoesPrazoUtil {
  minutosUteis: number;
  relogio: () => Date;
}

const DIA = 86_400_000;
const MINUTO = 60_000;
const formatoLocal = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Representação auxiliar do calendário local em UTC: não é um instante real.
function calendarioLocal(instante: number): number {
  const partes = formatoLocal.formatToParts(new Date(instante));
  const valor = (tipo: Intl.DateTimeFormatPartTypes): number =>
    Number(partes.find((parte) => parte.type === tipo)?.value);
  return Date.UTC(valor("year"), valor("month") - 1, valor("day"), valor("hour"), valor("minute"), valor("second"));
}

function instanteLocal(dia: number, hora: number): number {
  const alvo = dia + hora * 60 * MINUTO;
  let instante = alvo;
  // Resolve o deslocamento pelo fuso IANA, sem depender do TZ do processo.
  for (let i = 0; i < 4; i++) {
    const ajuste = alvo - calendarioLocal(instante);
    if (ajuste === 0) return instante;
    instante += ajuste;
  }
  return instante;
}

function pascoa(ano: number): number {
  // Computus gregoriano.
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const base = h + l - 7 * m + 114;
  return Date.UTC(ano, Math.floor(base / 31) - 1, (base % 31) + 1);
}

function feriados(ano: number): Set<number> {
  const datas = [
    [1, 1],
    [4, 21],
    [5, 1],
    [9, 7],
    [10, 12],
    [11, 2],
    [11, 15],
    [11, 20],
    [12, 25], // nacionais (20/11 também observado localmente)
    [7, 9], // estadual de São Paulo
    [7, 26],
    [9, 1], // Sant'Ana e aniversário de Mogi das Cruzes
  ];
  const resultado = new Set(datas.map(([mes, dia]) => Date.UTC(ano, mes - 1, dia)));
  const domingoPascoa = pascoa(ano);
  resultado.add(domingoPascoa - 2 * DIA); // Sexta-feira da Paixão
  resultado.add(domingoPascoa + 60 * DIA); // Corpus Christi
  return resultado;
}

/** Soma tempo útil no calendário de Mogi das Cruzes/SP, das 09:00 às 18:00. */
export function calcularPrazoUtil({ minutosUteis, relogio }: OpcoesPrazoUtil): Date {
  if (!Number.isFinite(minutosUteis) || minutosUteis < 0) {
    throw new RangeError("minutosUteis deve ser finito e não negativo");
  }
  const inicio = relogio().getTime();
  if (!Number.isFinite(inicio)) throw new RangeError("Relógio retornou uma data inválida");
  let restante = minutosUteis * MINUTO;
  if (!Number.isFinite(restante)) throw new RangeError("Prazo fora do intervalo suportado");
  if (restante === 0) return new Date(inicio);

  const local = new Date(calendarioLocal(inicio));
  let dia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let anoCalendario = local.getUTCFullYear();
  let diasFeriados = feriados(anoCalendario);

  while (Number.isFinite(dia)) {
    const data = new Date(dia);
    const ano = data.getUTCFullYear();
    if (ano !== anoCalendario) {
      anoCalendario = ano;
      diasFeriados = feriados(ano);
    }
    const semana = data.getUTCDay();
    if (semana !== 0 && semana !== 6 && !diasFeriados.has(dia)) {
      const abertura = instanteLocal(dia, 9);
      const fechamento = instanteLocal(dia, 18);
      const cursor = Math.max(inicio, abertura);
      const disponivel = Math.max(0, fechamento - cursor);
      if (restante <= disponivel) return new Date(cursor + restante);
      restante -= disponivel;
    }
    dia = new Date(dia + DIA).getTime();
  }
  throw new RangeError("Prazo fora do intervalo suportado por Date");
}

// Entry point público do pacote de exemplo. Modelo para copiar ou apagar.
import { saudacao } from "./lib/impl.js";

export function cumprimentar(nome: string): string {
  return saudacao(nome.trim());
}

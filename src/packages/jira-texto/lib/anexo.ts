// Regra de anexo: um arquivo é texto (lido e enviado ao modelo) ou binário (fica de fora).

/** Verifica se um anexo é de texto e não binário (imagem, pdf, zip, etc). */
export function isTextAttachment(filename: string, mimeType?: string): boolean {
  const binaryExtRegex = /\.(png|jpe?g|gif|webp|bmp|pdf|zip|tar|gz|tgz|7z|rar|bin|exe|jar|war|ear|iso|dmg)$/i;
  if (binaryExtRegex.test(filename)) return false;

  if (mimeType) {
    if (mimeType.startsWith("text/")) return true;
    if (
      mimeType === "application/json" ||
      mimeType === "application/xml" ||
      mimeType === "application/javascript" ||
      mimeType === "application/typescript" ||
      mimeType === "application/x-yaml" ||
      mimeType === "application/yaml"
    ) {
      return true;
    }
  }

  const textExtRegex = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|log|diff|patch|[jt]sx?|py|sh|sql)$/i;
  return textExtRegex.test(filename);
}

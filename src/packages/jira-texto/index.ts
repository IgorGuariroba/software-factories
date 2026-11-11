// Entry point público das regras de texto da Fonte Jira: ADF (ida e volta), o que é anexo de texto, e o id de comentário.
export { adfToText, textToAdf } from "./lib/adf.js";
export { isTextAttachment } from "./lib/anexo.js";
export { findCommentId } from "./lib/comentario.js";

/** Contrato único do destino público, usado pelo ambiente, API e OpenAPI. */
export const RETRO_REPO_PATTERN = "^\\w[\\w.-]*/\\w[\\w.-]*$";
const repository = new RegExp(RETRO_REPO_PATTERN);
export const isRetroRepository = (value: string): boolean => value.length <= 200 && repository.test(value);

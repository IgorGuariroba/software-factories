import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Usa as credenciais compartilhadas do pi, inclusive OAuth de assinaturas com refresh sincronizado. */
export async function createFactoryModels(opts: { authPath?: string } = {}): Promise<ModelRuntime> {
  return ModelRuntime.create({ authPath: opts.authPath, modelsPath: null, allowModelNetwork: false });
}

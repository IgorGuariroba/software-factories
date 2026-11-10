/** Campo de configuração de uma integração, como a interface o exibe (fatia 04). */
export interface CampoEsquema {
  campo: string;
  rotulo: string;
  tipo: "texto" | "url" | "email" | "lista" | "segredo";
  obrigatorio: boolean;
}

/** Schema de configuração de um tipo de Fonte. Cada adaptador declara o seu; a interface gera o formulário a partir dele. */
export interface EsquemaFonte {
  tipo: string;
  rotulo: string;
  campos: CampoEsquema[];
}

# O reviewer é de outra família de modelo e sua classe nunca é rebaixada

> **Substituída em parte pela ADR-0028 (aceita, ainda não implementada):** a regra de família diferente continua valendo: sem reviewer de outra família, a Tarefa bloqueia. A regra de classe e de espera por cota não faz parte do desenho atual e é retirada.

Para que o review não reproduza os pontos cegos do implementador, o modelo reviewer é sempre de uma família diferente da do implementer. Quando falta cota, outros papéis podem trocar de provedor dentro da mesma classe, mas o reviewer nunca desce de classe: a tarefa espera o reset da cota em vez de aceitar um review mais fraco.

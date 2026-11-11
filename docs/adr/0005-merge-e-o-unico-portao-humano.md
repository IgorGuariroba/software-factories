# O merge é o único portão humano; a fábrica move o card só até "Aguardando Teste"

> **Substituída pela ADR-0024 (aceita, ainda não implementada):** além do merge, o código já tem prévias de pergunta, SPEC, baixa de triagem e publicação de retrô, então o merge não é mais o único portão. A ADR-0024 reúne todas numa política de ações. Continua valendo daqui: o merge é sempre humano, e a fábrica move o card só até `Aguardando Teste`.

A fábrica faz sozinha o grill, a SPEC, a implementação, o review, o build e o teste próprio. O único ponto em que ela obrigatoriamente espera um humano é o merge do MR. Ela move o card até `Aguardando Teste`, e só depois que o teste próprio passa; daí em diante quem move o card são os humanos. Um card que volta de status ou recebe comentário de retrabalho volta para `Em Andamento` e refaz o ciclo.

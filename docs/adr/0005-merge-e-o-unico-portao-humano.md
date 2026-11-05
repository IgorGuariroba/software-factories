# O merge é o único portão humano; a fábrica move o card só até "Aguardando Teste"

A fábrica faz sozinha o grill, a SPEC, a implementação, o review, o build e o teste próprio. O único ponto em que ela obrigatoriamente espera um humano é o merge do MR. Ela move o card até `Aguardando Teste`, e só depois que o teste próprio passa; daí em diante quem move o card são os humanos. Um card que volta de status ou recebe comentário de retrabalho volta para `Em Andamento` e refaz o ciclo.

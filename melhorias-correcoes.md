# Melhorias e Correcaoes

Este arquivo organiza, em uma sequencia logica, as melhorias e correcoes que devem ser aplicadas no aplicativo do smartwatch para reduzir lentidao, preservar o objetivo atual da aplicacao e diminuir risco de regressao.

## Direcao geral

Nao e recomendavel corrigir tudo de uma vez.

O melhor caminho e fazer por partes, porque:
- existem problemas de performance e de consistencia de estado ao mesmo tempo
- algumas mudancas afetam o ciclo de vida da page
- algumas mudancas afetam como o treino e persistido
- se tudo for alterado em um unico bloco, fica dificil identificar qual parte causou regressao

Por isso, a estrategia recomendada e:
- primeiro estabilizar o estado do treino
- depois reduzir rerender desnecessario
- depois otimizar o boot e resume
- por fim revisar acabamento visual e debug

## Objetivo principal

Preservar o comportamento funcional esperado:
- validar vinculo do smartwatch
- validar treino do dia
- ir para tela de exercicios quando existir sessao ativa
- ir para tela principal com `Iniciar treino` quando existir treino do dia sem sessao ativa e sem conclusao
- ir para tela principal com `Treino de hoje esta pago!` quando o treino do dia estiver concluido
- manter o progresso local da sessao enquanto ele ainda for necessario
- reduzir a lentidao da UI principalmente em interacoes

## Sequencia recomendada

## Etapa 1. Congelar e revisar o estado local do treino

Objetivo:
- garantir que as variaveis de sessao e progresso so sejam limpas no momento correto

Itens:
- revisar exatamente quais chaves devem sobreviver durante:
  - sessao ativa
  - descanso em andamento
  - descanso concluido
  - tela apagada e retorno
  - treino finalizado
- separar conceitualmente:
  - dados do treino do dia
  - dados da sessao ativa
  - dados de progresso local da execucao
  - dados de descanso
- confirmar quando cada um destes grupos pode ou nao ser limpo

Resultado esperado:
- o app nao volta para serie errada
- o app nao volta para exercicio errado
- o app nao perde o botao correto apos apagar/acender a tela

## Etapa 2. Corrigir a fonte de verdade de cada tela

Objetivo:
- definir claramente qual rota decide qual tela deve ser aberta

Regras que devem ser fixadas:
- `GET /watch/sessions/active/:date?userId=...`
  - se `active: true`, abrir tela de exercicios
  - se `active: false`, nao abrir tela de exercicios
- `GET /watch/today/:date?deviceCode=...`
  - decide se existe treino do dia
  - decide se o treino do dia esta concluido via `completedAt`

Itens:
- revisar a ordem de validacao no boot
- revisar a ordem de validacao no resume
- impedir sobrescrita indevida de estado local util
- impedir limpeza prematura do progresso local

Resultado esperado:
- o app nao mostra `Iniciar treino` quando o treino ja estiver concluido
- o app nao mostra `Treino de hoje esta pago!` com dado stale

## Etapa 3. Melhorar o debug para diagnostico real

Objetivo:
- transformar o debug em uma ferramenta util para entender estado atual e respostas da API

Itens:
- mostrar estado real atual do treino
- mostrar estado real atual da sessao
- mostrar ultimo retorno bruto de:
  - `getActiveSession`
  - `getToday`
- mostrar claramente:
  - sessionId
  - startedAt
  - completedAt
  - exerciseIndex
  - setsCount
  - serieCompleted
  - restRunning
  - restTargetAt
  - exercicio atual

Resultado esperado:
- conseguir diferenciar problema de frontend de problema de payload da API

## Etapa 4. Parar com rerender completo em interacoes simples

Objetivo:
- reduzir o maior custo de performance atual

Itens:
- remover o padrao de:
  - apagar todos os widgets
  - recriar todos os widgets
  - repetir isso varias vezes por clique
- revisar `handleButtonAction()`
- eliminar refresh duplo antes e depois da acao quando nao for necessario
- manter a tela montada e atualizar apenas:
  - texto do botao
  - cor do botao
  - texto auxiliar
  - linha da serie
  - tempo de descanso
  - tempo total efetivo

Resultado esperado:
- o clique em botoes como `Iniciar Descanso`, `Proxima Serie` e `Proximo Exercicio` fica perceptivelmente mais rapido

## Etapa 5. Tratar a tela de exercicios como tela viva

Objetivo:
- usar atualizacao incremental com `setProperty(...)`

Itens:
- montar a tela de exercicios uma vez
- atualizar os textos dinamicos sem recriar widgets
- separar claramente:
  - widgets estaticos
  - widgets dinamicos
- revisar quais widgets realmente precisam ser recriados quando o exercicio muda

Resultado esperado:
- menos custo por tick
- menos custo por interacao
- menos flicker visual

## Etapa 6. Reduzir o trabalho do ciclo de vida

Objetivo:
- deixar `onPause()` e `onResume()` menos agressivos

Itens:
- revisar se `onPause()` realmente precisa resetar tudo imediatamente
- revisar se `onResume()` precisa sempre chamar sincronizacao mais pesada
- quando possivel, no resume:
  - apenas recalcular descanso
  - apenas atualizar widgets relevantes
  - evitar rebuild completo

Resultado esperado:
- menos apagamento brusco
- menos travamento ao voltar para o app
- menos regressao de estado apos tela desligar

## Etapa 7. Revisar a estrategia de loader

Objetivo:
- manter feedback visual sem custo alto

Itens:
- evitar que o loader provoque rerender completo da tela
- transformar o loader em atualizacao de widget ja existente, quando possivel
- bloquear clique repetido sem forcar reconstrucao completa da UI

Resultado esperado:
- feedback visual continua existindo
- a interacao fica mais leve

## Etapa 8. Revisar a estrategia de leitura de localStorage

Objetivo:
- diminuir leitura repetitiva e desnecessaria

Itens:
- reduzir chamadas redundantes de `ls_get`
- evitar chamar `readTrainingState()` em excesso dentro do mesmo fluxo
- manter um snapshot local temporario quando fizer sentido

Resultado esperado:
- menor custo computacional por interacao
- menor custo em render e live update

## Etapa 9. Revisar a tela de QR e telas auxiliares

Objetivo:
- remover residuos de debug e custos nao essenciais em telas secundarias

Itens:
- revisar a tela de QR
- revisar tela de erro
- revisar tela principal
- verificar se existe widget ou fluxo desnecessario ainda ativo

Resultado esperado:
- comportamento mais consistente entre telas
- menos trabalho desnecessario

## Etapa 10. Validacao controlada por bloco

Objetivo:
- nao misturar mudancas sem saber qual melhorou ou piorou algo

Regras de execucao:
- aplicar uma etapa por vez
- validar manualmente antes da proxima
- registrar exatamente o que mudou em cada etapa

Checklist minimo por etapa:
- abrir app com treino concluido
- abrir app com treino disponivel sem sessao ativa
- abrir app com sessao ativa
- iniciar descanso e apagar tela
- voltar do descanso
- avancar serie
- avancar exercicio
- finalizar treino

## Ordem recomendada de execucao real

1. Etapa 1
2. Etapa 2
3. Etapa 3
4. Etapa 4
5. Etapa 5
6. Etapa 6
7. Etapa 7
8. Etapa 8
9. Etapa 9
10. Etapa 10 continuamente

## Recomendacao final

Sim, eu consigo conduzir essas correcoes.

A melhor abordagem nao e corrigir tudo de uma vez.

A melhor abordagem e fazer por partes, nesta ordem:
- primeiro corrigir consistencia de estado
- depois corrigir fonte de verdade do boot e resume
- depois atacar performance de renderizacao
- depois polir loaders, resume e telas auxiliares

Assim o risco de quebrar o fluxo principal do treino fica menor, e cada melhoria pode ser validada com clareza.

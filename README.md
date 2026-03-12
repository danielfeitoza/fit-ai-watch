# FIT.AI Watch

Aplicacao de smartwatch desenvolvida para integrar com a plataforma web **FIT.IA**.

O projeto foi criado com o objetivo de levar a experiencia do treino para o pulso do usuario, permitindo iniciar, acompanhar e finalizar o treinamento diretamente no relogio, com menos dependencia do celular durante a execucao dos exercicios.

## Sobre o projeto

Este app foi proposto dentro de um **bootcamp da FullStackClub** como uma extensao real de produto para a plataforma **FIT.IA**.

A ideia central foi transformar o smartwatch em um ponto de interacao util dentro da jornada de treino. Em vez de obrigar o usuario a consultar o celular ou a interface web a todo momento, o relogio passa a atuar como uma interface rapida, objetiva e adequada ao contexto de uso durante a atividade fisica.

Em termos praticos, o aplicativo permite:

- vincular o smartwatch ao usuario da plataforma
- consultar o treino do dia
- verificar se existe treino em andamento
- iniciar o treino pelo relogio
- acompanhar a execucao do treino
- avancar entre series e exercicios
- controlar descansos
- finalizar o treino diretamente no smartwatch

## Qual foi o objetivo ao criar essa aplicacao

O objetivo principal foi integrar a experiencia da plataforma **FIT.IA** com um dispositivo vestivel, trazendo mais praticidade para a rotina do usuario.

Mais do que apenas consumir uma API, a proposta foi resolver um problema real de uso:

- reduzir o atrito durante o treino
- evitar interrupcoes desnecessarias
- permitir que o usuario acompanhe a sessao sem depender do celular
- manter sincronizacao com a aplicacao web
- tornar o fluxo de treino mais natural dentro do contexto de um smartwatch

Esse projeto tambem serviu como exercicio de arquitetura e produto dentro do bootcamp, explorando integracao entre frontend embarcado, persistencia local e comunicacao com backend.

## Como a aplicacao funciona

O fluxo principal da aplicacao segue esta ideia:

1. O usuario abre o app no smartwatch.
2. O dispositivo valida se ja esta vinculado a um usuario do FIT.IA.
3. O app consulta a API para descobrir o estado do treino do dia.
4. Se existir sessao ativa, o usuario vai direto para a tela de exercicios.
5. Se existir treino do dia sem sessao ativa, o app permite iniciar o treino.
6. Se o treino do dia ja tiver sido concluido, o app informa isso na tela principal.
7. Durante a execucao, o usuario acompanha a progressao do treino diretamente no relogio.
8. Ao final, o treino pode ser encerrado pelo proprio smartwatch.

## Principais funcionalidades

- Vinculacao do smartwatch com a conta do usuario
- Integracao com a API da plataforma FIT.IA
- Consulta do treino do dia
- Deteccao de sessao ativa
- Inicio de treino pelo relogio
- Finalizacao de treino pelo relogio
- Persistencia local do estado necessario para retomada
- Fluxo de series, exercicios e descanso
- Notificacao em background para eventos do treino
- Tratamento de erros e feedback visual para o usuario

## Tecnologias utilizadas

O projeto foi construido com foco no ecossistema Zepp.

- **Zepp OS**
- **Zepp OS Device App API**
- **JavaScript**
- **@zeppos/zml**
- **App Side** para comunicacao entre o app do relogio e a camada de API
- **App Service** para comportamento em segundo plano no dispositivo
- **Local Storage do Zepp OS** para persistencia local
- **HTTP API** para sincronizacao com a plataforma web FIT.IA

## Estrutura principal

Os arquivos mais importantes do projeto sao:

- `app.json`
  Configuracao principal da aplicacao, permissoes, paginas e servicos.

- `app-side/index.js`
  Entrada do app-side, responsavel pela ponte entre o relogio e o backend.

- `app-side/watchApi.js`
  Camada que centraliza as chamadas da API utilizadas pelo smartwatch.

- `page/gt/home/index.page.js`
  Principal tela e fluxo da aplicacao no dispositivo.

- `page/gt/home/storage.js`
  Helpers e chaves de persistencia local.

- `page/gt/home/training-state.js`
  Regras de estado, progressao e retomada do treino.

- `service/timer_bg.js`
  Servico em background usado para notificacoes do app sem abrir a interface principal.

## Integracao com a aplicacao web FIT.IA

Esta aplicacao nao foi pensada como um produto isolado. Ela faz parte do ecossistema da **FIT.IA** e depende da API da plataforma para funcionar corretamente.

A integracao e utilizada para:

- validar o vinculo entre smartwatch e usuario
- consultar o treino do dia
- verificar se existe sessao ativa
- iniciar uma nova sessao de treino
- finalizar a sessao de treino
- sincronizar o estado do treinamento com a plataforma web

Na pratica, o smartwatch atua como uma extensao operacional da aplicacao web.

## Desafios tecnicos do projeto

Por ser um app para smartwatch, o projeto envolve restricoes e desafios especificos:

- interface pequena e objetiva
- necessidade de respostas rapidas durante a interacao
- persistencia local em um ambiente com recursos limitados
- cuidado com fluxo de tela, descanso e retomada
- sincronizacao com backend sem comprometer a experiencia do usuario
- necessidade de manter o fluxo simples, mas confiavel

Esses pontos tornam o projeto interessante nao apenas como app funcional, mas tambem como exercicio de engenharia aplicada.

## Estado atual

O projeto passou por varias iteracoes de melhoria ao longo do desenvolvimento, principalmente em:

- fluxo de treino
- consistencia de estado
- persistencia local
- integracao com a API
- comportamento em background
- performance da interface

Tambem existem arquivos auxiliares no repositorio documentando fluxo, etapas realizadas e pontos de melhoria.

## Possiveis evolucoes futuras

- ampliar testes em dispositivo real
- refinar ainda mais a performance da UI
- melhorar feedbacks visuais e mensagens ao usuario
- expandir o fluxo de treino com novos estados
- adicionar telemetria e debug mais estruturado
- evoluir a integracao com a plataforma web FIT.IA

## Por que esse projeto importa

Este projeto mostra uma tentativa pratica de transformar uma aplicacao web em uma experiencia mais integrada ao cotidiano do usuario.

Ele e importante porque:

- aproxima o treino de um contexto real de uso
- reduz a dependencia do celular durante a atividade fisica
- demonstra integracao entre web, API e dispositivo vestivel
- reforca conceitos de produto, usabilidade e engenharia em ambiente restrito

## Autor

Projeto desenvolvido por **Daniel Feitoza**, no contexto de um desafio proposto dentro do bootcamp da **FullStackClub**, com foco na integracao entre a plataforma web **FIT.IA** e um aplicativo de smartwatch baseado em **Zepp OS**.

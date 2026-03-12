# Fluxo Atual do Aplicativo Smartwatch

Este documento descreve, em ordem, o fluxo atual do aplicativo do smartwatch, considerando um caminho ideal, isto e, sem erros de rede, sem timeout e sem respostas inconsistentes da API.

O objetivo aqui e detalhar o comportamento real implementado hoje no codigo para facilitar auditoria e identificar possiveis lacunas.

## 1. Inicializacao da pagina principal

Arquivo principal:
- `page/gt/home/index.page.js`

Quando o aplicativo abre, a `home page` e criada.

Na inicializacao:
- cria estruturas internas de widgets
- zera referencias de timers
- inicializa flags de controle como:
  - `isPairingFlow`
  - `isDestroyed`
  - `isProcessing`
- zera estados locais em memoria como:
  - `deviceCode`
  - `userId`
  - `qrCodeUrl`
  - `lastTodayPayload`
  - `currentScreen`
  - `feedbackMessage`

## 2. Build inicial da tela

Quando o `build()` executa:
- chama `extendActiveScreenTime()`
- renderiza a tela de boot com mensagem de carregamento
- chama `bootstrap()`

## 3. Bootstrap

O metodo `bootstrap()` executa a preparacao inicial do app.

### 3.1. Migracao de chaves antigas

Primeiro ele chama:
- `migrateLegacyStorage()`

Esse passo converte chaves antigas para o padrao novo `ls_*`.

### 3.2. Leitura do vinculo local

Depois ele le do `localStorage`:
- `ls_device_code`
- `ls_user_id`

Se `ls_device_code` estiver vazio:
- limpa o estado de usuario nao vinculado
- renderiza a tela sem vinculo
- encerra o fluxo de bootstrap

## 4. Validacao do vinculo com a API

Se existir `deviceCode`, o app chama:
- `fetchLinkedUserByDevice(deviceCode)`

Essa chamada usa o metodo:
- `watch.getUserId`

Rota esperada:
- `GET /watch/user-id?deviceCode=...`

### 4.1. Se a API responder que nao existe vinculo

Se a resposta for considerada autoritativa para ausencia de vinculo:
- `404`
- ou `200` sem `userId` valido

Entao o app:
- limpa o storage de vinculo e treino
- renderiza a tela sem vinculo

### 4.2. Se a API responder erro de infraestrutura

Se a resposta for:
- `500`
- `0`
- erro de request

Entao o app:
- nao apaga o storage
- tenta reidratar usando `syncLinkedContext({ allowCachedFallback: true })`
- se nao conseguir, mostra tela amigavel de erro

### 4.3. Se o vinculo existir

Se o vinculo for valido:
- atualiza `userId` em memoria
- salva `ls_user_id`
- chama `syncLinkedContext({ allowCachedFallback: true })`

## 5. Sincronizacao do contexto vinculado

O metodo central do fluxo e:
- `syncLinkedContext(options)`

Ele tenta decidir qual tela deve aparecer:
- tela de exercicio
- tela principal com `Iniciar treino`
- tela principal com `Treino de hoje esta pago!`
- fallback local em caso de erro de API

## 6. Higiene inicial de storage dentro do sync

Ao entrar em `syncLinkedContext()`:

### 6.1. Validacao do `completedAt`

O app le:
- `ls_completed_at`

Se esse valor existir, mas nao for do dia atual:
- remove `ls_completed_at`

### 6.2. Validacao da data da sessao ativa local

O app le:
- `ls_active_session_id`
- `ls_active_session_date`

Se existir sessao local, mas a data armazenada for diferente de hoje:
- chama `ls_clear_training_state()`

Esse metodo remove as chaves de treino do dia anterior.

## 7. Consulta de sessao ativa

Depois disso o app chama:
- `fetchActiveSessionStatus()`

Essa chamada usa:
- `watch.getActiveSession`

Rota esperada:
- `GET /watch/sessions/active/:date?userId=...`

O resultado tambem e salvo em:
- `ls_last_active_status`

## 8. Sincronizacao autoritativa da sessao ativa

Assim que a resposta da sessao ativa chega, o app faz dois passos:

### 8.1. Sincroniza `completedAt`

Ele chama:
- `syncCompletedAtStorage(activeStatus.data.completedAt)`

Regras:
- se `completedAt` existir e for de hoje, salva em `ls_completed_at`
- se vier vazio, `null` ou de outro dia, remove `ls_completed_at`

### 8.2. Sincroniza chaves da sessao

Ele chama:
- `syncSessionStorageFromActiveStatus(activeStatus)`

Regras:
- se `active === true`, nao limpa a sessao
- se a resposta for `200` sem sessao ativa, limpa a sessao local
- se a resposta for `404`, limpa a sessao local

Limpeza feita em:
- `ls_active_session_id`
- `ls_active_session_date`
- `ls_started_at`
- `ls_exercise_index`
- `ls_sets_count`
- `ls_serie_completed`
- `ls_timeSerie`
- dados de descanso e alarme

## 9. Se existir sessao ativa na API

Se a API responder:
- `status === 200`
- `data.active === true`

Entao o app faz:

### 9.1. Persiste os dados da sessao ativa

Chama:
- `persistActiveSessionPayload(activeStatus.data)`

Esse metodo:
- mescla o payload atual com `lastTodayPayload` ou `ls_today_workout`
- salva o treino em `ls_today_workout`
- salva os exercicios em `ls_today_exercises`
- salva:
  - `ls_workout_plan_id`
  - `ls_workout_day_id`
  - `ls_workout_day_name`
  - `ls_week_day`
  - `ls_is_rest`
- sincroniza `ls_completed_at`
- persiste os identificadores da sessao:
  - `ls_active_session_id`
  - `ls_started_at`
  - `ls_active_session_date`
- se necessario inicializa:
  - `ls_exercise_index = 0`
  - `ls_sets_count = 1`
  - `ls_serie_completed = false`

### 9.2. Reconsulta o treino do dia

Mesmo havendo sessao ativa, o app tambem chama:
- `fetchTodayStatus(deviceCode)`

Essa chamada usa:
- `watch.getToday`

Rota esperada:
- `GET /watch/today/:date?deviceCode=...`

Se vier `200`:
- sobrescreve `ls_today_workout`
- sobrescreve `ls_today_exercises`
- atualiza `ls_completed_at`
- volta a persistir a sessao ativa mesclando:
  - dados do treino do dia
  - dados da sessao ativa
- renderiza a tela de exercicios

Se vier erro `>= 500` e fallback local estiver permitido:
- mantem a sessao local
- renderiza a tela de exercicios

## 10. Se nao existir sessao ativa na API

Se a API de sessao ativa nao retornar sessao ativa:
- o app consulta o treino do dia usando `fetchTodayStatus(deviceCode)`

## 11. Consulta do treino do dia

Rota usada:
- `GET /watch/today/:date?deviceCode=...`

## 12. Se a API retornar treino do dia com sucesso

Se `todayStatus.status === 200`, o app:

### 12.1. Atualiza o storage com o treino retornado

Chama:
- `persistWorkoutPayload(todayStatus.data)`

Isso sobrescreve:
- `ls_today_workout`
- `ls_today_exercises`
- `ls_workout_plan_id`
- `ls_workout_day_id`
- `ls_workout_day_name`
- `ls_week_day`
- `ls_is_rest`

### 12.2. Sincroniza `completedAt`

Chama:
- `syncCompletedAtStorage(todayStatus.data.completedAt)`

Regra:
- se `completedAt` vier preenchido e for de hoje, salva em `ls_completed_at`
- se vier vazio ou `null`, remove `ls_completed_at`

### 12.3. Se o treino ja estiver concluido

Se `completedAt` estiver presente para hoje:
- limpa o progresso local da sessao
- mantem os dados do treino do dia
- atualiza `lastTodayPayload`
- renderiza a tela principal com mensagem:
  - `Treino de hoje esta pago!`

### 12.4. Se nao estiver concluido

Se `completedAt` nao existir:
- limpa todo progresso local de sessao ativa
- mantem os dados novos do treino do dia
- atualiza `lastTodayPayload`
- renderiza a tela principal com botao:
  - `Iniciar treino`

## 13. Se a API retornar 404 para treino do dia

Se `todayStatus.status === 404`, o app entende:
- nao existe treino para hoje

Entao ele:
- remove `ls_completed_at`
- remove `ls_today_workout`
- remove `ls_today_exercises`
- limpa o progresso da sessao
- zera `lastTodayPayload`
- mostra tela amigavel informando que nao ha treino encontrado

## 14. Se a API retornar erro para treino do dia

Se `todayStatus.status >= 500` e fallback estiver permitido:
- tenta usar `ls_today_workout`
- tenta usar `ls_today_exercises`
- se houver cache suficiente, renderiza a tela principal com base nesse cache

Observacao:
- nesse caso o cache local so e usado como fallback de erro
- quando a API responde de forma valida, ela deve sobrescrever o cache

## 15. Tela principal

Arquivo:
- `page/gt/home/index.page.js`

O metodo `renderMain(workout)` desenha a tela principal.

Existem tres cenarios principais:

### 15.1. Dia de descanso

Se `workout.isRest === true`:
- mostra mensagem de descanso
- nao exibe botao de iniciar treino

### 15.2. Treino concluido no dia

Se existir `completedAt` do dia atual ou `feedbackMessage === "Treino finalizado com sucesso"`:
- mostra texto:
  - `Treino de hoje esta pago!`
- nao renderiza o botao `Iniciar treino`

### 15.3. Treino disponivel para iniciar

Se houver treino do dia, sem sessao ativa e sem `completedAt`:
- mostra texto orientando o usuario
- renderiza o botao:
  - `Iniciar treino`

## 16. Clique em `Iniciar treino`

Metodo:
- `onStartWorkout()`

Fluxo:

### 16.1. Verificacao local de treino concluido

Antes de iniciar, o app checa:
- `getCompletedAtForToday(workout)`

Se ja existir `completedAt` do dia:
- apenas rerenderiza a tela principal
- nao chama a API de start

### 16.2. Revalidacao de sessao ativa

O app chama novamente:
- `fetchActiveSessionStatus()`

Se houver sessao ativa:
- persiste os dados da sessao
- vai para a tela de exercicios

### 16.3. Inicio de nova sessao

Se nao houver sessao ativa, chama:
- `watch.startSession`

Rota esperada:
- `POST /watch/sessions/start`

Body esperado:
- `deviceCode`
- `workoutPlanId`
- `workoutDayId`

## 17. Resposta de `startSession`

### 17.1. Se a API responder sessao ja concluida

Se a resposta vier com:
- `status === 201`
- `completedAt` preenchido

O app entende que o treino ja foi concluido.

Entao:
- sincroniza `ls_completed_at`
- limpa o progresso local de sessao
- renderiza a tela principal como treino concluido

### 17.2. Se a API responder sessao iniciada

Se a resposta vier com:
- `status === 201`
- `userWorkoutSessionId`

Entao o app:
- persiste o treino do dia
- salva:
  - `ls_active_session_id`
  - `ls_started_at`
  - `ls_active_session_date`
- chama `resetProgressForSession()`

Esse reset define:
- `ls_exercise_index = 0`
- `ls_sets_count = 1`
- `ls_serie_completed = false`
- `ls_timeSerie = now().toISOString()`
- limpa dados de descanso

Depois disso:
- renderiza a tela de exercicios

## 18. Tela de exercicios

Metodo:
- `renderExerciseScreen()`

Ao renderizar:
- reativa o tempo de tela acesa
- limpa widgets anteriores
- chama `ensureRestConclusionIfNeeded()`
- le o estado atual via `readTrainingState()`

Dados lidos do storage:
- treino
- lista de exercicios
- exercicio atual
- indice do exercicio
- numero da serie atual
- total de series
- `serieCompleted`
- `startedAt`
- `restRunning`
- `timeSerieStartedAt`
- dados de descanso
- `sessionId`
- `sessionDate`

## 19. Informacoes mostradas na tela de exercicios

Em linhas gerais a tela mostra:
- nome do exercicio
- `Serie X / Y`
- tempo da serie atual em verde
- linha `Tempo descanso: ...`
- mensagem auxiliar
- `Tempo total de treino efetivo`
- timer total efetivo em azul
- botao principal inferior

## 20. Timer da serie atual

Storage usado:
- `ls_timeSerie`

Regras:
- comeca ao iniciar treino
- reinicia ao avancar para proxima serie
- reinicia ao avancar para proximo exercicio
- para quando o usuario entra no descanso
- nao deve reiniciar sozinho ao fim do descanso

## 21. Descanso

Quando o usuario clica em `Iniciar Descanso`:
- calcula `restStartedAt`
- calcula `restTargetAt`
- agenda um alarme
- remove `ls_timeSerie`
- marca `ls_serie_completed = true`
- persiste:
  - `ls_rest_time_full`
  - `ls_rest_started_at`
  - `ls_rest_target_at`
  - `ls_rest_running = true`
  - `ls_alarm_id`

## 22. Alarme do descanso

O alarme nao abre mais a page.

Hoje ele aponta para:
- `service/timer_bg`

Esse servico:
- dispara notificacao local
- vibra
- nao abre a interface do app

## 23. Fim do descanso

Quando o descanso acaba:
- `completeRest()` limpa o estado de descanso
- a tela de exercicios passa a mostrar botao:
  - `Proxima Serie`
  - ou `Proximo Exercicio`
  - ou `Finalizar Treino`

Dependendo do estado atual.

## 24. Avanco apos descanso

Metodo:
- `onProgressAfterRest()`

Ele:
- le o estado atual
- remove `ls_rest_started_at` se necessario
- chama `advanceProgress(training)`

Se o proximo passo for:
- `next-set`, incrementa `ls_sets_count`
- `next-exercise`, incrementa `ls_exercise_index` e volta `ls_sets_count` para `1`

Em ambos os casos:
- `ls_serie_completed = false`
- `ls_timeSerie = now().toISOString()`

Depois:
- renderiza a tela de exercicios

## 25. Ultima serie do ultimo exercicio

Quando o usuario chega na ultima serie do ultimo exercicio:
- o botao passa a ser `Finalizar Exercicio`

Ao clicar:
- remove `ls_timeSerie`
- salva `ls_serie_completed = true`
- rerenderiza a tela

Depois disso o botao passa a ser:
- `Finalizar Treino`

## 26. Finalizacao do treino

Metodo:
- `onFinishWorkout()`

Ele le:
- `ls_active_session_id`
- `ls_today_workout`
- `ls_workout_plan_id`
- `ls_workout_day_id`

Monta o payload:
- `sessionId`
- `deviceCode`
- `workoutPlanId`
- `workoutDayId`
- `completedAt = new Date().toISOString()`

Tambem salva esse payload em:
- `ls_last_finish_debug`

Depois chama:
- `watch.finishSession`

Rota esperada:
- `PATCH /watch/sessions/:sessionId/finish`

Body esperado:
- `deviceCode`
- `workoutPlanId`
- `workoutDayId`
- `completedAt`

## 27. Se a finalizacao der sucesso

Se a resposta for:
- `200`
- ou `204`

O app:
- cancela o alarme de descanso
- salva `ls_completed_at` com o horario de conclusao
- limpa o estado de treino via `ls_clear_training_state()`
- define `feedbackMessage = "Treino finalizado com sucesso"`
- zera `lastTodayPayload`
- chama novamente `syncLinkedContext({ allowCachedFallback: false })`

Depois disso, o esperado e:
- a API do treino do dia responda com `completedAt`
- ou o `ls_completed_at` local sustente a tela concluida

Resultado esperado na UI:
- tela principal com mensagem:
  - `Treino de hoje esta pago!`
- sem botao `Iniciar treino`

## 28. Resume da aplicacao

Quando a aplicacao volta ao foco:

### 28.1. Se estiver na tela de exercicios

O app:
- valida se a sessao local ainda pertence a data de hoje
- se nao pertencer, limpa o treino e ressincroniza
- chama `ensureRestConclusionIfNeeded()`
- rerenderiza a tela de exercicios

### 28.2. Se nao estiver na tela de exercicios

O app chama novamente:
- `syncLinkedContext({ allowCachedFallback: true })`

## 29. Uso de fallback local

O fallback local so deveria acontecer quando a API falha.

Em condicao ideal, isto e, quando a API responde corretamente:
- os dados da API devem prevalecer
- o `localStorage` deve ser atualizado com os novos dados
- dados stale devem ser limpos

## 30. Chaves principais de storage envolvidas

Vinculo:
- `ls_device_code`
- `ls_user_id`

Treino do dia:
- `ls_today_workout`
- `ls_today_exercises`
- `ls_workout_plan_id`
- `ls_workout_day_id`
- `ls_workout_day_name`
- `ls_week_day`
- `ls_is_rest`

Sessao ativa:
- `ls_active_session_id`
- `ls_active_session_date`
- `ls_started_at`

Conclusao:
- `ls_completed_at`

Progresso do treino:
- `ls_exercise_index`
- `ls_sets_count`
- `ls_serie_completed`
- `ls_timeSerie`

Descanso:
- `ls_rest_time_full`
- `ls_rest_started_at`
- `ls_rest_target_at`
- `ls_rest_running`
- `ls_alarm_id`

Debug:
- `ls_last_active_status`
- `ls_last_finish_debug`

## 31. Regra funcional esperada

Em um fluxo correto, a decisao da tela deve obedecer exatamente esta ordem:

1. Validar se existe vinculo.
2. Validar se existe sessao ativa hoje.
3. Se existir sessao ativa, abrir tela de exercicios.
4. Se nao existir sessao ativa, consultar o treino do dia.
5. Se o treino do dia vier com `completedAt`, mostrar `Treino de hoje esta pago!`.
6. Se o treino do dia existir sem `completedAt`, mostrar `Iniciar treino`.
7. Se nao existir treino do dia, limpar dados locais relacionados a esse treino.

## 32. Possiveis pontos sensiveis para auditoria

Mesmo em fluxo ideal, estes pontos merecem revisao:

1. Se a rota `/watch/today/:date` sempre retorna `completedAt` corretamente.
2. Se a rota `/watch/sessions/active/:date` nunca retorna payload stale.
3. Se o app esta sempre limpando `ls_completed_at` quando a API devolve `null`.
4. Se o app esta sempre limpando `ls_active_session_id` e correlatos quando a API diz que nao ha sessao ativa.
5. Se o `deviceCode` enviado para `/watch/today/:date` corresponde exatamente ao device vinculado.
6. Se o `userId` enviado para `/watch/sessions/active/:date` corresponde ao usuario realmente vinculado.
7. Se o payload retornado por `/watch/today/:date` contem de forma consistente:
   - `workoutPlanId`
   - `workoutDayId`
   - `workoutDayName`
   - `weekDay`
   - `exercises`
   - `completedAt`


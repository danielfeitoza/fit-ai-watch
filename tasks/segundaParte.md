Siga rigorosamente as regras do arquivo .github/copilot-instructions.md e os padrões atuais do projeto Zepp OS (Device App + App-Side). Não quebre código existente. Não altere contratos da API. Organize em módulos pequenos e testáveis.

Objetivo:
Implementar o gerenciamento de treino no smartwatch (MVP) com persistência local, retomada correta após sair/voltar do app, timer de descanso confiável por timestamp absoluto e finalização de treino via API.

Contexto técnico obrigatório:
1. Arquitetura:
- Device App (relógio) renderiza UI e estado local.
- App-Side (celular) faz chamadas HTTP para internet.

2. Base URL:
- https://www.fitaiapi.cidadeladocodigo.com.br

3. Arquivo de rede:
- app-side/index.js
- manter:
  const API_BASE_URLS = ["https://www.fitaiapi.cidadeladocodigo.com.br"];

Regras de persistência (obrigatório):
1. Toda nova localStorage deve usar prefixo ls_.
2. Objetos/arrays:
- salvar com JSON.stringify
- ler com JSON.parse seguro + fallback
3. Definir funções utilitárias:
- ls_set(key, value)
- ls_get(key, fallback)
- ls_remove(key)
- ls_clear_training_state()
4. Sempre limpar/atualizar localStorage quando:
- treino finalizar
- exercício avançar
- descanso concluir
- detectar inconsistência de sessão/data

Mapeamento de chaves existentes para padrão ls_:
1. device_code -> ls_device_code
2. user_id -> ls_user_id
3. today_workout -> ls_today_workout
4. today_exercises -> ls_today_exercises
5. active_session_id -> ls_active_session_id
6. active_session_date -> ls_active_session_date

Novas chaves ls_ necessárias:
1. ls_started_at
- startedAt da sessão ativa (ISO)

2. ls_workout_plan_id
3. ls_workout_day_id
4. ls_workout_day_name
5. ls_week_day
6. ls_is_rest

7. ls_exercise_index
- índice do exercício atual ordenado por order

8. ls_sets_count
- série atual do exercício atual (começa em 1)

9. ls_rest_time_full
- restTimeInSeconds do exercício atual

10. ls_rest_started_at
- timestamp ISO do início do descanso

11. ls_rest_target_at
- timestamp ISO de término do descanso (absoluto)

12. ls_rest_running
- boolean (true/false)

13. ls_alarm_id
- id do alarme agendado para descanso

14. ls_last_ui_state
- ajuda a retomar tela correta após onShow/onHide

Rotas que devem ser usadas e como chamar:
1. Resolver usuário por device code:
- GET /watch/user-id?deviceCode=<uuid>
- retorno:
  { userId: "string" } ou { userId: 0 }

2. Consultar sessão ativa do dia:
- GET /watch/sessions/active/:date?userId=<id>
- se ativo:
  {
    active: true,
    startedAt,
    workoutPlanId,
    workoutDayId,
    workoutDayName,
    weekDay,
    isRest,
    exercises[]
  }
- se não ativo:
  { active: false }

3. Iniciar sessão:
- POST /watch/sessions/start
- body:
  {
    deviceCode,
    workoutPlanId,
    workoutDayId
  }
- retorno 201:
  {
    userWorkoutSessionId,
    startedAt
  }

4. Finalizar sessão:
- PATCH /watch/sessions/:sessionId/finish
- params:
  sessionId
- body:
  {
    deviceCode,
    workoutPlanId,
    workoutDayId,
    completedAt
  }

Fluxo funcional completo:
1. Boot do app:
- carregar ls_device_code e ls_user_id
- se faltar ls_user_id, resolver por GET /watch/user-id
- se userId = 0: mostrar fluxo de pareamento (já existente)
- se userId válido: continuar

2. Ao abrir tela de treino:
- pegar data atual local YYYY-MM-DD
- chamar GET /watch/sessions/active/:date?userId=...
- se active false:
  - usar ls_today_workout + ls_today_exercises para mostrar treino do dia e botão Iniciar treino
- se active true:
  - sobrescrever cache local com payload da API
  - salvar:
    ls_started_at
    ls_active_session_id se disponível no fluxo (ou manter existente)
    ls_workout_plan_id
    ls_workout_day_id
    ls_today_workout
    ls_today_exercises
  - ir direto para tela de exercício em andamento

3. Tela de exercício (layout):
- subir no eixo Y:
  nome exercício
  Série X / Y
  Tempo descanso: N
- adicionar abaixo:
  texto centralizado: Tempo total de treino efetivo
  timer grande MM:SS (segundos com fonte menor se quiser)
- botão inferior full width dinâmico:
  Iniciar Descanso
  Próxima Série
  Próximo Exercício
  Finalizar Treino

4. Cálculo do tempo total efetivo:
- base em ls_started_at
- tempo mostrado = agora - startedAt
- atualizar na UI
- ao voltar para app (onShow), recalcular imediatamente por timestamp absoluto
- não depender de contagem incremental simples

5. Lógica de séries e exercícios:
- ordenar exercises por order asc
- iniciar:
  ls_exercise_index = 0
  ls_sets_count = 1
- ao concluir série:
  - se ainda há séries no exercício:
    botão vira Iniciar Descanso e depois Próxima Série
  - se acabou séries e há próximo exercício:
    botão vira Iniciar Descanso e depois Próximo Exercício
  - se acabou último exercício e última série:
    ocultar botão de descanso/progressão
    mostrar botão Finalizar Treino

6. Descanso com estratégia profissional por timestamp absoluto:
- ao clicar Iniciar Descanso:
  - ls_rest_time_full = restTimeInSeconds exercício atual
  - ls_rest_started_at = now ISO
  - ls_rest_target_at = now + restTimeInSeconds
  - ls_rest_running = true
  - agendar alarme para ls_rest_target_at
- no onShow:
  - se ls_rest_running true:
    remaining = target - now
    se remaining > 0: atualizar UI com restante real
    se remaining <= 0: disparar estado de descanso concluído
- no descanso concluído:
  - vibrar
  - mostrar mensagem:
    se próxima ação for série:
      A hora do descanso acabou, vamos para a próxima série
      botão: Próxima Série
    se próxima ação for exercício:
      A hora do descanso acabou, vamos para o próximo exercício
      botão: Próximo Exercício
  - limpar:
    ls_rest_started_at
    ls_rest_target_at
    ls_rest_running = false
    cancelar/remover ls_alarm_id

7. Finalização do treino:
- botão Finalizar Treino chama:
  PATCH /watch/sessions/:sessionId/finish
- completedAt = new Date().toISOString()
- em sucesso:
  - limpar todo estado de treino local:
    ls_active_session_id
    ls_active_session_date
    ls_started_at
    ls_today_workout
    ls_today_exercises
    ls_exercise_index
    ls_sets_count
    ls_rest_time_full
    ls_rest_started_at
    ls_rest_target_at
    ls_rest_running
    ls_alarm_id
  - navegar para tela principal com feedback de sucesso

Regras adicionais importantes:
1. Se data atual mudou e ls_active_session_date for diferente:
- forçar revalidação com GET /watch/sessions/active/:date
- evitar reaproveitar sessão antiga indevidamente

2. Se API falhar:
- mostrar estado de erro amigável
- botão Recarregar
- não perder estado local válido

3. Não usar setInterval como fonte da verdade para tempo de descanso.
- fonte da verdade deve ser ls_rest_target_at (timestamp absoluto)

4. Evitar duplicar alarmes.
- sempre cancelar alarme anterior antes de agendar novo

Entregáveis:
1. Código implementado com separação clara entre:
- serviço de API no app-side
- estado e regras de treino no device
- componentes/telas de UI

2. Lista de arquivos alterados

3. Resumo técnico curto

4. Passo a passo de teste manual:
- sessão não ativa
- sessão ativa recuperada
- descanso com tela apagada e retorno
- troca de série
- troca de exercício
- finalização do treino
- limpeza de localStorage

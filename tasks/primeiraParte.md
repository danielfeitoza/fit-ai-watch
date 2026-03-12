Siga rigorosamente as regras do projeto (arquitetura atual, organização de arquivos, nomenclatura, fluxo de telas e tratamento de erros). Esta é uma nova versão funcional da aplicação, substituindo o comportamento antigo.

Quero implementar o fluxo completo do smartwatch (Zepp OS / Amazfit) com:
- Pareamento via QR Code.
- Validação autoritativa de vínculo por deviceCode.
- Validação de sessão ativa por userId + data.
- Início e retomada de treino.
- Persistência local consistente e limpeza obrigatória quando não houver vínculo.

==================================================
1) CONTEXTO TÉCNICO OBRIGATÓRIO
==================================================

- Arquitetura: Device App (relógio) <-> App-Side (celular).
- Todas as chamadas HTTP devem sair do App-Side.
- URL base da API:
  https://www.fitaiapi.cidadeladocodigo.com.br
- Arquivo de integração de rede:
  app-side/index.js
- Constante obrigatória:
  const API_BASE_URLS = ["https://www.fitaiapi.cidadeladocodigo.com.br"];

==================================================
2) ENDPOINTS OBRIGATÓRIOS
==================================================

Implementar no `app-side/index.js` métodos com `req.method`:

1. `watch.getToday`
- GET /watch/today/:date?deviceCode=<uuid>
- Status esperados: 200, 404, 500

2. `watch.startSession`
- POST /watch/sessions/start
- Status esperados: 201, 404, 500

3. `watch.getActiveSession`
- GET /watch/sessions/active/:date?userId=<id>
- Status esperados: 200, 404, 500

4. `watch.getUserId`
- GET /watch/user-id?deviceCode=<uuid>
- Status esperados: 200, 404, 500
- Retorno:
  - vinculado: `{ "userId": "id-do-usuario" }`
  - não vinculado: `{ "userId": 0 }`

==================================================
3) CHAVES DE LOCALSTORAGE (OBRIGATÓRIO)
==================================================

Usar estas chaves:
- `device_code`
- `user_id`
- `today_workout`
- `today_exercises`
- `active_session_id`
- `active_session_date`
- `last_active_status`

Padrão de persistência:
- Objetos/arrays: sempre `JSON.stringify`.
- Leitura com `JSON.parse` seguro + fallback.

==================================================
4) FLUXO DE BOOT (OBRIGATÓRIO)
==================================================

Ao abrir o app:

1. Mostrar "Carregando...".
2. Ler `device_code` salvo.
3. Se existir `device_code`, validar vínculo com `watch.getUserId`.

Regra crítica:
- Nesta validação de vínculo por `deviceCode`, NÃO usar fallback de `user_id` antigo do storage.
- Se rota retornar sem usuário (`userId` 0, vazio ou inválido):
  - limpar TODO storage local do app,
  - ir para tela inicial não vinculada (texto + botão QR Code).

Se vínculo existir:
1. Salvar `user_id`.
2. Consultar sessão ativa com `watch.getActiveSession`.
3. Se `active: true`:
   - salvar workout/exercises retornados,
   - marcar `active_session_id` e `active_session_date`,
   - navegar direto para tela de exercício.
4. Se `active: false`:
   - consultar `watch.getToday` com retentativa (3 tentativas no boot).

==================================================
5) FLUXO NÃO VINCULADO E QR CODE
==================================================

Tela não vinculada:
- Texto:
  "Para vincular o smartwatch ao FIT.AI, escaneie o QR Code clicando no botão abaixo."
- Botão `QR Code`.

Ao clicar `QR Code`:
1. Gerar novo UUID (`deviceCode`).
2. Limpar contexto local anterior de vínculo/sessão.
3. Salvar novo `device_code`.
4. Obter `deviceName` com `getDeviceInfo()` (fallback seguro).
5. Montar URL:
   https://www.fitaiapp.cidadeladocodigo.com.br/parear?deviceCode=<uuid>&deviceName=<name-encoded>
6. Abrir tela dedicada do QR com:
   - QR centralizado,
   - botão `Fechar` na parte inferior central.

==================================================
6) POLLING DE PAREAMENTO
==================================================

Após exibir QR, iniciar polling periódico.

Ordem de validação em cada ciclo:
1. `watch.getUserId` por `deviceCode`.
2. Se ainda não vinculado:
   - manter usuário na tela do QR,
   - aguardar próximo ciclo (não redirecionar para tela inicial).
3. Se vinculado:
   - sair do modo pareamento,
   - consultar `watch.getToday` e seguir fluxo normal.

Status do `watch.getToday`:
- 200: vinculado + treino/estado disponível -> processar `onLinked`.
- 404: continuar polling.
- 500: mostrar erro + botão `Recarregar`.

==================================================
7) FLUXO `onLinked` (ESTADO PRINCIPAL)
==================================================

Ao receber payload válido:
1. Salvar `today_workout` e `today_exercises`.
2. Salvar `user_id` se presente.
3. Consultar `watch.getActiveSession`.
4. Se sessão ativa:
   - sobrescrever workout/exercises com dados da sessão ativa,
   - ir para tela de exercício.
5. Se não ativa:
   - se `isRest = true`, mostrar tela de descanso,
   - senão mostrar tela principal com botão `Iniciar treino`.

Tela de descanso:
- Mensagem amigável informando que é dia de descanso.

Tela de treino:
- Nome do treino do dia.
- Dia da semana em pt-BR.
- Texto de apoio.
- Botão `Iniciar treino`.

==================================================
8) INÍCIO DE TREINO
==================================================

Ao clicar `Iniciar treino`:
1. Revalidar `watch.getActiveSession`.
2. Se já ativo: ir direto para tela de exercício.
3. Se não ativo: chamar `watch.startSession`.
4. Em 201:
   - salvar `active_session_id`,
   - salvar `active_session_date` (data atual),
   - ir para tela de exercício.

==================================================
9) TELA DE EXERCÍCIO
==================================================

- Ordenar exercícios por `order` ascendente.
- Exibir primeiro exercício da lista.
- Mostrar:
  - nome do exercício,
  - `Série 1 / X`,
  - `Tempo descanso: Y`.

==================================================
10) LIMPEZA OBRIGATÓRIA QUANDO NÃO VINCULADO
==================================================

Sempre que detectar que não há vínculo (pela rota `watch.getUserId`):
- zerar `device_code`, `user_id`, `today_workout`, `today_exercises`, `active_session_id`, `active_session_date`, `last_active_status`;
- resetar estado em memória;
- renderizar tela inicial com botão QR.

==================================================
11) DEBUG TEMPORÁRIO
==================================================

Adicionar tela temporária de debug (opcionalmente controlada por flag) mostrando os valores das chaves de localStorage acima.
- Deve ter botão `Voltar`.
- Deve permitir abertura a partir das telas principais para diagnóstico.

==================================================
12) REQUISITOS DE QUALIDADE
==================================================

- Não quebrar fluxos existentes.
- Evitar múltiplos polls simultâneos.
- Limpar timer ao trocar de tela.
- Manter funções pequenas e coesas.
- Mensagens de UI em português-BR.
- Tratar diferenças entre erro de rede e não vinculado real.

==================================================
13) ENTREGA ESPERADA
==================================================

Entregar:
1. Código implementado.
2. Lista de arquivos alterados.
3. Resumo técnico do fluxo final.
4. Passo a passo de teste manual:
   - sem vínculo,
   - vínculo via QR,
   - sessão ativa existente,
   - sessão não ativa,
   - dia de descanso,
   - início de treino,
   - desvínculo após já ter usado o app,
   - validação de limpeza completa do storage.

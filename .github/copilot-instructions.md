# Copilot Instructions - Fit AI Watch

## Contexto do projeto
- Este repositório contém um app para Zepp OS (smartwatch) com frontend em `page/` e serviço de integração em `app-side/`.
- Existe um backend Node.js em `backend/` para suporte local/API.
- Linguagem principal: JavaScript (ES Modules no app do relógio; CommonJS no backend).

## Regras gerais de código
- Preserve a arquitetura atual:
  - UI do relógio em `page/**` usando `@zos/ui` e `BasePage`.
  - Chamadas remotas do relógio devem passar por `this.request(...)` para o `app-side`.
  - Integração HTTP do app do relógio deve ficar em `app-side/index.js` (método `requestApi`).
- Não introduza TypeScript, frameworks ou bibliotecas novas sem necessidade explícita.
- Evite refactors grandes sem pedido explícito.
- Prefira mudanças pequenas, objetivas e compatíveis com Zepp OS API v3.

## Padrões para frontend Zepp (`page/`)
- Sempre limpar widgets antigos antes de redesenhar telas (`cleanupWidgets`).
- Toda chamada assíncrona deve ter tratamento de erro e feedback visual para o usuário.
- Antes de persistir objetos/arrays em `localStorage`, serializar com `JSON.stringify`.
- Ao ler JSON de `localStorage`, usar parse seguro com fallback.
- Evitar lógica de negócio acoplada à criação de widgets; prefira funções auxiliares.
- Usar constantes para:
  - chaves de storage,
  - intervalos de polling/timeouts,
  - textos repetidos,
  - cores e dimensões recorrentes.

## Layout em tela redonda (obrigatório)
- Considerar sempre que o app roda em tela redonda 480x480 no benchmark (`R = 240`), mas usar `getDeviceInfo()` para largura/altura reais.
- Em Zepp OS, `x` e `y` dos widgets são coordenadas de posicionamento no canvas da página; tratar as bordas superior/inferior como zona de risco de corte visual em dispositivos redondos.
- Para elementos fixos (TEXT, BUTTON, etc.) fora do centro vertical, calcular largura segura por altura com geometria da circunferência:
  - `dy = abs(criticalY - R)`
  - `dx = sqrt(R^2 - dy^2)`
  - `safeX = ceil(R - dx)`
  - `safeW = floor(2 * dx)`
- Para elementos com altura, usar `criticalY` como o ponto mais extremo do elemento no eixo Y (topo na metade superior, base na metade inferior), evitando corte de texto/contorno.
- Se `dy >= R`, considerar área inválida para conteúdo (`w = 0`).
- Em textos longos em tela redonda, priorizar conteúdo centralizado horizontalmente (`align_h: hmUI.align.CENTER_H`) e reduzir largura útil com margem lateral generosa.
- Evitar posicionar textos críticos, CTA e números importantes nas faixas próximas ao topo/base da tela.

## Fluxo funcional obrigatório (vínculo e sessão)
- A validação de vínculo no boot deve usar endpoint autoritativo por `deviceCode`:
  - `GET /watch/user-id?deviceCode=...` (`watch.getUserId` no app-side).
- Regra crítica: ao validar vínculo por `deviceCode`, nunca usar fallback de `user_id` antigo do `localStorage`.
- Se não houver vínculo (`userId` ausente, `0` ou inválido):
  - limpar storage local de sessão/vínculo,
  - voltar para tela inicial com botão de QR Code.
- Se houver vínculo:
  - salvar `user_id` local,
  - consultar sessão ativa no dia:
    - `GET /watch/sessions/active/:date?userId=...` (`watch.getActiveSession` no app-side).
- Se sessão ativa existir (`active: true`):
  - renderizar tela de exercício diretamente,
  - persistir workout/exercises no local storage.
- Se sessão ativa não existir:
  - consultar treino do dia (`watch.getToday`) e seguir fluxo normal de descanso/iniciar treino.

## Regras de QR Code e pareamento
- Ao clicar em `QR Code`, abrir tela dedicada do QR (`renderQrCodeScreen`).
- O QR deve permanecer centralizado e visível até o vínculo ocorrer.
- Durante o polling de pareamento:
  - se ainda não vinculou, manter usuário na tela de QR (não redirecionar para tela inicial automaticamente),
  - ao vincular, sair do fluxo de pareamento e seguir para tela correta.
- Botão de fechar da tela de QR deve retornar para tela inicial não vinculada.

## Persistência local obrigatória
- Chaves padrão atuais:
  - `device_code`
  - `user_id`
  - `today_workout`
  - `today_exercises`
  - `active_session_id`
  - `active_session_date`
  - `last_active_status`
- Quando vínculo for removido no backend e detectado no relógio, zerar todas as chaves acima.

## Debug temporário
- É aceitável manter uma tela temporária de debug com leitura das chaves de `localStorage` para diagnóstico.
- Se `DEBUG_MODE` for introduzido, garantir valor padrão desligado em produção.

## Padrões para `app-side/`
- Novos endpoints para o relógio devem ser expostos via `onRequest` com `req.method` descritivo (ex.: `watch.xxx`).
- Reutilizar `requestApi` para chamadas HTTP; não duplicar lógica de fetch/parse.
- Tratar status esperados explicitamente (`expectedStatus`) e retornar `{ status, data }`.
- Mensagens de erro devem ser claras e orientadas à causa.

## Padrões para backend (`backend/`)
- Manter padrão CommonJS (`require/module.exports`) já adotado.
- Validar payloads de entrada antes de operar no banco.
- Em operações transacionais, sempre usar `BEGIN/COMMIT/ROLLBACK` com `finally` liberando client.
- Não hardcodar segredos; usar variáveis de ambiente (`.env`).

## Qualidade e segurança
- Não expor chaves, tokens, credenciais ou URLs sensíveis em código novo.
- Não incluir logs com dados pessoais ou identificadores sensíveis.
- Sempre considerar cenários offline/sem conexão no app do relógio.

## Convenções de estilo
- Priorizar nomes claros e descritivos em inglês para funções/variáveis.
- Comentários apenas quando realmente agregarem contexto não óbvio.
- Evitar duplicação; extrair helpers quando houver repetição real.
- Manter compatibilidade com o estilo já existente no arquivo alterado.

## Encoding e texto
- Salvar arquivos em UTF-8 para evitar texto corrompido (acentuação/PT-BR).
- Evitar strings com encoding quebrado.

## Quando gerar código
- Entregar trecho pronto para colar, preservando imports, estrutura e padrão do arquivo alvo.
- Se a mudança impactar comportamento visível, incluir também o tratamento de erro correspondente.
- Ao criar nova feature, indicar onde integrar no fluxo atual (UI, `this.request`, `app-side`, backend).

## Referências oficiais (Zepp Docs)
- Device benchmark (inclui `round 480x480`): https://docs.zepp.com/docs/guides/design/best-practice/device-adaptation/
- `getDeviceInfo()` para dimensões/shape em runtime: https://docs.zepp.com/docs/reference/device-app-api/newAPI/device/getDeviceInfo/
- Widgets e posicionamento (`x`, `y`, `w`, `h`) em `@zos/ui`: https://docs.zepp.com/docs/reference/device-app-api/newAPI/ui/widget/
- Boas práticas para conteúdo em tela redonda (texto centralizado e distância de segurança): https://docs.zepp.com/docs/guides/design/best-practice/content-layout/

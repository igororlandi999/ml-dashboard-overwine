# Fase C — Patch do index.html (preparado, testado, SEM push)
Overwine · 15/07/2026 · Backend alvo: `https://overwine-assistant.vercel.app`

Nada foi publicado, nenhuma credencial rotacionada, nenhuma conta externa tocada.

---

## 0. Verificação de integridade (pedida antes de alterar)

O arquivo enviado nesta conversa **NÃO corresponde** ao HEAD do GitHub:

| | Linhas | Conteúdo |
|---|---|---|
| GitHub `origin/main` (commit `e9f6eb5`) | 10.246 | sem o módulo Copiloto |
| Arquivo enviado (sua versão local) | 11.436 | inclui "Análise Inteligente do Estoque" (Copiloto), ~1.190 linhas nunca pushadas |

**O patch foi aplicado sobre a sua versão local (a mais recente).** Consequência para a publicação: o push da Fase C vai levar junto o módulo Copiloto pela primeira vez — o commit deve deixar isso explícito (sugestão de mensagens no item 9). Os segredos expostos estão idênticos nas duas versões, então nada muda no plano de segurança.

## 1–3. Entregáveis

- `index-ORIGINAL-backup.html` — backup byte a byte do original (516.765 bytes).
- `index.html` — patchado (511.229 bytes; 11.281 linhas; −472/+317).
- `patch-fase-c.diff` — diff unificado completo (697 linhas).
- `teste-patch-fase-c.cjs` — harness de testes (rode com `node teste-patch-fase-c.cjs` na pasta do index patchado).

## 4. Funções e constantes REMOVIDAS (14)

| O quê | Linhas originais | Motivo |
|---|---|---|
| `CLIENT_SECRET`, `CLIENT_ID`, `REDIRECT_URI`, `TOKEN_RENEW_BEFORE_MS` | 10465–10469 | segredo/OAuth no browser eliminados |
| `SHARED_TOKEN`, `SHARED_REFRESH`, `SHARED_USERID` | 10643–10645 | credenciais compartilhadas eliminadas |
| `VIEWER_PASSWORD`, `VIEWER_SESSION_KEY` | 10639, 10649 | senha agora só no backend (env) |
| `ACCESS_TOKEN` (global) | 3069 | navegador não tem mais token ML |
| `tokenExpiresAt`, `renewTimer` | 10471–10473 | sem renovação no browser |
| `saveTokens()` / `loadTokens()` | 10477–10489 | sem tokens no localStorage |
| `doOAuthLogin()` | 10491–10499 | OAuth sai do browser |
| `handleOAuthCallback()` | 10501–10533 | idem |
| `renewToken()` | 10537–10571 | renovação é exclusiva do backend |
| `scheduleTokenRenewal()` | 10575–10599 | idem |
| `connectWithToken()` + inputs de token manual | 10700–10707 + HTML 1317–1339 | entrada manual de token violaria "nenhuma chamada direta autenticada ao ML" |
| `showAdminLogin()` / `showViewerLogin()` | 10676–10684 | tela de admin OAuth não existe mais |

## 5. Funções ALTERADAS (9) e ADICIONADAS (6)

**Alteradas:**

| Função | Linha (patchado) | Mudança |
|---|---|---|
| `mlFetch(path)` | 3600 | mesmo nome/assinatura/retorno; agora traduz o path via `mlPathToOp` e chama o proxy com Bearer de sessão. Erros mantêm o formato `API <status>: <path>` |
| `loadAdCost()` | 3862 | cascata de 4 endpoints → operação única `ads-billing` (aggregate); parsing da resposta preservado |
| `posBuscar()` (trecho da busca geral) | 6543 | fetch direto com Bearer ML → `mlFetch('/sites/MLB/search...')`; fallback local preservado |
| `rlPost(path, data)` | 7089 | traduz para `POST /api/ml/promotion-item-set`; injeta `id` no payload; erro preserva `{status, data.cause}` que a aba Relâmpago consome |
| `rlDelete(path)` | 7102 | traduz para `DELETE /api/ml/promotion-item-remove?id&promotion_type&promotion_id` |
| `checkViewerPass()` | 10577 | valida via `POST /api/auth/login` (async); mensagens de erro vêm do backend (inclui rate limit) |
| `doLogout()` | 10598 | chama `POST /api/auth/logout`, zera sessão, volta à tela de senha |
| `startDashboard()` | 10608 | sem lógica de renovação de token; resto idêntico |
| `scheduleAutoRefresh()` | 10539 | antes de cada auto-refresh valida `GET /api/auth/session` — se a sessão morreu com a aba ociosa, volta ao login em vez de disparar ~160 chamadas falhando |
| `showSetup()` | 10568 | simplificada (sem admin/token/VIEWER_SESSION_KEY) |
| init `DOMContentLoaded` | 10633 | sem OAuth callback; higiene de migração (remove `ml_token`/`ml_refresh`/`ml_expires_at`/`ml_userid` do localStorage e `ow_viewer_ok`/`oauth_state` do sessionStorage); limpa `?code=` residual da URL; sempre inicia pela tela de senha |

**Adicionadas (camada de rede, l.3513–3607):** `BACKEND_URL`, `SESSION_TOKEN` (memória), `handleSessionExpired()`, `backendFetch()`, `mlPathToOp()`, `apiLogin()`, `apiLogout()`, `checkSession()`.

**Intocados:** todos os 18 call sites do `mlFetch`, os 3 call sites de `rlPost`/`rlDelete`, e 100% de layout, cards, gráficos, filtros, abas e regras de negócio (o diff de 697 linhas está inteiro dentro da camada de rede/auth + tela de login).

## 6. Rotas internas usadas pelo dashboard patchado

`POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/session` · `GET /api/ml/items-search` · `GET /api/ml/items` · `GET /api/ml/orders` · `GET /api/ml/order` · `GET /api/ml/order-discounts` · `GET /api/ml/shipment` · `GET /api/ml/reputation` · `GET /api/ml/visits` · `GET /api/ml/sites-search` · `GET /api/ml/product-items` · `GET /api/ml/promotions` · `GET /api/ml/promotion-items` · `GET /api/ml/ads-billing` · `POST /api/ml/promotion-item-set` · `DELETE /api/ml/promotion-item-remove`

## 7. Resultado dos testes — 40/40 OK

Execução real (não só sintaxe), padrão do projeto:
- **Fase 1** — script inteiro (11.281 linhas) executado com stubs de browser via `new Function`: sem ReferenceError/SyntaxError; `SESSION_TOKEN` inicia nulo; `USER_ID` fixado.
- **Fase 2** — tradutor testado contra os **18 paths históricos reais** (incluindo datas da sazonalidade com timezone `-03:00` codificado, cancelados, visitas 30/90d): 18/18 URLs exatas; rota desconhecida → `null` (sem proxy genérico); rota de escrita não passa pelo tradutor de leitura.
- **Fase 3** — login guarda token só em memória; **nem senha nem `sess_` aparecem em localStorage/sessionStorage** (assertions varrendo os storages); senha errada propaga a mensagem do backend; `mlFetch` gera URL do backend com `Authorization: Bearer sess_` e **zero `access_token`**; 401 → zera sessão + reabre tela de senha + erro "Sessao expirada".
- **Fase 4** — `rlPost` → `promotion-item-set` com `id` injetado e sessão; erro 409 preserva `e.status` e `e.data.cause` (formato que o log da aba Relâmpago consome); `rlDelete` → `promotion-item-remove` com os 3 parâmetros.

Varredura estática do arquivo patchado: **0** ocorrências de segredos, **0** chamadas a `api.mercadolibre.com`, **0** referências a funções removidas, chaves `ml_*` só na linha de higiene.

**CORS real (não testável deste ambiente):** valide com o dashboard já no ar, ou antes via preflight:
```bash
curl -si -X OPTIONS https://overwine-assistant.vercel.app/api/auth/login \
  -H "Origin: https://igororlandi999.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | grep -i access-control
# esperado: Access-Control-Allow-Origin: https://igororlandi999.github.io
```

## 8. Divergências vs inventário/comportamento anterior (nada silencioso)

1. **Arquivo local ≠ GitHub HEAD** (item 0) — o push levará o módulo Copiloto junto.
2. **Cancelados:** dashboard enviava `status=cancelled`; o backend envia `order.status=cancelled` (parâmetro documentado do ML). A paridade do resultado final é garantida pelo filtro client-side `filter(o => o.status === 'cancelled')` que permanece intacto; se o parâmetro antigo era ignorado pelo ML, a versão nova pode inclusive trazer cancelamentos MAIS completos. Ponto de checagem na homologação: comparar a contagem da aba Cancelamentos antes/depois.
3. **ML Ads:** cascata de 4 endpoints → só o `aggregate` (os outros 3 eram diagnóstico de console, sem alimentar UI). Já documentado na Etapa 2.1.
4. **Token manual removido:** a regra "nenhuma chamada direta autenticada ao ML" torna o fallback de token manual inviável — divergência da decisão antiga da auditoria, exigida pela sua revisão BFF.
5. **Reload pede senha:** o `ow_viewer_ok` do sessionStorage foi removido; sessão vive só em memória (trade-off aceito na revisão).
6. **Visitas com `last>150`:** antes o ML rejeitava; agora o zod do backend rejeita com 400 — mesmo caminho de falha, mensagem diferente.
7. **Auto-refresh mais resiliente:** valida a sessão antes da rajada (item 5) — melhoria dentro da camada autorizada.

## 9. Publicação após a rotação (Fase B → C, passo a passo exato)

Pré-requisito: Fase B concluída (secret rotacionado, app reautorizado, `POST /api/admin/seed` ok, `SEED_ENABLED=false`, e `GET /api/ml/reputation` com sessão devolvendo seus dados).

```bash
cd overwine-dashboard
git pull                                    # garantir base atualizada
cp index.html index.html.pre-fase-c.bak     # backup local extra (NAO commitar)
# copiar o index.html patchado por cima
git add index.html
git commit -m "feat: adiciona modulo Copiloto de Compras (analise inteligente de estoque)" --only index.html
```
Se preferir separar Copiloto do patch de segurança em dois commits, me avise que eu gero as duas versões; do contrário, um commit único com mensagem dupla:
```bash
git commit -m "refactor(security): migra auth e rede para backend BFF; remove credenciais do front

- remove CLIENT_SECRET, SHARED_TOKEN, SHARED_REFRESH, VIEWER_PASSWORD e OAuth no browser
- toda chamada ML passa pelo proxy allowlist do overwine-assistant
- sessao opaca em memoria via /api/auth/login
- inclui modulo Copiloto de Compras (pendente de push anterior)"
git push origin main
```
Depois do push: aguardar o GitHub Pages (1–2 min) → abrir `https://igororlandi999.github.io/overwine-dashboard/` em aba anônima → senha nova → conferir aba por aba (checklist de homologação: Visão Geral, Pedidos, Cancelamentos [item 8.2], Giro, Margem, Estoque Full, Relâmpago [uma inscrição de teste], Posicionamento, Consolidado) → DevTools > Network: confirmar que só há chamadas a `overwine-assistant.vercel.app` → limpar localStorage dos dispositivos antigos (a higiene do init já faz isso automaticamente no primeiro acesso) → seguir para a Fase D (filter-repo **depois** deste commit, como já combinado).

## 10. Plano de rollback

- **Antes do push:** nada a fazer — o original está em `index-ORIGINAL-backup.html` e no Git.
- **Depois do push, se algo quebrar:** `git revert HEAD && git push` (1–2 min de Pages) restaura o dashboard antigo. **Atenção:** o rollback restaura o fluxo com credenciais — só funciona se a Fase B *daquele momento* ainda não tiver revogado/rotacionado; **após a rotação, o código antigo não volta a funcionar nunca mais** (secret e refresh mortos). Nesse caso o rollback correto é para frente: corrigir o problema no patch (me acionar com o erro do console/Network) mantendo o backend. Por isso a ordem combinada — patch testado ANTES da rotação — é o que garante janela mínima.
- **Rollback do backend:** na Vercel, Deployments → deploy anterior → "Promote to Production" (instantâneo).
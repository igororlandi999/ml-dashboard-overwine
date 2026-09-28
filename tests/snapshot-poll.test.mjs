/**
 * Contrato do poll leve do snapshot de pedidos.
 *
 * O backend passou a atualizar o snapshot por notificação do Mercado Livre, em
 * segundos. Esta tela consulta `/api/orders/status` a cada 15 segundos e só
 * recarrega quando a VERSÃO do snapshot mudou — ou quando o próprio refresh
 * que ela pediu responde que publicou uma versão nova.
 *
 * O que estes testes travam, e por quê:
 *
 * 1. O poll NÃO pode chamar api.mercadolibre.com. O navegador nunca vê token
 *    do ML — essa é a regra que sustenta o backend inteiro, e um poll frequente
 *    seria o lugar mais fácil de furá-la sem ninguém notar.
 *
 * 2. O poll NÃO pode baixar pedidos. Ele existe para custar alguns bytes; se
 *    virar um `/api/orders/list` a cada 45 segundos, são milhares de pedidos
 *    por minuto, por aba aberta.
 *
 * 3. O gatilho de recarga é a comparação de `versao`, e nada mais. Recarregar
 *    por tempo decorrido devolveria o dashboard ao polling que esta fase
 *    existe para eliminar.
 *
 * Rodar: node --test tests/
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(raiz, 'index.html'), 'utf8');

/** Recorta o corpo de uma `function nome(...)`, contando chaves. */
function extrairFuncao(nome) {
  const marca = 'function ' + nome + '(';
  const ini = html.indexOf(marca);
  assert.notEqual(ini, -1, 'funcao ' + nome + ' nao encontrada em index.html');
  const i = html.indexOf('{', ini);
  let nivel = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') {
      nivel--;
      if (nivel === 0) return html.slice(ini, j + 1);
    }
  }
  throw new Error('funcao ' + nome + ' nao fecha');
}

describe('poll do snapshot — o que ele consulta', () => {
  const corpo = extrairFuncao('pollSnapshot');

  test('consulta /api/orders/status, a rota barata', () => {
    assert.match(corpo, /\/api\/orders\/status\?alvo=ativos/);
  });

  test('NAO chama api.mercadolibre.com', () => {
    assert.ok(!corpo.includes('mercadolibre.com'), 'o poll nao pode falar com o ML');
    assert.ok(!corpo.includes('mlFetch'), 'o poll nao pode usar o proxy do ML');
  });

  test('NAO baixa pedidos: nada de /api/orders/list nem metrics/margin', () => {
    for (const rota of ['/api/orders/list', '/api/orders/metrics', '/api/orders/margin']) {
      assert.ok(!corpo.includes(rota), 'o poll nao pode chamar ' + rota);
    }
  });

  test('usa backendFetch — a sessao vai no header, como em toda chamada', () => {
    assert.match(corpo, /backendFetch\(/);
    assert.ok(!/\bfetch\(\s*['"`]http/.test(corpo), 'nada de fetch direto para URL absoluta');
  });
});

describe('poll do snapshot — quando ele recarrega', () => {
  const corpo = extrairFuncao('pollSnapshot');

  /**
   * A recarga por versao nova precisa chegar aos CARDS. loadMetrics guarda o
   * agregado por periodo e devolvia o cache dentro de loadAll: o snapshot
   * avancava, a tela "recarregava", e o faturamento ficava o de antes. Foi
   * assim que o dashboard mostrou faturamento defasado com o poll funcionando.
   */
  test('loadAll invalida o cache de metricas antes de pedir de novo', () => {
    const corpo = extrairFuncao('loadAll');
    const inval = corpo.indexOf('_metricsLoadState = "idle"; _metricsPeriodoKey = null;');
    const pede = corpo.indexOf('loadMetrics(currentPeriodoDias)');
    assert.ok(inval !== -1, 'loadAll precisa invalidar o cache de metricas');
    assert.ok(pede !== -1 && inval < pede, 'a invalidacao vem ANTES do loadMetrics');
  });

  test('loadAll manda os pedidos em memoria acompanharem a versao nova, sem bloquear a tela', () => {
    const corpo = extrairFuncao('loadAll');
    assert.match(corpo, /\n\s*atualizarPedidosEmMemoria\(\)\.catch\(/);
    assert.ok(!/await\s+atualizarPedidosEmMemoria/.test(corpo), 'em segundo plano');
  });

  test('so recarrega quando a versao mudou', () => {
    assert.match(corpo, /body\.versao === _pollVersaoVista/);
    assert.match(corpo, /return;/);
    assert.match(corpo, /await loadAll\(\)/);
  });

  test('a ancora do poll NAO e a do historico completo', () => {
    // _snapVersaoAtivos so e escrita por loadAllOrders, que virou carga sob
    // demanda: depender dela deixava o poll mudo numa sessao que so abriu a
    // Visao Geral. O poll mantem a sua propria.
    assert.ok(!corpo.includes('_snapVersaoAtivos'),
      'o poll nao pode depender da ancora do historico completo');
    assert.match(corpo, /_pollVersaoVista/);
  });

  test('a primeira passada apenas ancora, sem recarregar', () => {
    assert.match(corpo, /_pollVersaoVista === null.*_pollVersaoVista = body\.versao/s);
  });

  test('versao que nao e inteiro nao dispara recarga', () => {
    assert.match(corpo, /Number\.isInteger\(body\.versao\)/);
  });

  test('nao roda sem sessao', () => {
    assert.match(corpo, /if \(!SESSION_TOKEN\) return;/);
  });

  test('nao roda em cima de uma carga ja em andamento', () => {
    assert.match(corpo, /_loadAllEmCurso/);
  });

  test('nao roda com a aba em segundo plano', () => {
    assert.match(corpo, /document\.hidden/);
  });

  test('erro de rede e silencioso — a proxima passada tenta de novo', () => {
    assert.match(corpo, /catch[\s\S]*return;/);
    assert.ok(!corpo.includes('showToast'), 'o poll nao pode encher a tela de toast');
  });
});

describe('poll do snapshot — ciclo de vida do temporizador', () => {
  test('o intervalo e de 15 segundos', () => {
    assert.match(html, /const SNAPSHOT_POLL_MS = 15 \* 1000;/);
  });

  test('o refresh de 30 minutos continua existindo como piso', () => {
    assert.match(html, /const REFRESH_INTERVAL_MS = 30 \* 60 \* 1000;/);
  });

  test('startDashboard liga o poll explicitamente, com sessao valida', () => {
    assert.match(extrairFuncao('startDashboard'), /scheduleSnapshotPoll\(\)/);
  });

  test('o poll NAO depende do ciclo de vida do refresh de 30 minutos', () => {
    // Os dois mecanismos sao independentes: um nasceu como piso de 30 min, o
    // outro precisa enxergar uma venda em segundos.
    assert.ok(!extrairFuncao('scheduleAutoRefresh').includes('scheduleSnapshotPoll'),
      'scheduleAutoRefresh nao pode ser o dono do poll');
  });

  test('sessao expirada e logout zeram a ancora do poll', () => {
    assert.match(extrairFuncao('handleSessionExpired'), /_pollVersaoVista = null;/);
    assert.match(extrairFuncao('doLogout'), /_pollVersaoVista = null;/);
  });

  test('sessao expirada desliga o poll', () => {
    assert.match(extrairFuncao('handleSessionExpired'), /clearInterval\(snapshotPollTimer\)/);
  });

  test('logout desliga o poll', () => {
    assert.match(extrairFuncao('doLogout'), /clearInterval\(snapshotPollTimer\)/);
  });

  test('scheduleSnapshotPoll nao acumula temporizadores', () => {
    const corpo = extrairFuncao('scheduleSnapshotPoll');
    assert.match(corpo, /clearInterval\(snapshotPollTimer\)/);
    assert.ok(
      corpo.indexOf('clearInterval') < corpo.indexOf('setInterval'),
      'precisa limpar ANTES de agendar'
    );
  });

  test('voltar para a aba dispara uma passada imediata, registrada uma unica vez', () => {
    const corpo = extrairFuncao('scheduleSnapshotPoll');
    assert.match(corpo, /visibilitychange/);
    assert.match(corpo, /_pollVisibilidadeLigado/);
  });
});

describe('loadAll — a bandeira que o poll observa', () => {
  const corpo = extrairFuncao('loadAll');

  test('marca a carga em curso ao comecar', () => {
    assert.match(corpo, /_loadAllEmCurso = true;/);
  });

  test('libera a bandeira num finally — falha nao pode travar o poll para sempre', () => {
    assert.match(corpo, /finally \{\s*_loadAllEmCurso = false;\s*\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * Auto-refresh: a aba pede sincronizacao quando o snapshot esta velho.
 *
 * Existe porque as duas fontes de atualizacao falharam juntas — o agendador do
 * GitHub Actions descartando quase todos os ticks e a notificacao do Mercado
 * Livre sem autenticar. O risco desta feature e carga: cada aba aberta pode
 * virar uma sincronizacao. Por isso os testes olham principalmente os freios.
 */
describe('auto-refresh — quando a aba pede sincronizacao', () => {
  const corpo = extrairFuncao('pedirRefreshSeVelho');
  const idade = extrairFuncao('_idadeDoUltimoCheck');

  test('chama POST /api/orders/refresh, e so isso', () => {
    assert.match(corpo, /backendFetch\('\/api\/orders\/refresh', \{ method: 'POST'/);
  });

  test('NAO fala com o Mercado Livre', () => {
    assert.ok(!corpo.includes('mercadolibre'), 'o navegador nunca fala com o ML');
    assert.ok(!corpo.includes('/api/ml/'), 'nem pelo proxy');
  });

  test('NAO baixa pedidos por conta propria: so recarrega (loadAll) quando o backend PUBLICOU', () => {
    for (const rota of ['/api/orders/list', '/api/orders/metrics', '/api/orders/margin']) {
      assert.ok(!corpo.includes(rota), 'refresh nao pode chamar ' + rota);
    }
    // A recarga imediata existe, mas e condicionada: publicou === true, versao
    // inteira, diferente da ja vista, e nenhuma carga em curso.
    assert.match(corpo, /r\.publicou === true && Number\.isInteger\(r\.versao\)/);
    assert.match(corpo, /publicouVersao !== null && publicouVersao !== _pollVersaoVista && !_loadAllEmCurso/);
    assert.match(corpo, /_pollVersaoVista = publicouVersao;\s*await loadAll\(\);/);
  });

  test('nao aguarda o resultado para liberar o poll', () => {
    // pollSnapshot dispara sem await: a deteccao vem da rodada seguinte.
    const poll = extrairFuncao('pollSnapshot');
    assert.match(poll, /\n\s*pedirRefreshSeVelho\(body\);/);
    assert.ok(!/await\s+pedirRefreshSeVelho/.test(poll), 'nao pode aguardar o refresh');
  });

  test('freio: nao dispara com refresh em curso', () => {
    assert.match(corpo, /if \(_refreshEmCurso\) return;/);
  });

  test('freio: cooldown local entre chamadas', () => {
    assert.match(corpo, /_ultimoRefreshMs < REFRESH_COOLDOWN_LOCAL_MS/);
    assert.match(html, /const REFRESH_COOLDOWN_LOCAL_MS = 15 \* 1000;/);
  });

  test('freio: so acima do limite de idade — o mesmo do backend (25s)', () => {
    assert.match(corpo, /idade <= SNAPSHOT_IDADE_MAX_S/);
    assert.match(html, /const SNAPSHOT_IDADE_MAX_S = 25;/);
  });

  test('libera a bandeira num finally — falha nao trava o mecanismo', () => {
    assert.match(corpo, /finally \{\s*_refreshEmCurso = false;/);
  });

  test('erro de rede e silencioso: sem toast, sem quebrar o poll', () => {
    assert.ok(!corpo.includes('showToast'), 'nada de toast no caminho automatico');
  });

  test('a idade vem de lastSyncAt (quando checou), nao de updatedAt (quando mudou)', () => {
    assert.match(idade, /body\.lastSyncAt/);
    assert.ok(!idade.includes('updatedAt'), 'updatedAt fica parado em dia sem venda');
    assert.match(idade, /body\.idadeSegundos/); // fallback conservador
  });

  test('a idade prefere o relogio do SERVIDOR (idadeCheckSegundos) ao relogio do PC', () => {
    // Um PC com o relogio errado nao pode fazer a aba pedir sincronizacao sem
    // parar (adiantado) nem nunca (atrasado).
    assert.match(idade, /^[^]*?if \(Number\.isFinite\(body\.idadeCheckSegundos\)\) return body\.idadeCheckSegundos;/);
    assert.ok(idade.indexOf('idadeCheckSegundos') < idade.indexOf('lastSyncAt'), 'servidor primeiro');
  });
});

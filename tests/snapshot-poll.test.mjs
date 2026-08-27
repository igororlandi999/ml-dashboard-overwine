/**
 * Contrato do poll leve do snapshot de pedidos.
 *
 * O backend passou a atualizar o snapshot por notificação do Mercado Livre, em
 * segundos. Esta tela consulta `/api/orders/status` a cada 45 segundos e só
 * recarrega quando a VERSÃO do snapshot mudou.
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

  test('so recarrega quando a versao mudou', () => {
    assert.match(corpo, /body\.versao === _snapVersaoAtivos/);
    assert.match(corpo, /return;/);
    assert.match(corpo, /await loadAll\(\)/);
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
  test('o intervalo e de 45 segundos', () => {
    assert.match(html, /const SNAPSHOT_POLL_MS = 45 \* 1000;/);
  });

  test('o refresh de 30 minutos continua existindo como piso', () => {
    assert.match(html, /const REFRESH_INTERVAL_MS = 30 \* 60 \* 1000;/);
  });

  test('scheduleAutoRefresh liga o poll', () => {
    assert.match(extrairFuncao('scheduleAutoRefresh'), /scheduleSnapshotPoll\(\)/);
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

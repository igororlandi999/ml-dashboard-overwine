/**
 * Ciclo de vida do poll do snapshot — testes de COMPORTAMENTO.
 *
 * O arquivo irmao (snapshot-poll.test.mjs) trava o contrato lendo o codigo
 * fonte. Ele passou verde enquanto, em producao, o poll nao emitia uma unica
 * chamada a /api/orders/status: as funcoes existiam, estavam escritas certas, e
 * mesmo assim o mecanismo estava mudo. A causa foi um guard de prontidao
 * (`_snapVersaoAtivos === null`) que so seria satisfeito por uma carga que
 * deixou de acontecer no login.
 *
 * Ler o fonte nao pega esse tipo de falha. Estes testes EXECUTAM as funcoes,
 * com temporizadores e rede falsos, e afirmam o que sai do outro lado:
 * quantas chamadas, para onde, em que ordem, quantos temporizadores vivos.
 *
 * Rodar: node --test tests/*.test.mjs
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
  const achado = html.indexOf(marca);
  assert.notEqual(achado, -1, 'funcao ' + nome + ' nao encontrada em index.html');
  // `async` faz parte da funcao: recortar sem ele produz um corpo com `await`
  // solto, que nem compila. O sandbox precisa da declaracao inteira.
  const ini = html.slice(achado - 6, achado) === 'async ' ? achado - 6 : achado;
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

/** Le uma constante do fonte: o teste nao pode ter a sua propria verdade. */
function extrairConstante(nome) {
  const m = html.match(new RegExp('const ' + nome + ' = ([^;]+);'));
  assert.ok(m, 'constante ' + nome + ' nao encontrada');
  return m[0];
}

/** Deixa a fila de microtasks (e o fetch falso) terminar. */
const drenar = () => new Promise(r => setTimeout(r, 0));

/**
 * Monta um ambiente isolado com as funcoes REAIS do dashboard e dependencias
 * falsas. Devolve tambem os registradores, que sao a evidencia dos testes.
 */
function montarAmbiente({ sessao = 'tok', hidden = false, versao = 7, lastSyncAt = null } = {}) {
  const chamadas = [];          // toda chamada de rede, em ordem
  const recargas = [];          // toda chamada a loadAll
  const timers = new Map();     // id -> { fn, ms }  — somente os VIVOS
  const ouvintes = {};
  let proximoId = 1;
  let resposta = { versao, lastSyncAt };

  const doc = {
    hidden,
    addEventListener(tipo, fn) { ouvintes[tipo] = fn; }
  };

  const fakeSetInterval = (fn, ms) => { const id = proximoId++; timers.set(id, { fn, ms }); return id; };
  const fakeClearInterval = (id) => { timers.delete(id); };

  async function backendFetch(caminho, init) {
    chamadas.push({ caminho, metodo: (init && init.method) || 'GET' });
    if (caminho.indexOf('/api/orders/status') === 0) {
      return { ok: true, status: 200, json: async () => Object.assign({}, resposta) };
    }
    return { ok: true, status: 200, json: async () => ({ acao: 'incremental' }) };
  }

  async function loadAll() { recargas.push(Date.now()); }

  const fonte = [
    extrairConstante('SNAPSHOT_POLL_MS'),
    extrairConstante('SNAPSHOT_IDADE_MAX_S'),
    extrairConstante('REFRESH_COOLDOWN_LOCAL_MS'),
    'let snapshotPollTimer = null;',
    'let _pollVisibilidadeLigado = false;',
    'let _pollVersaoVista = null;',
    'let _refreshEmCurso = false;',
    'let _ultimoRefreshMs = 0;',
    'let _loadAllEmCurso = false;',
    'let SESSION_TOKEN = _sessaoInicial;',
    extrairFuncao('scheduleSnapshotPoll'),
    extrairFuncao('pollSnapshot'),
    extrairFuncao('pedirRefreshSeVelho'),
    extrairFuncao('_idadeDoUltimoCheck'),
    'return {',
    '  scheduleSnapshotPoll: scheduleSnapshotPoll,',
    '  pollSnapshot: pollSnapshot,',
    '  encerrarSessao: function () { SESSION_TOKEN = null; },',
    '  estado: function () { return { timerId: snapshotPollTimer, versaoVista: _pollVersaoVista }; },',
    '  intervalo: function () { return SNAPSHOT_POLL_MS; }',
    '};'
  ].join('\n');

  const api = new Function(
    '_sessaoInicial', 'document', 'backendFetch', 'loadAll',
    'setInterval', 'clearInterval', 'console',
    fonte
  )(sessao, doc, backendFetch, loadAll, fakeSetInterval, fakeClearInterval,
    { info: function () { }, warn: function () { }, error: function () { } });

  return Object.assign({}, api, {
    chamadas, recargas, timers, doc,
    disparaVisibilidade: () => ouvintes.visibilitychange && ouvintes.visibilitychange(),
    temOuvinteVisibilidade: () => typeof ouvintes.visibilitychange === 'function',
    responderCom: (nova) => { resposta = Object.assign({}, resposta, nova); },
    /** Executa o callback do temporizador vivo, como faria o navegador. */
    avancar45s: async () => {
      for (const t of [...timers.values()]) t.fn();
      await drenar();
    }
  });
}

const status = (c) => c.filter(x => x.caminho.indexOf('/api/orders/status') === 0);
const refresh = (c) => c.filter(x => x.caminho === '/api/orders/refresh');
const segundosAtras = (s) => new Date(Date.now() - s * 1000).toISOString();

describe('inicializacao — o poll nao pode nascer morto', () => {
  test('sondagem IMEDIATA: nao se espera 45s para saber se o mecanismo vive', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(status(amb.chamadas).length, 1,
      'scheduleSnapshotPoll tem de sondar na hora');
  });

  test('depois da sondagem imediata, roda a cada 45 segundos', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.intervalo(), 45 * 1000);
    assert.equal([...amb.timers.values()][0].ms, 45 * 1000);

    await amb.avancar45s();
    assert.equal(status(amb.chamadas).length, 2);
    await amb.avancar45s();
    assert.equal(status(amb.chamadas).length, 3);
  });

  test('a sondagem imediata NAO bloqueia quem ligou o poll', () => {
    const amb = montarAmbiente();
    const retorno = amb.scheduleSnapshotPoll();
    // Sincrono: quem chamou segue a vida sem nada para aguardar, e o
    // temporizador ja esta armado antes de a resposta chegar.
    assert.equal(retorno, undefined, 'nao devolve promessa para aguardar');
    assert.equal(amb.timers.size, 1, 'o temporizador ja esta armado no retorno');
    assert.equal(amb.recargas.length, 0, 'nada foi recarregado ainda');
  });

  test('o poll parte SEM historico carregado — o guard antigo o deixava mudo', async () => {
    // Regressao direta do incidente: em producao a sessao so abriu a Visao
    // Geral, loadAllOrders nunca rodou, e nenhuma chamada a status saiu.
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(status(amb.chamadas).length, 1);
  });
});

describe('idempotencia — nunca dois temporizadores', () => {
  test('chamar duas vezes deixa exatamente um temporizador vivo', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    const primeiro = amb.estado().timerId;
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.timers.size, 1, 'nao pode acumular temporizador');
    assert.notEqual(amb.estado().timerId, primeiro, 'o antigo foi limpo');
  });

  test('dez chamadas seguidas continuam com um so temporizador', async () => {
    const amb = montarAmbiente();
    for (let i = 0; i < 10; i++) amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.timers.size, 1);
    await amb.avancar45s();
    // Uma unica passada por tick: dez temporizadores dariam dez chamadas.
    assert.equal(status(amb.chamadas).length, 11, '10 sondagens imediatas + 1 do tick');
  });

  test('o ouvinte de visibilidade e registrado uma unica vez', () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    amb.scheduleSnapshotPoll();
    assert.ok(amb.temOuvinteVisibilidade());
  });
});

describe('visibilidade — hidden adia a sondagem, nunca a inicializacao', () => {
  test('aba em segundo plano: temporizador armado, sem sondar', async () => {
    const amb = montarAmbiente({ hidden: true });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.timers.size, 1, 'o mecanismo tem de existir para quando a aba voltar');
    assert.equal(status(amb.chamadas).length, 0, 'aba oculta nao consome rede');
  });

  test('voltar para visible sonda na hora e garante o temporizador armado', async () => {
    const amb = montarAmbiente({ hidden: true });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(status(amb.chamadas).length, 0);

    amb.doc.hidden = false;
    amb.disparaVisibilidade();
    await drenar();
    assert.equal(status(amb.chamadas).length, 1, 'voltar a aba nao espera 45s');
    assert.equal(amb.timers.size, 1, 'segue com um unico temporizador');
  });

  test('ir para hidden nao dispara sondagem', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    const antes = status(amb.chamadas).length;
    amb.doc.hidden = true;
    amb.disparaVisibilidade();
    await drenar();
    assert.equal(status(amb.chamadas).length, antes);
  });
});

describe('sessao — sem token, nada sai', () => {
  test('sem sessao o poll nao chama o backend', async () => {
    const amb = montarAmbiente({ sessao: null });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.chamadas.length, 0);
  });

  test('sessao encerrada no meio do caminho para as sondagens seguintes', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(status(amb.chamadas).length, 1);
    amb.encerrarSessao();
    await amb.avancar45s();
    assert.equal(status(amb.chamadas).length, 1, 'nao insiste sem sessao');
  });
});

describe('recarga — so quando a versao do snapshot muda', () => {
  test('primeira passada apenas ancora, sem recarregar a tela', async () => {
    const amb = montarAmbiente({ versao: 7 });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.recargas.length, 0);
    assert.equal(amb.estado().versaoVista, 7);
  });

  test('versao igual nas passadas seguintes nao recarrega', async () => {
    const amb = montarAmbiente({ versao: 7 });
    amb.scheduleSnapshotPoll();
    await drenar();
    await amb.avancar45s();
    await amb.avancar45s();
    assert.equal(amb.recargas.length, 0);
  });

  test('versao nova recarrega uma unica vez', async () => {
    const amb = montarAmbiente({ versao: 7 });
    amb.scheduleSnapshotPoll();
    await drenar();
    amb.responderCom({ versao: 8 });
    await amb.avancar45s();
    assert.equal(amb.recargas.length, 1);
    await amb.avancar45s();
    assert.equal(amb.recargas.length, 1, 'a versao ja foi absorvida');
  });
});

describe('auto-refresh — o freio de idade e a regra que segura carga', () => {
  test('snapshot recem checado NAO pede sincronizacao', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(30) });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(refresh(amb.chamadas).length, 0, '30s esta dentro do limite de 90s');
  });

  test('snapshot com mais de 90s pede sincronizacao, via POST', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200) });
    amb.scheduleSnapshotPoll();
    await drenar();
    const r = refresh(amb.chamadas);
    assert.equal(r.length, 1);
    assert.equal(r[0].metodo, 'POST');
  });

  test('na fronteira de 90s ainda nao pede', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(89) });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(refresh(amb.chamadas).length, 0);
  });

  test('cooldown local: duas passadas seguidas dao uma unica sincronizacao', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200) });
    amb.scheduleSnapshotPoll();
    await drenar();
    await amb.avancar45s();
    assert.equal(refresh(amb.chamadas).length, 1, 'o cooldown de 60s segura a segunda');
  });

  test('sem lastSyncAt e sem idadeSegundos nao ha gatilho', async () => {
    const amb = montarAmbiente({ lastSyncAt: null });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(refresh(amb.chamadas).length, 0);
  });

  test('o refresh nao atrasa a sondagem seguinte', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200) });
    amb.scheduleSnapshotPoll();
    await drenar();
    await amb.avancar45s();
    assert.equal(status(amb.chamadas).length, 2, 'o poll seguiu no ritmo');
  });
});

describe('fronteira do navegador — o ML continua atras do backend', () => {
  test('nenhuma chamada sai para api.mercadolibre.com', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200), versao: 7 });
    amb.scheduleSnapshotPoll();
    await drenar();
    amb.responderCom({ versao: 8 });
    await amb.avancar45s();
    for (const c of amb.chamadas) {
      assert.ok(c.caminho.indexOf('mercadolibre') === -1, 'o navegador nunca fala com o ML');
      assert.ok(c.caminho.indexOf('/api/ml/') !== 0, 'nem pelo proxy');
    }
  });

  test('o poll so consulta status e, no maximo, pede refresh', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200) });
    amb.scheduleSnapshotPoll();
    await drenar();
    const rotas = [...new Set(amb.chamadas.map(c => c.caminho.split('?')[0]))].sort();
    assert.deepEqual(rotas, ['/api/orders/refresh', '/api/orders/status']);
  });
});

describe('entrada no dashboard — os caminhos que ligam o poll', () => {
  test('login manual termina em startDashboard, que liga o poll', () => {
    assert.match(extrairFuncao('checkViewerPass'), /await startDashboard\(\)/);
    assert.match(extrairFuncao('startDashboard'), /scheduleSnapshotPoll\(\)/);
  });

  test('a sessao vive so em memoria: nao existe restauracao silenciosa', () => {
    // Se um dia passar a existir, este teste quebra e obriga a ligar o poll la
    // tambem — que e exatamente o buraco que este hotfix fecha.
    const init = html.slice(html.indexOf("window.addEventListener('DOMContentLoaded'"));
    const corpo = init.slice(0, init.indexOf('\n    });'));
    assert.ok(!corpo.includes('startDashboard'),
      'carregamento nao entra no dashboard sozinho');
    assert.match(corpo, /showSetup\(\)/);
  });

  test('o poll e ligado depois da carga inicial, com sessao ja validada', () => {
    const corpo = extrairFuncao('startDashboard');
    assert.ok(corpo.indexOf('await loadAll()') < corpo.indexOf('scheduleSnapshotPoll()'),
      'primeiro a carga inicial, depois o poll');
  });
});

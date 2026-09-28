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
function montarAmbiente({
  sessao = 'tok', hidden = false, versao = 7, lastSyncAt = null,
  idadeCheckSegundos, updatedAt = null, newestDate = null, refreshResposta = null,
} = {}) {
  const chamadas = [];          // toda chamada de rede, em ordem
  const recargas = [];          // toda chamada a loadAll
  const timers = new Map();     // id -> { fn, ms }  — somente os VIVOS
  const ouvintes = {};
  let proximoId = 1;
  let resposta = { versao, lastSyncAt, updatedAt, newestDate };
  if (idadeCheckSegundos !== undefined) resposta.idadeCheckSegundos = idadeCheckSegundos;
  let respostaRefresh = refreshResposta || { ok: true, acao: 'sincronizado', modo: 'rapido', publicou: false, versao };

  /** O elemento do cabecalho onde o indicador escreve. */
  const indicador = { textContent: '', style: {}, title: '' };
  const doc = {
    hidden,
    addEventListener(tipo, fn) { ouvintes[tipo] = fn; },
    getElementById(id) { return id === 'last-update' ? indicador : null; }
  };

  const fakeSetInterval = (fn, ms) => { const id = proximoId++; timers.set(id, { fn, ms }); return id; };
  const fakeClearInterval = (id) => { timers.delete(id); };

  async function backendFetch(caminho, init) {
    chamadas.push({ caminho, metodo: (init && init.method) || 'GET' });
    if (caminho.indexOf('/api/orders/status') === 0) {
      return { ok: true, status: 200, json: async () => Object.assign({}, resposta) };
    }
    if (respostaRefresh === 'pendente') return new Promise(() => {});   // nunca resolve
    return { ok: true, status: 200, json: async () => Object.assign({}, respostaRefresh) };
  }

  async function loadAll() { recargas.push(Date.now()); }

  const fonte = [
    extrairConstante('SNAPSHOT_POLL_MS'),
    extrairConstante('SNAPSHOT_IDADE_MAX_S'),
    extrairConstante('REFRESH_COOLDOWN_LOCAL_MS'),
    extrairConstante('PEDIDOS_ATRASO_AVISO_S'),
    'let snapshotPollTimer = null;',
    'let _pollVisibilidadeLigado = false;',
    'let _pollVersaoVista = null;',
    'let _refreshEmCurso = false;',
    'let _ultimoRefreshMs = 0;',
    'let _loadAllEmCurso = false;',
    'let _pedidosCheckRecebidoEmMs = 0;',
    'let _pedidosIdadeCheckS = null;',
    'let _pedidosIndicadorTimer = null;',
    'let _ultimoNewestDate = null;',
    'let _ultimoUpdatedAt = null;',
    'let _ultimoPartial = false;',
    'let SESSION_TOKEN = _sessaoInicial;',
    extrairFuncao('scheduleSnapshotPoll'),
    extrairFuncao('scheduleIndicadorPedidos'),
    extrairFuncao('pollSnapshot'),
    extrairFuncao('pedirRefreshSeVelho'),
    extrairFuncao('_idadeDoUltimoCheck'),
    extrairFuncao('registrarStatusPedidos'),
    extrairFuncao('_idadePedidosAgoraS'),
    extrairFuncao('atualizarIndicadorPedidos'),
    'return {',
    '  scheduleSnapshotPoll: scheduleSnapshotPoll,',
    '  pollSnapshot: pollSnapshot,',
    '  atualizarIndicadorPedidos: atualizarIndicadorPedidos,',
    '  encerrarSessao: function () { SESSION_TOKEN = null; },',
    '  estado: function () { return { timerId: snapshotPollTimer, versaoVista: _pollVersaoVista, refreshEmCurso: _refreshEmCurso }; },',
    '  intervalo: function () { return SNAPSHOT_POLL_MS; }',
    '};'
  ].join('\n');

  const api = new Function(
    '_sessaoInicial', 'document', 'backendFetch', 'loadAll',
    'setInterval', 'clearInterval', 'console',
    fonte
  )(sessao, doc, backendFetch, loadAll, fakeSetInterval, fakeClearInterval,
    { info: function () { }, warn: function () { }, error: function () { } });

  /** So os temporizadores do POLL — o indicador tem o seu proprio, de 1s. */
  const pollTimers = () => [...timers.values()].filter(t => t.ms === api.intervalo());

  return Object.assign({}, api, {
    chamadas, recargas, timers, doc, indicador,
    pollTimers,
    disparaVisibilidade: () => ouvintes.visibilitychange && ouvintes.visibilitychange(),
    temOuvinteVisibilidade: () => typeof ouvintes.visibilitychange === 'function',
    responderCom: (nova) => { resposta = Object.assign({}, resposta, nova); },
    responderRefreshCom: (nova) => { respostaRefresh = Object.assign({}, respostaRefresh, nova); },
    /** Executa o callback do temporizador do poll, como faria o navegador. */
    avancarTick: async () => {
      for (const t of pollTimers()) t.fn();
      await drenar();
      await drenar();
    }
  });
}

const status = (c) => c.filter(x => x.caminho.indexOf('/api/orders/status') === 0);
const refresh = (c) => c.filter(x => x.caminho === '/api/orders/refresh');
const segundosAtras = (s) => new Date(Date.now() - s * 1000).toISOString();

describe('inicializacao — o poll nao pode nascer morto', () => {
  test('sondagem IMEDIATA: nao se espera 15s para saber se o mecanismo vive', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(status(amb.chamadas).length, 1,
      'scheduleSnapshotPoll tem de sondar na hora');
  });

  test('depois da sondagem imediata, roda a cada 15 segundos', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.intervalo(), 15 * 1000);
    assert.equal(amb.pollTimers()[0].ms, 15 * 1000);

    await amb.avancarTick();
    assert.equal(status(amb.chamadas).length, 2);
    await amb.avancarTick();
    assert.equal(status(amb.chamadas).length, 3);
  });

  test('o poll continua vivo por muitas rodadas: uma sondagem por tick, sem acumular', async () => {
    const amb = montarAmbiente();
    amb.scheduleSnapshotPoll();
    await drenar();
    for (let i = 0; i < 40; i++) await amb.avancarTick();   // 10 minutos de aba aberta
    assert.equal(status(amb.chamadas).length, 41);
    assert.equal(amb.pollTimers().length, 1);
    assert.equal(amb.recargas.length, 0, 'versao igual o tempo todo: nada recarregado');
  });

  test('a sondagem imediata NAO bloqueia quem ligou o poll', () => {
    const amb = montarAmbiente();
    const retorno = amb.scheduleSnapshotPoll();
    // Sincrono: quem chamou segue a vida sem nada para aguardar, e o
    // temporizador ja esta armado antes de a resposta chegar.
    assert.equal(retorno, undefined, 'nao devolve promessa para aguardar');
    assert.equal(amb.pollTimers().length, 1, 'o temporizador ja esta armado no retorno');
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
    assert.equal(amb.pollTimers().length, 1, 'nao pode acumular temporizador');
    assert.notEqual(amb.estado().timerId, primeiro, 'o antigo foi limpo');
  });

  test('dez chamadas seguidas continuam com um so temporizador', async () => {
    const amb = montarAmbiente();
    for (let i = 0; i < 10; i++) amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.pollTimers().length, 1);
    await amb.avancarTick();
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
    assert.equal(amb.pollTimers().length, 1, 'o mecanismo tem de existir para quando a aba voltar');
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
    assert.equal(amb.pollTimers().length, 1, 'segue com um unico temporizador');
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
    await amb.avancarTick();
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
    await amb.avancarTick();
    await amb.avancarTick();
    assert.equal(amb.recargas.length, 0);
  });

  test('versao nova recarrega uma unica vez', async () => {
    const amb = montarAmbiente({ versao: 7 });
    amb.scheduleSnapshotPoll();
    await drenar();
    amb.responderCom({ versao: 8 });
    await amb.avancarTick();
    assert.equal(amb.recargas.length, 1);
    await amb.avancarTick();
    assert.equal(amb.recargas.length, 1, 'a versao ja foi absorvida');
  });
});

describe('auto-refresh — o freio de idade e a regra que segura carga', () => {
  test('snapshot recem checado NAO pede sincronizacao', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(10) });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(refresh(amb.chamadas).length, 0, '10s esta dentro do limite de 25s');
  });

  test('snapshot com mais de 25s pede sincronizacao, via POST', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200) });
    amb.scheduleSnapshotPoll();
    await drenar();
    const r = refresh(amb.chamadas);
    assert.equal(r.length, 1);
    assert.equal(r[0].metodo, 'POST');
  });

  test('na fronteira de 25s ainda nao pede', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(24) });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(refresh(amb.chamadas).length, 0);
  });

  test('cooldown local: duas passadas seguidas dao uma unica sincronizacao', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200) });
    amb.scheduleSnapshotPoll();
    await drenar();
    await amb.avancarTick();
    assert.equal(refresh(amb.chamadas).length, 1, 'o cooldown local de 15s segura a segunda');
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
    await amb.avancarTick();
    assert.equal(status(amb.chamadas).length, 2, 'o poll seguiu no ritmo');
  });

  /**
   * O relogio do PC do operador nao pode decidir. `idadeCheckSegundos` vem
   * calculado pelo servidor; `lastSyncAt` so serve de fallback para backend
   * antigo, sem o campo.
   */
  test('idadeCheckSegundos (servidor) vence lastSyncAt (relogio local): fresco', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200), idadeCheckSegundos: 5 });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(refresh(amb.chamadas).length, 0, 'o servidor diz 5s: nao pede');
  });

  test('idadeCheckSegundos (servidor) vence lastSyncAt (relogio local): velho', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(5), idadeCheckSegundos: 200 });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(refresh(amb.chamadas).length, 1, 'o servidor diz 200s: pede');
  });
});

describe('auto-refresh — a resposta do backend e aproveitada', () => {
  test('refresh que PUBLICOU recarrega no ato, uma vez, e ancora a versao nova', async () => {
    const amb = montarAmbiente({
      lastSyncAt: segundosAtras(200), versao: 7,
      refreshResposta: { ok: true, acao: 'sincronizado', modo: 'rapido', publicou: true, versao: 8, novosPedidos: 1 },
    });
    amb.scheduleSnapshotPoll();
    await drenar(); await drenar();
    assert.equal(amb.recargas.length, 1, 'recarregou sem esperar o proximo poll');
    assert.equal(amb.estado().versaoVista, 8);

    // O poll seguinte ve a versao 8 no status: ja conhecida, nada a fazer.
    amb.responderCom({ versao: 8, idadeCheckSegundos: 3 });
    await amb.avancarTick();
    assert.equal(amb.recargas.length, 1, 'nao recarrega duas vezes a mesma versao');
  });

  test('refresh sem publicar (sem_novos) nao recarrega', async () => {
    const amb = montarAmbiente({
      lastSyncAt: segundosAtras(200),
      refreshResposta: { ok: true, acao: 'sincronizado', modo: 'rapido', publicou: false, versao: 7, motivo: 'sem_novos' },
    });
    amb.scheduleSnapshotPoll();
    await drenar(); await drenar();
    assert.equal(amb.recargas.length, 0);
  });

  test('refresh em cooldown / fresco / erro nao recarrega nem quebra o poll', async () => {
    for (const r of [{ ok: true, acao: 'cooldown', versao: 7 }, { ok: true, acao: 'fresco', idadeSegundos: 3, versao: 7 }, { ok: false, acao: 'erro', modo: 'rapido', versao: 7 }]) {
      const amb = montarAmbiente({ lastSyncAt: segundosAtras(200), refreshResposta: r });
      amb.scheduleSnapshotPoll();
      await drenar(); await drenar();
      assert.equal(amb.recargas.length, 0, JSON.stringify(r));
      assert.equal(amb.estado().refreshEmCurso, false);
      await amb.avancarTick();
      assert.equal(status(amb.chamadas).length, 2, 'o poll seguiu');
    }
  });

  test('versao nova vinda pelo STATUS (webhook/reconciliacao publicou) continua recarregando', async () => {
    const amb = montarAmbiente({ versao: 7, idadeCheckSegundos: 3 });
    amb.scheduleSnapshotPoll();
    await drenar();
    amb.responderCom({ versao: 9 });
    await amb.avancarTick();
    assert.equal(amb.recargas.length, 1);
    assert.equal(amb.estado().versaoVista, 9);
  });
});

describe('aba em segundo plano e de volta', () => {
  test('hidden: nao sonda; ao voltar, sonda na hora e pede refresh se estiver velho', async () => {
    const amb = montarAmbiente({ hidden: true, lastSyncAt: segundosAtras(200) });
    amb.scheduleSnapshotPoll();
    await drenar();
    await amb.avancarTick();
    assert.equal(amb.chamadas.length, 0, 'em segundo plano nada sai');

    amb.doc.hidden = false;
    amb.disparaVisibilidade();
    await drenar(); await drenar();
    assert.equal(status(amb.chamadas).length, 1, 'sondou ao voltar');
    assert.equal(refresh(amb.chamadas).length, 1, 'e pediu sincronizacao, porque estava velho');
    assert.equal(amb.pollTimers().length, 1, 'um so temporizador de poll');
  });
});

describe('indicador "Pedidos atualizados ha Ns"', () => {
  test('mostra a idade do CHECK vinda do servidor, e a hora da VENDA (newestDate), nao a da publicacao', async () => {
    // Venda as 08:43, snapshot publicado as 08:48: a tela tem de dizer 08:43,
    // a mesma hora que a aba Pedidos mostra para o pedido.
    const venda = new Date(); venda.setHours(8, 43, 0, 0);
    const publicacao = new Date(); publicacao.setHours(8, 48, 0, 0);
    const amb = montarAmbiente({ idadeCheckSegundos: 12, updatedAt: publicacao.toISOString(), newestDate: venda.toISOString() });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.match(amb.indicador.textContent, /^Pedidos atualizados h\u00e1 12s/);
    assert.match(amb.indicador.textContent, /\u00faltima venda 08:43$/);
    assert.ok(!amb.indicador.textContent.includes('08:48'), 'a hora da publicacao nao e a hora da venda');
    assert.equal(amb.indicador.style.color, '');
  });

  test('sem newestDate (backend antigo) cai para a hora da publicacao, rotulada como registro', async () => {
    const amb = montarAmbiente({ idadeCheckSegundos: 12, updatedAt: '2026-09-23T17:00:00.000Z' });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.match(amb.indicador.textContent, /\u00faltima venda registrada \d\d:\d\d$/);
  });

  test('"agora" abaixo de 5s, minutos acima de 60s', async () => {
    const a = montarAmbiente({ idadeCheckSegundos: 2 });
    a.scheduleSnapshotPoll(); await drenar();
    assert.match(a.indicador.textContent, /^Pedidos atualizados agora/);
    // cooldown: o refresh nao zera a idade, entao o texto reflete os 95s do servidor
    const b = montarAmbiente({ idadeCheckSegundos: 95, refreshResposta: { ok: true, acao: 'cooldown', versao: 7 } });
    b.scheduleSnapshotPoll(); await drenar();
    assert.match(b.indicador.textContent, /^Pedidos atualizados h\u00e1 1min/);
  });

  test('check com mais de 3 minutos vira aviso de atraso, em ambar', async () => {
    const amb = montarAmbiente({ idadeCheckSegundos: 400, refreshResposta: { ok: true, acao: 'cooldown', versao: 7 } });
    amb.scheduleSnapshotPoll();
    await drenar(); await drenar();
    assert.match(amb.indicador.textContent, /^Pedidos atrasados h\u00e1 6min \u2014 tentando sincronizar/);
    assert.equal(amb.indicador.style.color, 'var(--amber)');
  });

  test('enquanto o refresh esta em voo, mostra "Sincronizando"', async () => {
    const amb = montarAmbiente({ idadeCheckSegundos: 200, refreshResposta: 'pendente' });
    amb.scheduleSnapshotPoll();
    await drenar();
    assert.equal(amb.estado().refreshEmCurso, true, 'o refresh ficou pendurado');
    amb.atualizarIndicadorPedidos();
    assert.equal(amb.indicador.textContent, 'Sincronizando pedidos...');
  });

  test('depois de um refresh bem sucedido a idade volta a zero sem esperar o proximo status', async () => {
    const amb = montarAmbiente({ idadeCheckSegundos: 200 });
    amb.scheduleSnapshotPoll();
    await drenar(); await drenar();
    assert.match(amb.indicador.textContent, /^Pedidos atualizados agora/);
  });
});

describe('fronteira do navegador — o ML continua atras do backend', () => {
  test('nenhuma chamada sai para api.mercadolibre.com', async () => {
    const amb = montarAmbiente({ lastSyncAt: segundosAtras(200), versao: 7 });
    amb.scheduleSnapshotPoll();
    await drenar();
    amb.responderCom({ versao: 8 });
    await amb.avancarTick();
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

/**
 * A aba Pedidos guardava o historico da primeira carga para sempre: a versao
 * avancava, os cards mudavam, e a tabela ficava a de antes. Estes testes
 * executam `atualizarPedidosEmMemoria` com rede falsa e afirmam o que sai.
 */
function montarPedidos({ allOrders = [], snapVersao = 3, previewState = 'idle', status = {}, pagina = null, abaAtiva = true } = {}) {
  const chamadas = [];
  const renders = [];
  const estado = { allOrders, snapVersao, previewState, preview: [{ id: 1 }], previewVersao: 3, forceLoads: 0, updatedAt: null, newestDate: null };
  const st = Object.assign({ versao: 3, origem: 'dashboard_refresh', updatedAt: '2026-09-25T12:00:00.000Z', newestDate: '2026-09-25T11:43:00.000Z' }, status);
  async function backendFetch(caminho) {
    chamadas.push(caminho);
    if (caminho.indexOf('/api/orders/status') === 0) return { ok: true, json: async () => st };
    if (caminho.indexOf('/api/orders/list') === 0) return { ok: !!pagina, json: async () => pagina };
    return { ok: false, json: async () => ({}) };
  }
  const doc = { getElementById: (id) => id === 'tab-pedidos' ? { classList: { contains: () => abaAtiva } } : null };
  const fonte = [
    extrairConstante('ORDERS_PAGE_SIZE'),
    'let allOrders = _e.allOrders;',
    'let _snapVersaoAtivos = _e.snapVersao;',
    'let ordersPreviewState = _e.previewState;',
    'let ordersPreview = _e.preview;',
    'let _ordersPreviewVersao = _e.previewVersao;',
    'let _ultimoUpdatedAt = null; let _ultimoPartial = false; let _ultimoNewestDate = null;',
    'function pedidosEmMemoria() { return Array.isArray(allOrders) && allOrders.length > 0; }',
    'async function loadAllOrders(o) { _e.forceLoads++; allOrders = [{ id: "full" }]; _snapVersaoAtivos = 99; }',
    'function renderPedidosKPIs() { _r.push("kpis"); }',
    'function renderPedidos() { _r.push("pedidos"); }',
    extrairFuncao('atualizarPedidosEmMemoria'),
    'return { run: atualizarPedidosEmMemoria, estado: () => ({ allOrders, _snapVersaoAtivos, ordersPreviewState, ordersPreview, _ordersPreviewVersao, _ultimoNewestDate, _ultimoUpdatedAt }) };',
  ].join('\n');
  const api = new Function('_e', '_r', 'document', 'backendFetch', 'console', fonte)(estado, renders, doc, backendFetch, { info() {}, warn() {} });
  return Object.assign(api, { chamadas, renders, interno: estado });
}

describe('aba Pedidos acompanha a versao nova', () => {
  test('nada em memoria: nao faz nada, nem chama o backend', async () => {
    const a = montarPedidos({ allOrders: [], previewState: 'idle' });
    await a.run();
    assert.equal(a.chamadas.length, 0);
  });

  test('versao igual: uma consulta de status e mais nada', async () => {
    const a = montarPedidos({ allOrders: [{ id: 1, date_created: '2026-09-25T10:00:00Z' }], snapVersao: 3, status: { versao: 3 } });
    await a.run();
    assert.deepEqual(a.chamadas, ['/api/orders/status?alvo=ativos']);
    assert.equal(a.renders.length, 0);
  });

  test('venda pelo passo rapido: mescla a PRIMEIRA pagina por id, sem repaginar o historico', async () => {
    const velho = { id: 1, status: 'paid', date_created: '2026-09-25T10:00:00Z' };
    const a = montarPedidos({
      allOrders: [velho, { id: 2, date_created: '2026-09-25T09:00:00Z' }], snapVersao: 3,
      status: { versao: 4, origem: 'dashboard_refresh' },
      pagina: { versao: 4, items: [{ id: 9, date_created: '2026-09-25T11:43:00Z' }, { ...velho, status: 'cancelled' }] },
    });
    await a.run();
    const e = a.estado();
    assert.equal(a.chamadas.length, 2);
    assert.match(a.chamadas[1], /^\/api\/orders\/list\?alvo=ativos&pageSize=500$/);
    assert.deepEqual(e.allOrders.map(o => o.id), [9, 1, 2], 'novo na frente, ordem por data');
    assert.equal(e.allOrders[1].status, 'cancelled', 'pedido que mudou foi substituido, nao duplicado');
    assert.equal(e._snapVersaoAtivos, 4);
    assert.equal(e._ultimoNewestDate, '2026-09-25T11:43:00.000Z');
    assert.equal(a.interno.forceLoads, 0, 'historico NAO foi repaginado');
    assert.deepEqual(a.renders, ['kpis', 'pedidos']);
  });

  test('versao da reconciliacao (incremental/full): repagina o historico inteiro', async () => {
    const a = montarPedidos({ allOrders: [{ id: 1, date_created: '2026-09-25T10:00:00Z' }], snapVersao: 3, status: { versao: 4, origem: 'incremental' } });
    await a.run();
    assert.equal(a.interno.forceLoads, 1);
    assert.equal(a.chamadas.length, 1, 'nao pediu a primeira pagina');
  });

  test('primeira pagina falha: cai para a repaginacao completa', async () => {
    const a = montarPedidos({ allOrders: [{ id: 1, date_created: '2026-09-25T10:00:00Z' }], snapVersao: 3, status: { versao: 4 }, pagina: null });
    await a.run();
    assert.equal(a.interno.forceLoads, 1);
  });

  test('so o preview em memoria: invalida para a proxima abertura da aba', async () => {
    const a = montarPedidos({ allOrders: [], previewState: 'loaded', status: { versao: 4 } });
    await a.run();
    const e = a.estado();
    assert.equal(e.ordersPreviewState, 'idle');
    assert.deepEqual(e.ordersPreview, []);
    assert.equal(a.interno.forceLoads, 0);
  });

  test('aba Pedidos fechada: atualiza a memoria e os KPIs, sem renderizar a tabela', async () => {
    const a = montarPedidos({ allOrders: [{ id: 1, date_created: '2026-09-25T10:00:00Z' }], snapVersao: 3, status: { versao: 4 }, pagina: { versao: 4, items: [] }, abaAtiva: false });
    await a.run();
    assert.deepEqual(a.renders, ['kpis']);
  });
});

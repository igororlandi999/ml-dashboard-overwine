/**
 * Selecao de contas (empresa x marketplace) — contrato do modulo no index.html.
 *
 * O que estes testes travam, e por que:
 *
 * 1. A Overwine sozinha NAO muda nada: nenhuma requisicao ganha parametro e
 *    nenhuma chave de storage muda de nome. E a promessa de compatibilidade.
 *
 * 2. Leitura leva `contas=a,b`; o proxy do Mercado Livre leva `conta=a`, UMA.
 *    Na visao consolidada o proxy sem conta explicita e erro — nao existe "a
 *    conta" de uma selecao com duas.
 *
 * 3. Resposta que chega depois de a selecao mudar e DESCARTADA. Sem isso, um
 *    pedido da Overwine pedido um instante antes da troca seria desenhado na
 *    tela da Degustar.
 *
 * 4. Custos, tarifas, metas e publicidade da Overwine nao valem para outra
 *    empresa: selecao sem perfil financeiro devolve indisponivel, nunca zero.
 *
 * 5. No consolidado, o mesmo SKU em duas empresas sao duas chaves.
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

function extrairFuncao(nome) {
  const marca = 'function ' + nome + '(';
  const ini = html.indexOf(marca);
  assert.notEqual(ini, -1, 'funcao ' + nome + ' nao encontrada em index.html');
  const comAsync = html.slice(Math.max(0, ini - 6), ini) === 'async ' ? ini - 6 : ini;
  // pula a lista de parametros (que pode ter `= {}`) antes de contar chaves
  let k = html.indexOf('(', ini), par = 0;
  for (; k < html.length; k++) {
    if (html[k] === '(') par++;
    else if (html[k] === ')') { par--; if (par === 0) break; }
  }
  const i = html.indexOf('{', k);
  let nivel = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (nivel === 0) return html.slice(comAsync, j + 1); }
  }
  throw new Error('funcao ' + nome + ' nao fecha');
}
function extrairConstante(nome) {
  const m = new RegExp('const ' + nome + ' = [^\\n]*;').exec(html);
  assert.ok(m, 'constante ' + nome + ' nao encontrada');
  return m[0];
}

const CONTAS = [
  { id: 'overwine-ml', empresa: 'alemmar', empresaRotulo: 'Além Mar (Overwine)', canal: 'ml', canalRotulo: 'Mercado Livre', selecionavel: true, financeiro: true, legada: true },
  { id: 'degustar-ml', empresa: 'degustar', empresaRotulo: 'Degustar', canal: 'ml', canalRotulo: 'Mercado Livre', selecionavel: true, financeiro: false, legada: false },
  { id: 'alemmar-amazon', empresa: 'alemmar', empresaRotulo: 'Além Mar (Overwine)', canal: 'amazon', canalRotulo: 'Amazon', selecionavel: false, financeiro: false, legada: false },
];

/** Monta o modulo com storage e fetch falsos. `guardada` e o que ja esta no sessionStorage. */
function montar({ guardada = null, fetchFalso = null } = {}) {
  const mem = new Map();
  if (guardada !== null) mem.set('ow_selecao', guardada);
  const storage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: k => { mem.delete(k); },
  };
  const win = { sessionStorage: storage, localStorage: storage };
  const chamadas = [];
  const fetchPadrao = async (url, init) => { chamadas.push({ url, init }); return { status: 200, ok: true, json: async () => ({}) }; };
  const fonte = [
    'const BACKEND_URL = "http://backend";',
    'let SESSION_TOKEN = "sess_x";',
    'let USER_ID = 2329718196;',
    'function handleSessionExpired() { _expirou.n++; }',
    extrairConstante('CONTA_LEGADA'),
    extrairConstante('SELECAO_STORAGE_KEY'),
    extrairConstante('INDISPONIVEL'),
    extrairConstante('RE_ROTA_LEITURA'),
    'let CONTAS_DISPONIVEIS = _contas;',
    extrairFuncao('_idsDeConta'),
    extrairFuncao('selecaoRestaurar'),
    'let SELECAO = selecaoRestaurar();',
    extrairFuncao('selecaoGravar'),
    extrairFuncao('selecaoChave'),
    extrairFuncao('selecaoLegada'),
    extrairFuncao('selecaoConsolidada'),
    extrairFuncao('selecaoInclui'),
    extrairFuncao('contaInfo'),
    extrairFuncao('empresaNome'),
    extrairFuncao('contaNome'),
    extrairFuncao('selecaoTemFinanceiro'),
    extrairFuncao('contasSemFinanceiro'),
    extrairFuncao('chaveLocal'),
    extrairFuncao('contasParaProxy'),
    extrairFuncao('ehVendedorDaSelecao'),
    extrairFuncao('contaDe'),
    extrairFuncao('_comParametro'),
    extrairFuncao('aplicarSelecao'),
    extrairFuncao('backendFetch'),
    extrairFuncao('itemSKU'),
    extrairFuncao('pubManualPermitida'),
    extrairConstante('SNAPSHOT_IDADE_MAX_S'),
    extrairFuncao('_idadeDoUltimoCheck'),
    extrairFuncao('contasParaRefresh'),
    'return { selecaoGravar, selecaoChave, selecaoLegada, selecaoConsolidada, selecaoTemFinanceiro, contasSemFinanceiro,',
    '  chaveLocal, contasParaProxy, ehVendedorDaSelecao, contaDe, aplicarSelecao, backendFetch, itemSKU, contaNome,',
    '  pubManualPermitida, contasParaRefresh, _idsDeConta, selecao: () => SELECAO.slice() };',
  ].join('\n');
  const expirou = { n: 0 };
  const api = new Function('window', 'fetch', '_contas', '_expirou', fonte)(win, fetchFalso || fetchPadrao, CONTAS, expirou);
  return Object.assign(api, { chamadas, mem, expirou });
}

describe('selecao guardada na aba', () => {
  test('sem nada guardado, a selecao e a Overwine', () => {
    assert.deepEqual(montar().selecao(), ['overwine-ml']);
  });
  test('restaura uma conta, e varias na ordem guardada', () => {
    assert.deepEqual(montar({ guardada: 'degustar-ml' }).selecao(), ['degustar-ml']);
    assert.deepEqual(montar({ guardada: 'overwine-ml,degustar-ml' }).selecao(), ['overwine-ml', 'degustar-ml']);
  });
  test('lixo no storage vira a Overwine — nunca uma conta inventada', () => {
    for (const lixo of ['', ',,', '../x', 'DEGUSTAR-ML', '<script>', 'a', 'x'.repeat(60)]) {
      assert.deepEqual(montar({ guardada: lixo }).selecao(), ['overwine-ml'], 'valor: ' + JSON.stringify(lixo));
    }
  });
  test('repetida conta como uma', () => {
    assert.deepEqual(montar({ guardada: 'degustar-ml,degustar-ml' }).selecao(), ['degustar-ml']);
  });
  test('gravar a Overwine sozinha APAGA a chave: o storage volta ao estado de antes', () => {
    const m = montar({ guardada: 'degustar-ml' });
    m.selecaoGravar(['overwine-ml']);
    assert.equal(m.mem.has('ow_selecao'), false);
    m.selecaoGravar(['overwine-ml', 'degustar-ml']);
    assert.equal(m.mem.get('ow_selecao'), 'overwine-ml,degustar-ml');
  });
  test('a selecao vive no sessionStorage (da aba), nao no localStorage', () => {
    assert.match(extrairFuncao('selecaoGravar'), /window\.sessionStorage/);
    assert.ok(!/localStorage/.test(extrairFuncao('selecaoGravar')));
    assert.ok(!/localStorage/.test(extrairFuncao('selecaoRestaurar')));
  });
});

describe('Overwine sozinha — nada muda', () => {
  const m = montar();
  test('nenhum caminho ganha parametro', () => {
    for (const p of [
      '/api/orders/status?alvo=ativos', '/api/orders/list?alvo=ativos&pageSize=500', '/api/orders/metrics?from=2026-09-01&to=2026-09-29',
      '/api/orders/margin?from=2026-09-01&to=2026-09-29', '/api/orders/logistics', '/api/items/catalog', '/api/items/catalog?refresh=1',
      '/api/ml/visits?last=30', '/api/ml/order?id=123', '/api/ml/reputation', '/api/orders/refresh', '/api/auth/session', '/api/chat',
    ]) assert.equal(m.aplicarSelecao(p), p);
  });
  test('chaves de storage sao as de sempre', () => {
    for (const k of ['kpi_pub_manual', 'mg_pub_manual', 'pos_saved_terms', 'gr_seasonality_v2']) assert.equal(m.chaveLocal(k), k);
  });
  test('proxy: uma chamada, sem conta', () => {
    assert.deepEqual(m.contasParaProxy(), [null]);
  });
  test('tem financeiro, e o SKU e o puro', () => {
    assert.equal(m.selecaoTemFinanceiro(), true);
    assert.equal(m.itemSKU({ id: 'MLB1', seller_custom_field: '21003' }), '21003');
  });
  test('backendFetch chama exatamente a URL pedida', async () => {
    const x = montar();
    await x.backendFetch('/api/orders/status?alvo=ativos');
    assert.equal(x.chamadas[0].url, 'http://backend/api/orders/status?alvo=ativos');
  });
});

describe('uma conta que nao e a Overwine', () => {
  const m = montar({ guardada: 'degustar-ml' });
  test('leitura leva contas=degustar-ml', () => {
    assert.equal(m.aplicarSelecao('/api/orders/status?alvo=ativos'), '/api/orders/status?alvo=ativos&contas=degustar-ml');
    assert.equal(m.aplicarSelecao('/api/items/catalog'), '/api/items/catalog?contas=degustar-ml');
    assert.equal(m.aplicarSelecao('/api/orders/margin?from=a&to=b'), '/api/orders/margin?from=a&to=b&contas=degustar-ml');
  });
  test('proxy leva conta=degustar-ml', () => {
    assert.equal(m.aplicarSelecao('/api/ml/visits?last=30'), '/api/ml/visits?last=30&conta=degustar-ml');
    assert.equal(m.aplicarSelecao('/api/ml/reputation'), '/api/ml/reputation?conta=degustar-ml');
  });
  test('login, sessao e a lista de contas nao levam conta', () => {
    for (const p of ['/api/auth/login', '/api/auth/session', '/api/orders/contas']) assert.equal(m.aplicarSelecao(p), p);
  });
  test('sem financeiro: a Degustar nao tem custos nem tarifas proprios', () => {
    assert.equal(m.selecaoTemFinanceiro(), false);
    assert.deepEqual(m.contasSemFinanceiro(), ['degustar-ml']);
  });
  test('chaves de storage levam a selecao', () => {
    assert.equal(m.chaveLocal('kpi_pub_manual'), 'kpi_pub_manual::degustar-ml');
    assert.notEqual(m.chaveLocal('gr_seasonality_v2'), 'gr_seasonality_v2');
  });
  test('o id de vendedor embutido (Overwine) nao identifica anuncio da Degustar', () => {
    assert.equal(m.ehVendedorDaSelecao(2329718196), false);
    assert.equal(montar().ehVendedorDaSelecao(2329718196), true);
  });
  test('pedido sem marca e da unica conta da selecao', () => {
    assert.equal(m.contaDe({ id: 1 }), 'degustar-ml');
  });
});

describe('visao consolidada', () => {
  const m = montar({ guardada: 'overwine-ml,degustar-ml' });
  test('leitura leva as duas contas', () => {
    assert.equal(m.aplicarSelecao('/api/orders/list?alvo=ativos'), '/api/orders/list?alvo=ativos&contas=overwine-ml%2Cdegustar-ml');
  });
  test('proxy SEM conta explicita e erro — nunca "a primeira em silencio"', () => {
    assert.throws(() => m.aplicarSelecao('/api/ml/order?id=1'), /consolidada/i);
    assert.throws(() => m.aplicarSelecao('/api/ml/promotion-item-set'), /consolidada/i);
  });
  test('proxy COM a conta do pedido: a da Degustar leva parametro, a da Overwine nao', () => {
    assert.equal(m.aplicarSelecao('/api/ml/order?id=1', 'degustar-ml'), '/api/ml/order?id=1&conta=degustar-ml');
    assert.equal(m.aplicarSelecao('/api/ml/order?id=1', 'overwine-ml'), '/api/ml/order?id=1');
  });
  test('status POR CONTA dentro do consolidado', () => {
    assert.equal(m.aplicarSelecao('/api/orders/status?alvo=ativos', 'degustar-ml'), '/api/orders/status?alvo=ativos&contas=degustar-ml');
  });
  test('proxy: uma chamada por conta', () => {
    assert.deepEqual(m.contasParaProxy(), ['overwine-ml', 'degustar-ml']);
  });
  test('sem financeiro enquanto UMA das contas nao tiver', () => {
    assert.equal(m.selecaoTemFinanceiro(), false);
    assert.deepEqual(m.contasSemFinanceiro(), ['degustar-ml']);
  });
  test('publicidade manual fechada: um valor so nao tem dono entre duas empresas', () => {
    assert.equal(m.pubManualPermitida(), false);
    assert.equal(montar({ guardada: 'degustar-ml' }).pubManualPermitida(), true);
  });
  test('o mesmo SKU em duas empresas sao DUAS chaves', () => {
    const a = m.itemSKU({ id: 'MLB1', seller_custom_field: '21003', conta: 'overwine-ml' });
    const b = m.itemSKU({ id: 'MLB2', seller_custom_field: '21003', conta: 'degustar-ml' });
    assert.notEqual(a, b);
    assert.match(a, /^21003 · Overwine$/);
    assert.match(b, /^21003 · Degustar$/);
  });
  test('pedido sem marca no consolidado nao tem conta — nao se adivinha', () => {
    assert.equal(m.contaDe({ id: 1 }), null);
    assert.equal(m.contaDe({ id: 1, conta: 'degustar-ml' }), 'degustar-ml');
  });
});

describe('resposta de selecao anterior e descartada', () => {
  test('a selecao muda enquanto a resposta viaja: backendFetch lanca, e marca selecaoMudou', async () => {
    let soltar;
    const espera = new Promise(r => { soltar = r; });
    const m = montar({ fetchFalso: async () => { await espera; return { status: 200, ok: true, json: async () => ({ items: ['pedido-da-overwine'] }) }; } });
    const pedido = m.backendFetch('/api/orders/list?alvo=ativos');
    m.selecaoGravar(['degustar-ml']);   // o operador trocou de empresa
    soltar();
    await assert.rejects(pedido, e => e.selecaoMudou === true && /descartada/i.test(e.message));
  });
  test('a selecao nao mudou: a resposta passa', async () => {
    const m = montar({ guardada: 'degustar-ml' });
    const res = await m.backendFetch('/api/orders/list?alvo=ativos');
    assert.equal(res.ok, true);
    assert.equal(m.chamadas[0].url, 'http://backend/api/orders/list?alvo=ativos&contas=degustar-ml');
  });
  test('a opcao `conta` e desta camada: nao vaza para o fetch', async () => {
    const m = montar({ guardada: 'overwine-ml,degustar-ml' });
    await m.backendFetch('/api/ml/order?id=9', { conta: 'degustar-ml' });
    assert.equal(m.chamadas[0].url, 'http://backend/api/ml/order?id=9&conta=degustar-ml');
    assert.ok(!('conta' in m.chamadas[0].init));
  });
  test('401 continua encerrando a sessao, com qualquer selecao', async () => {
    const m = montar({ guardada: 'degustar-ml', fetchFalso: async () => ({ status: 401, ok: false }) });
    await assert.rejects(m.backendFetch('/api/orders/status?alvo=ativos'), /Sessao expirada/);
    assert.equal(m.expirou.n, 1);
  });
  test('trocar de selecao recarrega a pagina', () => {
    const corpo = extrairFuncao('trocarSelecao');
    assert.match(corpo, /selecaoGravar\(ids\)/);
    assert.match(corpo, /window\.location\.reload\(\)/);
    assert.ok(corpo.indexOf('selecaoGravar(ids)') < corpo.indexOf('window.location.reload()'), 'grava antes de recarregar');
    for (const t of ['refreshTimer', 'countdownTimer', 'snapshotPollTimer', '_pedidosIndicadorTimer']) {
      assert.match(corpo, new RegExp('clearInterval\\(' + t + '\\)'), 'para o temporizador ' + t);
    }
  });
});

describe('atualizacao automatica por conta', () => {
  const velho = { idadeCheckSegundos: 300 }, novo = { idadeCheckSegundos: 5 };
  test('consolidado: so as contas ATRASADAS sao pedidas', () => {
    const m = montar({ guardada: 'overwine-ml,degustar-ml' });
    assert.deepEqual(m.contasParaRefresh({ porConta: { 'overwine-ml': novo, 'degustar-ml': velho } }), ['degustar-ml']);
    assert.deepEqual(m.contasParaRefresh({ porConta: { 'overwine-ml': velho, 'degustar-ml': velho } }), ['overwine-ml', 'degustar-ml']);
    assert.deepEqual(m.contasParaRefresh({ porConta: { 'overwine-ml': novo, 'degustar-ml': novo } }), []);
  });
  test('uma conta: pede a da selecao quando atrasada, nada quando em dia', () => {
    const m = montar({ guardada: 'degustar-ml' });
    assert.deepEqual(m.contasParaRefresh(velho), ['degustar-ml']);
    assert.deepEqual(m.contasParaRefresh(novo), []);
  });
  test('o refresh por conta manda a conta no corpo e NAO recarrega por versao da conta', () => {
    const corpo = extrairFuncao('pedirRefreshDasContas');
    assert.match(corpo, /backendFetch\('\/api\/orders\/refresh', \{ method: 'POST', body: JSON\.stringify\(\{ conta \}\) \}\)/);
    assert.ok(!/loadAll\(/.test(corpo), 'quem recarrega e o poll, pela versao da SELECAO');
    assert.ok(!/mercadolibre|\/api\/ml\//.test(corpo));
  });
  test('a Overwine sozinha segue com o corpo {} de sempre', () => {
    assert.match(extrairFuncao('pedirRefreshSeVelho'), /backendFetch\('\/api\/orders\/refresh', \{ method: 'POST', body: '\{\}' \}\)/);
  });
});

describe('o que e da Overwine nao vaza para outra empresa', () => {
  const prep = extrairFuncao('aplicarSelecaoNaInterface');
  test('a Overwine sozinha sai antes de qualquer limpeza', () => {
    const iRet = prep.indexOf('if (selecaoLegada()) return;');
    assert.notEqual(iRet, -1);
    assert.ok(iRet < prep.indexOf('ADS_DATA ='), 'o relatorio embutido so e zerado fora da Overwine');
  });
  test('relatorio de publicidade embutido, meta mensal e cobertura alvo sao esvaziados', () => {
    assert.match(prep, /ADS_DATA = \{ periodo: null, totalInvestimento: 0, porMLB: \{\}, diasCobertos: 0 \}/);
    assert.match(prep, /getElementById\('pv-meta'\)/);
    assert.match(prep, /getElementById\('gr-semanas'\)/);
  });
  test('as tarifas medias da planilha so entram quando a selecao tem financeiro', () => {
    const corpo = extrairFuncao('calcLiquidoPeriodo');
    const guarda = corpo.indexOf('if (!selecaoTemFinanceiro())');
    assert.notEqual(guarda, -1);
    assert.ok(guarda < corpo.indexOf('const TAXA_ML = 0.1480'), 'a guarda vem ANTES das tarifas da Overwine');
    assert.match(corpo, /liquido: null, semFinanceiro: true/);
  });
  test('sem financeiro os cards mostram texto, nao numero', () => {
    const corpo = extrairFuncao('renderKPIsPeriodo');
    assert.match(corpo, /_liq\.apurado !== undefined/);
    assert.match(corpo, /htmlIndisponivel\(/);
    assert.match(corpo, /textoCobertura\(/);
  });
  test('margem sem financeiro nunca le custo nem margem da resposta', () => {
    const corpo = extrairFuncao('renderMargemSemFinanceiro');
    for (const campo of ['custoTotal', 'margemPct', 'l.margem', 'custoCobertura']) {
      assert.ok(!corpo.includes(campo), 'nao pode usar ' + campo);
    }
  });
  test('configuracao de semanas por SKU (GitHub) so e lida para a Overwine', () => {
    const corpo = extrairFuncao('grLoadConfig');
    assert.ok(corpo.indexOf('if (!selecaoLegada())') < corpo.indexOf('fetch('), 'a guarda vem antes da busca');
  });
  test('Radar nao consulta nada fora da Overwine', () => {
    const corpo = extrairFuncao('radarRefresh');
    assert.ok(corpo.indexOf('if (!selecaoLegada())') < corpo.indexOf('mlFetch('));
  });
  test('ofertas relampago nao sao alteradas na visao consolidada', () => {
    assert.match(extrairFuncao('rlPost'), /if \(selecaoConsolidada\(\)\) throw/);
    assert.match(extrairFuncao('rlDelete'), /if \(selecaoConsolidada\(\)\) throw/);
  });
});

describe('assistente', () => {
  test('fora da Overwine ele avisa e NAO chama o backend', () => {
    const corpo = extrairFuncao('owChatEnviar');
    const guarda = corpo.indexOf('!selecaoLegada()');
    assert.notEqual(guarda, -1);
    assert.ok(guarda < corpo.indexOf('owChatResponder('), 'a guarda vem antes de qualquer resposta');
    assert.match(corpo, /apenas pela Overwine/);
  });
  test('segunda trava: a selecao vai no corpo para o backend recusar', () => {
    assert.match(extrairFuncao('owChatChamarBackend'), /payload\.contas = selecaoChave\(\)/);
  });
});

describe('tarifa e frete reais, com cobertura', () => {
  function montarApurado(metrics) {
    const fonte = [
      'const INDISPONIVEL = "indisponivel";',
      'let _metrics = _m;',
      extrairFuncao('liquidoApurado'),
      extrairFuncao('textoCobertura'),
      extrairFuncao('rotuloMetodo'),
      'return { liquidoApurado, textoCobertura, rotuloMetodo };',
    ].join('\n');
    return new Function('_m', fonte)(metrics);
  }
  const completo = {
    periodo: { faturamento: { bruto: 300, tarifaML: -34.5, tarifaEnv: -18.9, liquido: 246.6 } },
    financeiro: { conhecido: { completo: true, metodo: 'apurado_pedidos_envios', liquido: { valor: 246.6, receitaCoberta: 300, fracaoReceita: 1 } }, porConta: {} },
  };
  const parcial = {
    periodo: { faturamento: { bruto: 400, tarifaML: null, tarifaEnv: -30, liquido: null } },
    financeiro: { conhecido: { completo: false, metodo: 'apurado_pedidos_envios', tarifaML: { valor: -12, receitaCoberta: 100, fracaoReceita: 0.25 }, liquido: { valor: 78, receitaCoberta: 100, fracaoReceita: 0.25 } }, porConta: {} },
  };

  test('cobertura completa: os valores reais passam, e nada e marcado como indisponivel', () => {
    const r = montarApurado(completo).liquidoApurado(300);
    assert.deepEqual([r.tarifaML, r.tarifaEnv, r.liquido, r.semFinanceiro], [-34.5, -18.9, 246.6, false]);
    assert.equal(r.apurado.metodo, 'apurado_pedidos_envios');
  });
  test('cobertura parcial: o total e null; o subtotal fica em apurado.conhecido', () => {
    const r = montarApurado(parcial).liquidoApurado(400);
    assert.equal(r.liquido, null);
    assert.equal(r.tarifaML, null);
    assert.equal(r.tarifaEnv, -30);            // o frete, completo, aparece
    assert.equal(r.semFinanceiro, true);
    assert.equal(r.apurado.conhecido.liquido.valor, 78);
  });
  test('o subtotal e escrito COMO subtotal, com a fracao da receita', () => {
    const t = montarApurado(parcial).textoCobertura(parcial.financeiro.conhecido.liquido, 'liquido');
    assert.match(t, /^subtotal conhecido: /);
    assert.match(t, /cobre 25% da receita/);
  });
  test('sem nada conhecido: diz que nao ha dado — nao escreve R$ 0', () => {
    const t = montarApurado(parcial).textoCobertura({ valor: 0, receitaCoberta: 0, fracaoReceita: 0 }, 'tarifa');
    assert.ok(!/R\$/.test(t));
    assert.match(t, /tarifa n.o informado/);
  });
  test('tarifa nao validada: o texto diz isso, e nenhum valor aparece — mesmo havendo subtotal', () => {
    const t = montarApurado(parcial).textoCobertura({ valor: -144, receitaCoberta: 1200, fracaoReceita: 0.63 }, 'tarifa', true);
    assert.match(t, /ainda n.o validada contra o Mercado Livre/);
    assert.ok(!/R\$|144|63%/.test(t));
  });
  test('liquido e tarifa dependem da validacao; o frete, nao', () => {
    const corpo = extrairFuncao('renderKPIsPeriodo');
    assert.match(corpo, /cardApurado\('kpi-liq', 'kpi-liq-pct', liquido, [^\n]*, true\);/);
    assert.match(corpo, /cardApurado\('kpi-tarifa-ml', 'kpi-tarifa-ml-pct', tarifaML, [^\n]*, true\);/);
    assert.match(corpo, /cardApurado\('kpi-tarifa-env', 'kpi-tarifa-env-pct', tarifaEnv, [^\n]*, false\);/);
  });
  test('o metodo e dito na tela: real, ou misto com a Overwine estimada', () => {
    const m = montarApurado(completo);
    assert.match(m.rotuloMetodo('apurado_pedidos_envios'), /valor real/);
    assert.match(m.rotuloMetodo('misto'), /Overwine estimada/);
  });
  test('liquidoApurado nao conhece percentual nenhum', () => {
    const corpo = extrairFuncao('liquidoApurado');
    assert.ok(!/0\.14|TAXA_/.test(corpo));
  });
  test('trocar o periodo fora da Overwine pede o apurado ao backend, mesmo com o historico em memoria', () => {
    assert.match(extrairFuncao('aplicarPeriodoGlobal'), /if \(!pedidosEmMemoria\(\) \|\| !selecaoLegada\(\)\) await loadMetrics\(/);
  });
});

describe('ressalva de validacao — reembolso parcial', () => {
  function montar() {
    const fonte = [
      'function contaNome(id) { return id === "degustar-ml" ? "Degustar" : "Overwine"; }',
      extrairFuncao('textoRessalvas'),
      'return { textoRessalvas };',
    ].join('\n');
    return new Function(fonte)();
  }
  const comRessalva = { completo: true, ressalvas: [{ tipo: 'reembolso_parcial', conta: 'degustar-ml', pedidos: 1, receita: 99, tarifaCalculada: -27.72 }] };

  test('sem ressalva o texto e vazio: nada aparece na tela', () => {
    const m = montar();
    assert.equal(m.textoRessalvas({ completo: true, ressalvas: [] }, true), '');
    assert.equal(m.textoRessalvas({ completo: true }, false), '');
    assert.equal(m.textoRessalvas(null, false), '');
  });
  test('curto, para o card: diz que ha ressalva e quantos pedidos', () => {
    assert.equal(montar().textoRessalvas(comRessalva, true), 'com ressalva: 1 pedido com reembolso parcial');
  });
  test('por extenso: empresa, valor em duvida e o sentido do erro possivel', () => {
    const t = montar().textoRessalvas(comRessalva, false);
    assert.match(t, /Degustar/);
    assert.match(t, /27,72/);
    assert.match(t, /n.o conferida/);
    assert.match(t, /acima do real/);
  });
  test('os cards que dependem da tarifa levam a ressalva; o de frete, nao', () => {
    const corpo = extrairFuncao('renderKPIsPeriodo');
    assert.match(corpo, /const rs = dependeDaTarifa \? textoRessalvas\(_k, true\) : '';/);
    assert.match(corpo, /data-validacao/);
    assert.match(corpo, /kpi-ressalva-financeiro/);
  });
  test('a area da ressalva existe na pagina e nasce escondida', () => {
    assert.match(html, /<div id="kpi-ressalva-financeiro" style="display:none"><\/div>/);
  });
  test('a margem tambem leva a ressalva na receita liquida', () => {
    assert.match(extrairFuncao('renderMargemSemFinanceiro'), /textoRessalvas\(k, true\)/);
  });
});

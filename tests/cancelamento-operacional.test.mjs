/**
 * FASE A5 — Cancelamentos com populacao, janela e fonte coerentes.
 *
 * Travado aqui:
 *  - cancelamentoOperacional(from, to) e a definicao unica:
 *      numerador   = pedidoCancelado (ML 'cancelled', Amazon 'amazon:cancelled');
 *      denominador = TODOS os pedidos do periodo (cancelados inclusive), cada id
 *                    uma vez: ML nao cancelado do historico, ML cancelado da
 *                    lista dedicada do proxy, Amazon do historico;
 *  - so aparece com historico em memoria, snapshot nao parcial e lista de
 *    cancelados do ML carregada sem falha e cobrindo o periodo; senao "—";
 *  - zero cancelado = 0,0%; periodo sem pedido = "—" (sem pedidos), sem divisao;
 *  - nenhum cenario sem dados vira 100%;
 *  - reputacao do ML fica separada, com rotulo proprio, e ausente = "—";
 *  - regras de venda (A1), receita, publicidade e Margem nao mudam.
 *
 * As abas sao montadas com as funcoes REAIS (renderCancelamentos,
 * renderPedidosKPIs, loadCancelledOrders, garantirCancelados,
 * renderCardReputacao); so a rede (mlFetch) e o DOM sao falsos.
 *
 * Rodar: node --test tests/*.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extrairFuncao(nome) {
  const ini = html.indexOf('function ' + nome + '(');
  assert.notEqual(ini, -1, 'funcao ' + nome + ' nao encontrada');
  let k = html.indexOf('(', ini), par = 0;
  for (; k < html.length; k++) {
    if (html[k] === '(') par++;
    else if (html[k] === ')') { par--; if (par === 0) break; }
  }
  const i = html.indexOf('{', k);
  let nivel = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (nivel === 0) return html.slice(ini, j + 1); }
  }
  throw new Error('funcao ' + nome + ' nao fecha');
}
function extrairConstante(nome) {
  const ini = html.indexOf('const ' + nome + ' = ');
  assert.notEqual(ini, -1, 'constante ' + nome + ' nao encontrada');
  let j = html.indexOf('=', ini) + 1, nivel = 0;
  for (; j < html.length; j++) {
    const ch = html[j];
    if (ch === '{' || ch === '[' || ch === '(') nivel++;
    else if (ch === '}' || ch === ']' || ch === ')') nivel--;
    else if (ch === ';' && nivel === 0) break;
  }
  return html.slice(ini, j + 1);
}

// ── Fixture deterministica: periodo 01–20/10/2026, "hoje" 28/10/2026 ──────────
const P = { from: '2026-10-01', to: '2026-10-20' };
const SET = { from: '2026-09-01', to: '2026-09-30' };
const VAZIO = { from: '2026-10-25', to: '2026-10-26' };
const dia = (d, h = 12) => `2026-${d}T${String(h).padStart(2, '0')}:00:00.000-03:00`;
const ml = (id, status, d, extra = {}) => ({ id, status, date_created: dia(d), paid_amount: status === 'cancelled' ? 0 : 100, total_amount: 100, order_items: [{ item: { id: 'MLB1', title: 'Vinho' }, quantity: 1, unit_price: 100 }], ...extra });
const amz = (id, status, d) => ({ id, canal: 'amazon', status: 'amazon:' + status, date_created: dia(d), paid_amount: 80, total_amount: 80, order_items: [] });

// Historico (snapshot de ativos): 94 paid + 1 partially_refunded no periodo,
// 1 cancelado que TAMBEM esta na lista do proxy (mesmo id), 4 vendas de setembro.
const HIST_ML = [
  ...Array.from({ length: 94 }, (_, i) => ml(i + 1, 'paid', '10-' + String(1 + (i % 20)).padStart(2, '0'))),
  ml(95, 'partially_refunded', '10-10'),
  ml(101, 'cancelled', '10-05'),
  ...Array.from({ length: 4 }, (_, i) => ml(200 + i, 'paid', '09-1' + i)),
];
// Lista dedicada do proxy: 5 cancelados no periodo (101 repetido acima) + 3 em setembro.
const CANC_ML = [
  ml(101, 'cancelled', '10-05', { cancel_detail: { group: 'buyer', code: 'buyer_cancel_express' } }),
  ml(102, 'cancelled', '10-08', { cancel_detail: { group: 'seller', code: 'feedback_out_of_stock' } }),
  ml(103, 'cancelled', '10-12', { cancel_detail: { group: 'shipment', code: 'shipment_not_delivered' } }),
  ml(104, 'cancelled', '10-15', { cancel_detail: { group: 'internal', code: 'pack_splitted' } }),
  ml(105, 'cancelled', '10-20', { cancel_detail: { group: 'buyer', code: 'buyer_cancel_express' } }),
  ml(301, 'cancelled', '09-03'), ml(302, 'cancelled', '09-15'), ml(303, 'cancelled', '09-28'),
];

/**
 * `historico` = allOrders (null = ainda nao carregado). `cancelados` = lista do
 * proxy por conta ('legado' para a Overwine sozinha); `totalProxy` sobrescreve
 * paging.total; `falhaPagina` faz a 2a pagina falhar.
 */
function montar({ historico = HIST_ML, cancelados = { legado: CANC_ML }, totalProxy = null, falhaPagina = false, falhaConta = false,
  periodo = P, parcial = false, temML = true, consolidado = false, reputacao = null } = {}) {
  const fonte = [
    'const _AGORA = new Date("2026-10-28T12:00:00.000-03:00");',
    extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'), extrairFuncao('dentroDoPeriodo'),
    'function hojeBRT() { return ymdBRT(_AGORA); }',
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
    'let allOrders = _hist || [], allCancelledOrders = [];',
    'let _ordersLoadState = _hist ? "loaded" : "idle", _ultimoPartial = _parcial;',
    'let _cancelLoadState = "idle", _cancelPromise = null, _cancelCobertura = null, _cancListaPeriodo = [];',
    'let cancFilter = "all", cancPage = 1; const CANC_PAGE_SIZE = 20;',
    'let _periodo = _p0;',
    'function gdrGet() { return { from: _periodo.from, toEfetivo: _periodo.to }; }',
    'function pedidosEmMemoria() { return _ordersLoadState === "loaded" && Array.isArray(allOrders) && allOrders.length > 0; }',
    'function selecaoTemMercadoLivre() { return _temML; }',
    'function selecaoConsolidada() { return _consol; }',
    'function contasParaProxy() { return !_temML ? [] : _consol ? ["overwine-ml", "degustar-ml"] : [null]; }',
    'function _contaProxy(c) { return c; }',
    'const USER_ID = 1;',
    'async function mlFetch(path, conta) {',
    '  const k = conta || "legado"; if (_falhaConta && k === "degustar-ml") throw new Error("HTTP 500");',
    '  const lista = _canc[k] || []; const q = new URLSearchParams(path.split("?")[1]); const off = Number(q.get("offset"));',
    '  if (_falhaPagina && off === 50) throw new Error("HTTP 500");',
    '  const tot = _total === null ? lista.length : (typeof _total === "object" ? (k in _total ? _total[k] : lista.length) : _total);',
    '  return { paging: tot === "ausente" ? {} : { total: tot }, results: lista.slice(off, off + 50) };',
    '}',
    'const MOD_PLACEHOLDER = "\\u2014", INDISPONIVEL = "indispon\\u00edvel";',
    'function escHtml(x) { return String(x); } function tagConta() { return ""; } function attrConta() { return ""; }',
    'let _metrics = null;',
    'const _dom = {}; const document = { querySelectorAll: () => [], getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", title: "", style: {} }) };',
    'const console = { warn() {}, log() {} };',
    extrairConstante('CANCEL_GROUP_LABELS'), extrairConstante('CANCEL_CODE_LABELS'), extrairConstante('CANCEL_COLORS'),
    extrairFuncao('motivoCoberturaCancelados'), extrairFuncao('cancelamentoOperacional'), extrairFuncao('textoCancelamentoIndisponivel'),
    extrairFuncao('canceladosMLDoPeriodo'), extrairFuncao('buildCancelMotivos'),
    extrairFuncao('renderCancelamentos'), extrairFuncao('renderCancelDonut'), extrairFuncao('renderCancelInsights'),
    extrairFuncao('getFilteredCancOrders'), extrairFuncao('renderCancOrdersTable'),
    'async ' + extrairFuncao('canceladosDaConta'), 'async ' + extrairFuncao('loadCancelledOrders'),
    extrairFuncao('garantirCancelados'),
    extrairFuncao('renderPedidosKPIs'), extrairFuncao('renderPedidosKPIsLocal'),
    // Reputacao (card proprio).
    extrairConstante('ML_REPUTATION_TARGETS'),
    'let reputacaoData = _rep, _repIndisponivelConsolidado = false, _repLoadState = "loaded";',
    extrairFuncao('renderCardReputacao'),
    `return {
      async carregar() { await garantirCancelados(); return _dom; },
      op(p, canal) { return cancelamentoOperacional(p.from, p.to, canal ? { canal } : undefined); },
      aba() { renderCancelamentos(); return _dom; },
      pedidos() { renderPedidosKPIs(); return _dom; },
      historico(lista) { allOrders = lista; _ordersLoadState = "loaded"; },
      periodo(p) { _periodo = p; },
      reputacao() { renderCardReputacao(); return _dom['card-reputacao'].innerHTML; },
      estado: () => ({ _cancelLoadState, _cancelCobertura, n: allCancelledOrders.length }),
      dom: _dom,
    };`,
  ].join('\n');
  return new Function('_hist', '_canc', '_total', '_falhaPagina', '_falhaConta', '_p0', '_parcial', '_temML', '_consol', '_rep', fonte)(
    historico, cancelados, totalProxy, falhaPagina, falhaConta, periodo, parcial, temML, consolidado, reputacao);
}

const aba = d => ({ total: d['canc-total'].textContent, de: d['canc-grand-total'].textContent, taxa: d['canc-taxa'].textContent, sub: d['canc-taxa-sub'].textContent });

describe('definicao unica: cancelados / todos os pedidos do periodo', () => {
  test('1. 95 validos + 5 cancelados = 100 pedidos → 5,0% (aba e Pedidos com o mesmo numero)', async () => {
    const h = montar();
    await h.carregar();
    const op = h.op(P, 'ml');
    assert.deepEqual([op.disponivel, op.cancelados, op.pedidos, op.taxa, op.fonte, op.periodoExato], [true, 5, 100, 0.05, 'historico+cancelados_ml', true]);
    assert.deepEqual(aba(h.aba()), { total: '5', de: '100', taxa: '5.0%', sub: 'sobre todos os pedidos do período' });
    const d = h.pedidos();
    assert.equal(d['ord-cancel'].textContent, '5');
    assert.equal(d['ord-cancel'].title, '5 cancelados em 100 pedidos do período');
  });

  test('2. 100 pedidos + 0 cancelados → 0,0% (zero valido, diferente de indisponivel)', async () => {
    const h = montar({ historico: [...HIST_ML.filter(o => o.status !== 'cancelled'), ml(96, 'paid', '10-02'), ml(97, 'paid', '10-03'), ml(98, 'paid', '10-04'), ml(99, 'paid', '10-06'), ml(100, 'paid', '10-07')], cancelados: { legado: [] } });
    await h.carregar();
    assert.equal(h.estado()._cancelLoadState, 'loaded', 'zero cancelados carregados = loaded, nao idle');
    const op = h.op(P, 'ml');
    assert.deepEqual([op.disponivel, op.cancelados, op.pedidos, op.taxa], [true, 0, 100, 0]);
    assert.equal(aba(h.aba()).taxa, '0.0%');
  });

  test('3. periodo sem pedido nenhum → "—" (sem pedidos), sem divisao por zero', async () => {
    const h = montar({ periodo: VAZIO });
    await h.carregar();
    const op = h.op(VAZIO, 'ml');
    assert.deepEqual([op.disponivel, op.pedidos, op.cancelados, op.taxa, op.motivo], [true, 0, 0, null, 'sem_pedidos']);
    const a = aba(h.aba());
    assert.equal(a.taxa, '—');
    assert.equal(a.sub, 'sem pedidos no período');
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(h.dom)));
  });

  test('4. sem historico: "—" (aguardando historico), mesmo com os cancelados carregados', async () => {
    const h = montar({ historico: null });
    await h.carregar();
    const op = h.op(P, 'ml');
    assert.deepEqual([op.disponivel, op.taxa, op.motivo], [false, null, 'aguarda_historico']);
    assert.deepEqual(aba(h.aba()), { total: '—', de: '—', taxa: '—', sub: 'aguardando histórico de pedidos' });
    assert.equal(h.pedidos()['ord-cancel'].textContent, '—');
  });

  test('5. historico parcial ou lista de cancelados incompleta: nunca taxa completa', async () => {
    const parcial = montar({ parcial: true });
    await parcial.carregar();
    assert.equal(parcial.op(P, 'ml').motivo, 'historico_parcial');
    // ML diz 900 cancelados; vieram so os 8 da lista → o mais antigo (03/09) limita a cobertura.
    const curta = montar({ totalProxy: 900 });
    await curta.carregar();
    assert.equal(curta.estado()._cancelCobertura.limiteYmd, '2026-09-03');
    assert.equal(curta.op(P, 'ml').disponivel, true, 'outubro comeca depois do limite: completo');
    assert.equal(curta.op({ from: '2026-09-03', to: '2026-09-30' }, 'ml').motivo, 'cancelados_incompletos_no_periodo');
    // Pagina que falha: antes virava lista menor em silencio.
    const falha = montar({ cancelados: { legado: Array.from({ length: 120 }, (_, i) => ml(1000 + i, 'cancelled', '10-02')) }, falhaPagina: true });
    await falha.carregar();
    assert.equal(falha.estado()._cancelLoadState, 'idle');
    assert.equal(falha.op(P, 'ml').motivo, 'cancelados_indisponiveis');
    assert.equal(aba(falha.aba()).taxa, '—');
    // Consolidado: uma conta falhou → nada da outra se apresenta como da selecao.
    const cons = montar({ consolidado: true, cancelados: { 'overwine-ml': CANC_ML, 'degustar-ml': [] }, falhaConta: true });
    await cons.carregar();
    assert.equal(cons.op(P, 'ml').disponivel, false);
    // Antes de carregar: "carregando", nao zero.
    const antes = montar();
    assert.equal(antes.op(P, 'ml').motivo, 'carregando_cancelados');
  });
});

describe('quem entra no numerador e no denominador', () => {
  test('6. ML cancelado entra nos dois; o mesmo id do snapshot e do proxy conta uma vez', async () => {
    const h = montar({ historico: [ml(1, 'paid', '10-02'), ml(101, 'cancelled', '10-05')], cancelados: { legado: [ml(101, 'cancelled', '10-05'), ml(102, 'cancelled', '10-06')] } });
    await h.carregar();
    assert.deepEqual([h.op(P, 'ml').cancelados, h.op(P, 'ml').pedidos], [2, 3]);
  });

  test('6b. pedido "paid" no snapshot e cancelado no proxy: prevalece cancelado (sem contar duas vezes)', async () => {
    const h = montar({ historico: [ml(1, 'paid', '10-02'), ml(7, 'paid', '10-03')], cancelados: { legado: [ml(7, 'cancelled', '10-03')] } });
    await h.carregar();
    assert.deepEqual([h.op(P, 'ml').cancelados, h.op(P, 'ml').pedidos], [1, 2]);
  });

  test('7. Amazon amazon:cancelled entra nos dois em "todos os canais"; fica fora da aba so-ML', async () => {
    const hist = [...HIST_ML, amz('A1', 'shipped', '10-03'), amz('A2', 'pending', '10-04'), amz('A3', 'cancelled', '10-05'), amz('A4', 'cancelled', '09-05')];
    const h = montar({ historico: hist });
    await h.carregar();
    assert.deepEqual([h.op(P).cancelados, h.op(P).pedidos], [6, 103]);       // + A3 / + A1, A2, A3
    assert.deepEqual([h.op(P, 'ml').cancelados, h.op(P, 'ml').pedidos], [5, 100]);
    assert.equal(h.pedidos()['ord-cancel'].textContent, '6');
    assert.equal(aba(h.aba()).taxa, '5.0%');
    // So Amazon na selecao: nao precisa da lista do ML.
    const so = montar({ historico: [amz('A1', 'shipped', '10-03'), amz('A3', 'cancelled', '10-05')], temML: false, cancelados: {} });
    const op = so.op(P);
    assert.deepEqual([op.disponivel, op.cancelados, op.pedidos, op.fonte], [true, 1, 2, 'historico']);
  });

  test('8/9. venda valida e partially_refunded entram so no denominador; pending tambem e pedido', async () => {
    const h = montar({ historico: [ml(1, 'paid', '10-02'), ml(2, 'partially_refunded', '10-02'), ml(3, 'pending', '10-02')], cancelados: { legado: [ml(9, 'cancelled', '10-02')] } });
    await h.carregar();
    const op = h.op(P, 'ml');
    assert.deepEqual([op.cancelados, op.pedidos, op.taxa], [1, 4, 0.25]);
  });

  test('12/13. troca de periodo recalcula a populacao; pedidos de outra janela nao entram', async () => {
    const h = montar();
    await h.carregar();
    assert.equal(aba(h.aba()).taxa, '5.0%');
    h.periodo(SET);
    const a = aba(h.aba());
    // setembro: 4 vendas + 3 cancelados (301-303) = 7 → 42,9%
    assert.deepEqual(a, { total: '3', de: '7', taxa: '42.9%', sub: 'sobre todos os pedidos do período' });
    // diagnosticos seguem o periodo: a lista da aba e a de setembro
    assert.deepEqual(h.dom['canc-orders-table'].innerHTML.match(/item-sku">#\d+/g), ['item-sku">#301', 'item-sku">#302', 'item-sku">#303']);
  });

  test('14. nenhum cenario sem dados produz 100%', async () => {
    const cenarios = [
      montar({ historico: null }),                        // sem historico (era o 100%: cancelados / cancelados)
      montar({ historico: [] }),
      montar({ parcial: true }),
      montar({ falhaPagina: true, cancelados: { legado: Array.from({ length: 80 }, (_, i) => ml(900 + i, 'cancelled', '10-02')) } }),
      montar({ periodo: VAZIO }),
    ];
    for (const h of cenarios) {
      await h.carregar();
      const t = aba(h.aba()).taxa;
      assert.notEqual(t, '100.0%');
      assert.equal(t, '—');
    }
    // So cancelados no periodo COM populacao completa: 100% e o numero real, nao falta de dado.
    const real = montar({ historico: [ml(5, 'paid', '09-02')], cancelados: { legado: [ml(9, 'cancelled', '10-02')] } });
    await real.carregar();
    assert.deepEqual([real.op(P, 'ml').cancelados, real.op(P, 'ml').pedidos], [1, 1]);
  });

  test('diagnosticos da aba (motivos, valor, responsabilidade) usam os cancelados do MESMO periodo', async () => {
    const h = montar();
    await h.carregar();
    const d = h.aba();
    assert.equal(d['canc-seller'].textContent, 1);    // 102
    assert.equal(d['canc-externo'].textContent, 4);
    assert.equal(d['canc-valor'].textContent, 'R$ 500');
    assert.match(d['canc-motivos-meta'].textContent, /^4 motivos distintos$/);
  });
});

describe('completude POR CONTA antes de consolidar', () => {
  // Conta A: 640 cancelados no ML, vieram os 500 mais recentes, todos de 05 a 20/10.
  const contaA = Array.from({ length: 500 }, (_, i) => ml(5000 + i, 'cancelled', '10-' + String(20 - (i % 16)).padStart(2, '0')));
  // Conta B: 20 cancelados, todos vieram, de agosto a outubro (a mais antiga e de agosto).
  const contaB = Array.from({ length: 20 }, (_, i) => ml(8000 + i, 'cancelled', ['08-10', '09-10', '10-10'][i % 3]));
  const histCons = [...HIST_ML.map(o => ({ ...o, conta: 'overwine-ml' })), ml(9001, 'paid', '10-03', { conta: 'degustar-ml' })];

  test('A truncada dentro do periodo + B completa → consolidado INDISPONIVEL', async () => {
    const h = montar({ consolidado: true, historico: histCons, cancelados: { 'overwine-ml': contaA, 'degustar-ml': contaB }, totalProxy: { 'overwine-ml': 640, 'degustar-ml': 20 } });
    await h.carregar();
    const e = h.estado();
    assert.equal(e.n, 520, 'as duas listas carregaram');
    // A lista JUNTADA tem 520 itens e o mais antigo e de agosto (da conta B):
    // um teste sobre a lista juntada diria "outubro coberto". A cobertura e a de A.
    assert.equal(e._cancelCobertura.limiteYmd, '2026-10-05');
    const op = h.op(P, 'ml');
    assert.deepEqual([op.disponivel, op.motivo], [false, 'cancelados_incompletos_no_periodo']);
    assert.equal(aba(h.aba()).taxa, '\u2014');
    assert.equal(h.pedidos()['ord-cancel'].textContent, '\u2014');
    // Periodo que comeca depois do limite de A: as duas contas cobrem → disponivel.
    const depois = { from: '2026-10-06', to: '2026-10-20' };
    assert.equal(h.op(depois, 'ml').disponivel, true);
  });

  test('A e B completas → disponivel, somando as duas contas', async () => {
    const h = montar({ consolidado: true, historico: histCons, cancelados: { 'overwine-ml': CANC_ML, 'degustar-ml': contaB } });
    await h.carregar();
    assert.equal(h.estado()._cancelCobertura.limiteYmd, null);
    const op = h.op(P, 'ml');
    // 5 de A + 6 de B em outubro (i % 3 === 2 → 10-10: i = 2,5,8,11,14,17); pedidos: 100 de A + 1 venda de B + 6 cancelados de B
    assert.deepEqual([op.disponivel, op.cancelados, op.pedidos], [true, 11, 107]);
  });

  test('B truncada e A completa: a ordem das contas nao importa', async () => {
    const h = montar({ consolidado: true, historico: histCons, cancelados: { 'overwine-ml': CANC_ML, 'degustar-ml': contaA }, totalProxy: { 'degustar-ml': 900 } });
    await h.carregar();
    assert.equal(h.op(P, 'ml').motivo, 'cancelados_incompletos_no_periodo');
  });

  test('conta sem paging.total e 1a pagina cheia: nao se declara completa', async () => {
    const cheia = montar({ cancelados: { legado: contaA }, totalProxy: 'ausente' });
    await cheia.carregar();
    assert.notEqual(cheia.estado()._cancelCobertura.limiteYmd, null);
    assert.equal(cheia.op(P, 'ml').motivo, 'cancelados_incompletos_no_periodo');
    // sem total e menos de 50: veio tudo
    const curta = montar({ cancelados: { legado: CANC_ML }, totalProxy: 'ausente' });
    await curta.carregar();
    assert.equal(curta.estado()._cancelCobertura.limiteYmd, null);
    assert.equal(curta.op(P, 'ml').taxa, 0.05);
  });
});

describe('reputacao separada', () => {
  const REP = { level_id: '5_green', power_seller_status: 'gold', transactions: { total: 3000 }, metrics: { sales: { completed: 900 }, cancellations: { rate: 0.011 }, claims: { rate: 0.004 }, delayed_handling_time: { rate: 0 } } };

  test('10. reputacao disponivel sem historico NAO preenche a taxa operacional', async () => {
    const h = montar({ historico: null, reputacao: REP });
    await h.carregar();
    assert.match(h.reputacao(), /Cancelamentos \(reputação ML, 60d\)[\s\S]*?1\.1%/);
    assert.equal(aba(h.aba()).taxa, '—');
    assert.equal(h.pedidos()['ord-cancel'].textContent, '—');
  });

  test('11. reputacao 1,1% e operacional 5,0% convivem, cada um com seu rotulo', async () => {
    const h = montar({ reputacao: REP });
    await h.carregar();
    assert.match(h.reputacao(), /1\.1%/);
    assert.equal(aba(h.aba()).taxa, '5.0%');
  });

  test('11b. metrica de reputacao ausente = "—", nunca "0% perfeito"', () => {
    const h = montar({ reputacao: { level_id: '5_green', metrics: {} } });
    const r = h.reputacao();
    assert.ok(!/0% perfeito/.test(r));
    assert.equal((r.match(/—/g) || []).length, 3);
    // zero real continua "0% perfeito"
    assert.match(montar({ reputacao: REP }).reputacao(), /Atrasos \(reputa\u00e7\u00e3o ML, 60d\)[\s\S]*?0% perfeito/);
  });

  test('a definicao operacional nao le reputacao', () => {
    for (const f of ['cancelamentoOperacional', 'motivoCoberturaCancelados', 'renderCancelamentos']) {
      assert.ok(!/reputacao|cancellations/.test(extrairFuncao(f)), f);
    }
  });
});

describe('o resto nao muda', () => {
  test('15. regras de venda da A1 intactas', () => {
    assert.match(extrairFuncao('pedidoCancelado'), /pedidoAmazon\(o\) \? o\.status === 'amazon:cancelled' : o\.status === 'cancelled'/);
    assert.match(extrairFuncao('contaComoVendaAmazon'), /status !== 'amazon:cancelled'/);
  });

  test('16. receita, liquido, publicidade e Margem nao leem cancelamento operacional', () => {
    for (const f of ['calcLiquidoPeriodo', 'totaisDoPeriodo', 'publicidadeDoPeriodo', 'renderMargem', 'renderKPIsPeriodo']) {
      assert.ok(!/cancelamentoOperacional|allCancelledOrders/.test(extrairFuncao(f)), f);
    }
  });

  test('nenhum caminho ativo divide cancelados por "cancelados + vendas" nem por (x || 1)', () => {
    const corpo = extrairFuncao('renderCancelamentos');
    assert.ok(!/pedidoPago|grandTotal|\|\| 1\)/.test(corpo));
    assert.ok(!/cancelCnt/.test(extrairFuncao('renderPedidosKPIsLocal')));
  });
});

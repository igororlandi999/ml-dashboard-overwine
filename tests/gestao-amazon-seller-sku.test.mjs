/**
 * CORRECAO (auditoria 10/11/2026) — dois bugs comprovados no dashboard publicado.
 *
 *  1. A Gestao de Estoque era calculada so no renderDashboard, antes do
 *     historico. Sem historico ela usa o agregado de 30 dias do backend, que
 *     identifica a venda Amazon so pelo ASIN do PEDIDO — e a Amazon relistou os
 *     SKUs em 09/11 com ASINs novos, entao a venda Amazon virava 0. Agora a
 *     Gestao e recalculada quando o historico chega.
 *  2. skuDaLinhaPedido tentava o ASIN antes do `seller_sku` do pedido: o pedido
 *     `B0H2NHR771` / seller_sku 21003 ia para o anuncio antigo `86-YFR2-YKJG`.
 *     Agora o seller_sku do pedido Amazon vem primeiro, validado na empresa.
 *
 * Fixture = o formato e os numeros reais de 10/11/2026 (Overwine ML + Amazon):
 *   vendas 30d  21002: ML 215 + Amazon 110 | 21003: ML 389 + Amazon 128
 *               25001: ML 630 + Amazon 81  | 25301: Amazon 4
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

const CONTAS = [
  { id: 'overwine-ml', empresa: 'alemmar', empresaRotulo: 'Overwine', canal: 'ml' },
  { id: 'alemmar-amazon', empresa: 'alemmar', empresaRotulo: 'Overwine', canal: 'amazon' },
  { id: 'degustar-ml', empresa: 'degustar', empresaRotulo: 'Degustar', canal: 'ml' },
];
const OW = ['overwine-ml', 'alemmar-amazon'];
const vel = u => +(u / 30).toFixed(2);

// ── Catalogo real de 10/11 (so os campos que importam) ───────────────────────
let _n = 0;
const ml = (sku, q, extra = {}) => ({ id: 'MLB' + sku + '-' + (++_n), title: 'Vinho ' + sku, status: 'active', price: 40, conta: 'overwine-ml', seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'xd_drop_off' }, tags: [], inventory_id: 'INV' + sku, ...extra });
const mlFull = (sku, q, inv) => ml(sku, q, { shipping: { logistic_type: 'fulfillment' }, inventory_id: inv });
const amz = (sku, asin, q, status = 'active', extra = {}) => ({ id: sku, title: 'Vinho ' + sku, status, price: 40, canal: 'amazon', conta: 'alemmar-amazon', seller_custom_field: sku, seller_sku: sku, asin, available_quantity: q, shipping: { logistic_type: 'amazon_proprio' }, tags: null, amazon: { estoque: 'proprio', estoqueInformado: true }, ...extra });
const amzFba = (sku, asin, q, status = 'active') => amz(sku, asin, q, status, { id: sku + '#fba', inventory_id: 'X' + sku, shipping: { logistic_type: 'amazon_fba' }, amazon: { estoque: 'fba', estoqueInformado: true } });

const CAT_ML = [
  ml('21002', 2520), ml('21002', 2520), mlFull('21002', 243, 'ACEY85810'),
  ml('21003', 627),
  ml('25001', 319), ml('25001', 319), mlFull('25001', 198, 'LCJX86619'),
  ml('25301', 825), ml('25301', 825),
];
// Relistagem de 09/11: ASINs NOVOS no catalogo; os mais vendidos ficaram pausados.
const CAT_AMZ = [
  amzFba('21002', 'B0HR2Y2S24', 8, 'paused'),
  amzFba('25001', 'B0HR3HWYLK', 158, 'paused'),
  amz('25301', 'B0HR2XJQTD', 300), amzFba('25301', 'B0HR2XJQTD', 0),
  amz('86-YFR2-YKJG', 'B0H2NHR771', 158, 'paused'), amzFba('86-YFR2-YKJG', 'B0H2NHR771', 0, 'paused'),
  amz('20321', 'B0HR33K4GH', 300), amz('26401', 'B0HR33K4GH', 300), amz('25101', 'B0HR33K4GH', 300, 'paused'),
];

// ── Pedidos reais dos ultimos 30 dias (ASIN ANTIGO no pedido) ───────────────
const diasAtras = n => new Date(Date.now() - n * 86400000).toISOString();
let _o = 0;
const pedMl = (itemId, qtd, dias, status = 'paid') => ({ id: 'ML' + (++_o), status, conta: 'overwine-ml', date_created: diasAtras(dias), order_items: [{ item: { id: itemId, title: 'x' }, quantity: qtd, unit_price: 40 }] });
const pedAmz = (asin, sku, qtd, dias, status = 'amazon:shipped') => ({ id: '70' + (++_o), canal: 'amazon', status, conta: 'alemmar-amazon', date_created: diasAtras(dias), order_items: [{ item: { id: asin, title: 'x', seller_sku: sku, variation_id: null }, quantity: qtd, unit_price: 39.9 }] });
const idMl = sku => CAT_ML.find(i => i.seller_custom_field === sku && i.shipping.logistic_type !== 'fulfillment').id;

const PEDIDOS = [
  pedMl(idMl('21002'), 215, 5), pedMl(idMl('21003'), 389, 6), pedMl(idMl('25001'), 630, 7),
  pedAmz('B0FCH81LW5', '21002', 110, 3), pedAmz('B0FCH81LW5', '21002', 14, 4, 'amazon:cancelled'),
  pedAmz('B0H2NHR771', '21003', 128, 3), pedAmz('B0H2NHR771', '21003', 8, 4, 'amazon:cancelled'),
  pedAmz('B0F7YSZ77M', '25001', 81, 8), pedAmz('B0F7YSZ77M', '25001', 6, 9, 'amazon:cancelled'),
  pedAmz('B0H4DPK6RT', '25301', 4, 14),
];
// Agregado de 30 dias do backend: venda Amazon por ASIN do PEDIDO, sem seller_sku.
const AGREGADO = [
  { itemId: idMl('21002'), unidades: 215 }, { itemId: idMl('21003'), unidades: 389 }, { itemId: idMl('25001'), unidades: 630 },
  { itemId: 'B0FCH81LW5', unidades: 110 }, { itemId: 'B0H2NHR771', unidades: 128 }, { itemId: 'B0F7YSZ77M', unidades: 81 }, { itemId: 'B0H4DPK6RT', unidades: 4 },
];

function montar({ itens, pedidos = PEDIDOS, selecao = ['alemmar-amazon'], emMemoria = true, porItem30d = AGREGADO } = {}) {
  const fonte = [
    "const CONTA_LEGADA = 'overwine-ml';",
    'let CONTAS_DISPONIVEIS = _contas, SELECAO = _sel;',
    extrairFuncao('selecaoLegada'), extrairFuncao('selecaoConsolidada'), extrairFuncao('selecaoChave'), extrairFuncao('contaInfo'),
    'function empresaNome(r) { return r; }', extrairFuncao('empresaDaConta'),
    extrairFuncao('contaDaEmpresaOverwine'), extrairFuncao('contaEhAmazon'), extrairFuncao('selecaoTemAmazon'),
    extrairFuncao('selecaoDaEmpresaOverwine'), extrairFuncao('estoqueMostraFba'),
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('dentroDoPeriodo'),
    'let allItems = _itens, allOrders = _st.mem ? _ped : [];',
    'let _metrics = _p30 ? { estoque30d: { porItem: _p30 } } : null;',
    'function pedidosEmMemoria() { return _st.mem && allOrders.length > 0; }',
    extrairFuncao('_skuDoVendedor'), 'let _indiceCatalogo = { ref: null, mapa: null };', extrairFuncao('_skuPorCatalogo'), extrairFuncao('itemSKU'),
    extrairFuncao('rotuloIdentidade'),
    'let _indiceItemSku = { ref: null, n: -1, sel: null, ids: null, vend: null };',
    extrairFuncao('_registrarChave'), extrairFuncao('indiceItemSku'), extrairFuncao('skuDoIdentificador'), extrairFuncao('skuDaLinhaPedido'),
    extrairFuncao('isFullItem'), extrairFuncao('fullStockKey'), extrairFuncao('isFbaItem'), extrairFuncao('consolidarEstoqueGrupo'),
    extrairFuncao('_qtdInformada'), extrairFuncao('estoqueFisicoDoGrupo'), extrairConstante('ROTULO_PENDENCIA_ESTOQUE'),
    'const MOD_PLACEHOLDER = "\\u2014";',
    'function escHtml(x) { return String(x); } function fmtPrice(v) { return String(v); }',
    'const _dom = { "gr-semanas": { value: "" } };',
    'const document = { querySelectorAll: () => [], getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", title: "", style: {}, value: "" }) };',
    'const console = { warn() {}, log() {} };',
    'function gdrGet() { const f = new Date(Date.now() - 40 * 86400000), t = new Date(Date.now() + 86400000); return { fromDate: f, toDate: t, toDateEfetivo: t }; }',
    'let _estData = [], _estFiltro = "todos", _estSemInfo = 0;',
    extrairFuncao('estGetSKUData'), extrairFuncao('renderEstoque'), extrairFuncao('recalcularGestaoComHistorico'),
    'let _grWeeks = {};',
    extrairFuncao('grSemanasEntre'), extrairFuncao('grCategoria'), extrairFuncao('grStatus'), extrairFuncao('grSemanasAlvo'),
    extrairFuncao('grSemanasDoSku'), extrairFuncao('grEstoquePorSku'), extrairFuncao('grVendasPorSku'), extrairFuncao('grBuildData'),
    `return {
      sku: (o, oi) => skuDaLinhaPedido(o, oi),
      telaGestao() { renderEstoque(); return Object.fromEntries(_estData.map(l => [l.sku, l])); },
      historicoChega() { _st.mem = true; allOrders = _ped; recalcularGestaoComHistorico(); return Object.fromEntries(_estData.map(l => [l.sku, l])); },
      gestaoAtual: () => Object.fromEntries(_estData.map(l => [l.sku, l])),
      giroVendas() { const g = gdrGet(); return grVendasPorSku(g.fromDate, g.toDate); },
      giro: () => Object.fromEntries(grBuildData().linhas.map(l => [l.sku, l])),
    };`,
  ].join('\n');
  const st = { mem: emMemoria };
  return new Function('_contas', '_sel', '_itens', '_ped', '_st', '_p30', fonte)(CONTAS, selecao, itens, pedidos, st, porItem30d);
}

const C = s => s + ' · Overwine';

describe('Bug 2 — seller_sku do pedido Amazon vem antes do ASIN', () => {
  test('21003: o pedido B0H2NHR771 / seller_sku 21003 vai para 21003, nao para o anuncio antigo 86-YFR2-YKJG', () => {
    const h = montar({ itens: [...CAT_ML, ...CAT_AMZ], selecao: OW });
    const o = PEDIDOS.find(p => p.order_items[0].item.id === 'B0H2NHR771');
    assert.equal(h.sku(o, o.order_items[0]), C('21003'));
  });

  test('ASINs antigos dos pedidos (relistagem) casam pelo seller_sku: 21002, 25001, 25301', () => {
    const h = montar({ itens: [...CAT_ML, ...CAT_AMZ], selecao: OW });
    for (const [asin, sku] of [['B0FCH81LW5', '21002'], ['B0F7YSZ77M', '25001'], ['B0H4DPK6RT', '25301']]) {
      const o = PEDIDOS.find(p => p.order_items[0].item.id === asin);
      assert.equal(h.sku(o, o.order_items[0]), C(sku), asin);
    }
  });

  test('ASIN ambiguo (B0HR33K4GH em 20321, 26401 e 25101): o seller_sku decide; sem seller_sku, ninguem recebe', () => {
    const h = montar({ itens: CAT_AMZ, selecao: ['alemmar-amazon'] });
    const com = pedAmz('B0HR33K4GH', '26401', 1, 1);
    assert.equal(h.sku(com, com.order_items[0]), '26401');
    const sem = pedAmz('B0HR33K4GH', null, 1, 1);
    assert.equal(h.sku(sem, sem.order_items[0]), null);
  });

  test('seller_sku sem anuncio na selecao: cai no ASIN (Amazon sozinha: 21003 -> 86-YFR2-YKJG, o mesmo produto)', () => {
    const h = montar({ itens: CAT_AMZ, selecao: ['alemmar-amazon'] });
    const o = PEDIDOS.find(p => p.order_items[0].item.id === 'B0H2NHR771');
    assert.equal(h.sku(o, o.order_items[0]), '86-YFR2-YKJG');
  });

  test('empresa validada: o seller_sku da Amazon Overwine nunca casa com SKU da Degustar', () => {
    const dg = { ...ml('21003', 635), id: 'MLBDG1', conta: 'degustar-ml' };
    const h = montar({ itens: [...CAT_ML, ...CAT_AMZ, dg], selecao: ['overwine-ml', 'alemmar-amazon', 'degustar-ml'] });
    const o = PEDIDOS.find(p => p.order_items[0].item.id === 'B0H2NHR771');
    assert.equal(h.sku(o, o.order_items[0]), C('21003'));
    const soDegustar = montar({ itens: [dg], selecao: ['degustar-ml'] });
    assert.equal(soDegustar.sku(o, o.order_items[0]), null, 'pedido Amazon nao vira venda da Degustar');
  });

  test('Mercado Livre identico: so o id do anuncio; seller_sku nao vale para o ML', () => {
    const h = montar({ itens: CAT_ML, selecao: ['overwine-ml'] });
    const o = PEDIDOS[0];
    assert.equal(h.sku(o, o.order_items[0]), '21002');
    const semAnuncio = { ...pedMl('MLB999', 1, 1), order_items: [{ item: { id: 'MLB999', seller_sku: '21002' }, quantity: 1 }] };
    assert.equal(h.sku(semAnuncio, semAnuncio.order_items[0]), null);
  });
});

describe('Bug 1 — Gestao recalculada quando o historico chega', () => {
  test('Overwine · Amazon, SEM historico: o agregado por ASIN antigo nao casa (limite do agregado) e 25301 nasce sem venda', () => {
    const h = montar({ itens: CAT_AMZ, selecao: ['alemmar-amazon'], emMemoria: false });
    const g = h.telaGestao();
    assert.equal(g['25301'].vel, 0);
    assert.equal(g['25301'].tipo, 'semvenda');
  });

  test('Overwine · Amazon, o historico CHEGA: 25301 = 4 un. / 30 dias, Excesso (cobertura 300 / 0,13)', () => {
    const h = montar({ itens: CAT_AMZ, selecao: ['alemmar-amazon'], emMemoria: false });
    h.telaGestao();
    const g = h.historicoChega();
    assert.equal(g['25301'].vel, vel(4));
    assert.equal(g['25301'].dias, Math.round(300 / vel(4)));
    assert.equal(g['25301'].tipo, 'excesso');
    // Regra de pausados intacta: os mais vendidos (pausados) continuam fora da Gestao.
    for (const s of ['21002', '25001', '86-YFR2-YKJG']) assert.ok(!g[s], s + ' pausado nao entra');
  });

  test('Overwine · Todos, o historico CHEGA: 21002, 21003 e 25001 somam ML + Amazon; classificacao corrigida', () => {
    const h = montar({ itens: [...CAT_ML, ...CAT_AMZ], selecao: OW, emMemoria: false });
    const antes = h.telaGestao();
    assert.equal(antes[C('21002')].vel, vel(215), 'antes: so o ML (o agregado nao casa o ASIN antigo)');
    const g = h.historicoChega();
    const esperado = {
      '21002': { u: 215 + 110, est: 2520 + 243 + 8, tipo: 'ok' },
      '21003': { u: 389 + 128, est: 627, tipo: 'alerta' },
      '25001': { u: 630 + 81, est: 319 + 198 + 158, tipo: 'ruptura' },
      '25301': { u: 4, est: 825 + 0, tipo: 'excesso' },
    };
    for (const [sku, e] of Object.entries(esperado)) {
      const l = g[C(sku)];
      assert.equal(l.vel, vel(e.u), sku + ' velocidade');
      assert.equal(l.est, e.est, sku + ' estoque fisico (regra intacta)');
      assert.equal(l.dias, Math.round(e.est / vel(e.u)), sku + ' cobertura');
      assert.equal(l.tipo, e.tipo, sku + ' classificacao');
    }
  });

  test('com historico desde o inicio: o mesmo resultado (historico OU agregado, nunca os dois)', () => {
    const g = montar({ itens: [...CAT_ML, ...CAT_AMZ], selecao: OW, emMemoria: true }).telaGestao();
    assert.equal(g[C('21002')].vel, vel(325));
    assert.equal(g[C('21003')].vel, vel(517));
    assert.equal(g[C('25001')].vel, vel(711));
    assert.equal(g[C('25301')].vel, vel(4));
  });

  test('sem historico, recalcular nao faz nada (nao troca a tela por zeros)', () => {
    const h = montar({ itens: [...CAT_ML, ...CAT_AMZ], selecao: OW, emMemoria: false });
    const antes = h.telaGestao();
    assert.equal(h.gestaoAtual()[C('21002')].vel, antes[C('21002')].vel);
  });
});

describe('Giro e contagem unica', () => {
  test('Giro (Overwine · Todos): vendido no periodo = ML + Amazon, 24 semanas', () => {
    const h = montar({ itens: [...CAT_ML, ...CAT_AMZ], selecao: OW });
    const v = h.giroVendas();
    assert.equal(v[C('21002')].totalQty, 325);
    assert.equal(v[C('21003')].totalQty, 517);
    assert.equal(v[C('25001')].totalQty, 711);
    assert.equal(v[C('25301')].totalQty, 4);
    assert.ok(!v[C('86-YFR2-YKJG')], 'nada vai para o anuncio antigo');
    const g = h.giro();
    assert.equal(g[C('21002')].vendido, 325);
    assert.equal(g[C('21002')].semanasSku, 24);
  });

  test('Giro (Overwine · Amazon): vendas Amazon por SKU, cancelados fora', () => {
    const v = montar({ itens: CAT_AMZ, selecao: ['alemmar-amazon'] }).giroVendas();
    assert.equal(v['21002'].totalQty, 110);
    assert.equal(v['25001'].totalQty, 81);
    assert.equal(v['25301'].totalQty, 4);
    assert.equal(v['86-YFR2-YKJG'].totalQty, 128);
  });

  test('nenhum pedido contado duas vezes: soma das vendas = soma das linhas validas', () => {
    const validas = PEDIDOS.filter(o => !String(o.status).includes('cancelled')).reduce((s, o) => s + o.order_items[0].quantity, 0);
    const h = montar({ itens: [...CAT_ML, ...CAT_AMZ], selecao: OW });
    const v = h.giroVendas();
    assert.equal(Object.values(v).reduce((s, x) => s + x.totalQty, 0), validas);
    // Cada linha de pedido resolve para UM SKU (nunca para o SKU e para o anuncio antigo).
    PEDIDOS.forEach(o => assert.equal(typeof h.sku(o, o.order_items[0]), 'string', String(o.id)));
    assert.equal(Object.keys(v).length, 4, 'so 21002, 21003, 25001 e 25301 recebem venda');
    const g = h.telaGestao();
    const somaGestao = ['21002', '21003', '25001', '25301'].reduce((s, k) => s + g[C(k)].vel, 0);
    assert.ok(Math.abs(somaGestao - (vel(325) + vel(517) + vel(711) + vel(4))) < 1e-9);
  });
});

describe('ganchos', () => {
  test('o historico novo recalcula a Gestao (carga sob demanda e atualizacao em segundo plano)', () => {
    assert.match(extrairFuncao('garantirPedidosCarregados'), /\.then\(\(\) => \{ recalcularGestaoComHistorico\(\); return allOrders; \}\)/);
    assert.match(extrairFuncao('atualizarPedidosEmMemoria'), /recalcularGestaoComHistorico\(\);/);
  });
  test('Gestao com Amazon na selecao pede o historico ao abrir', () => {
    assert.match(extrairFuncao('switchTab'), /tab === 'estoque' && selecaoTemAmazon\(\) && !pedidosEmMemoria\(\)\) comHistorico\('Gestao de Estoque', renderEstoque\)/);
  });
});

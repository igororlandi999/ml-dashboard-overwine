/**
 * HOTFIX FINAL — venda Amazon (ASIN) casa com o SKU fisico; 24 semanas da
 * Overwine por EMPRESA; rotulo do Giro; Degustar sem FBA.
 *
 * Causa travada aqui: o pedido Amazon traz `order_items[].item.id = ASIN`
 * ("B0FCH81LW5") e `item.seller_sku = "21002"`; o catalogo tem
 * `id = "21002#fba"` e o ASIN em `asin`. Indexar so `i.id` descartava toda
 * venda Amazon em Gestao, Giro, Consolidado e Analise de Preco.
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
const ASIN = 'B0FCH81LW5';

// ── Fixture: datas relativas a agora (Gestao usa os ultimos 30 dias reais) ──
const diasAtras = n => new Date(Date.now() - n * 86400000).toISOString();
const mlItem = (id, sku, q, extra = {}) => ({ id, title: 'Vinho ' + sku, status: 'active', price: 40, conta: 'overwine-ml', seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'xd_drop_off' }, tags: [], ...extra });
const amzProprio = (sku, asin, q, extra = {}) => ({ id: sku, title: 'Vinho ' + sku, status: 'active', price: 40, canal: 'amazon', conta: 'alemmar-amazon', seller_custom_field: sku, seller_sku: sku, asin, available_quantity: q, shipping: { logistic_type: 'amazon_proprio' }, tags: null, amazon: { estoqueInformado: true }, ...extra });
const amzFba = (sku, asin, q, extra = {}) => ({ id: sku + '#fba', title: 'Vinho ' + sku, status: 'active', price: 40, canal: 'amazon', conta: 'alemmar-amazon', seller_custom_field: sku, seller_sku: sku, asin, available_quantity: q, inventory_id: 'X005', shipping: { logistic_type: 'amazon_fba' }, tags: null, amazon: { estoqueInformado: true }, ...extra });
let _oid = 0;
const pedML = (itemId, qtd, quando, status = 'paid') => ({ id: 'ML' + (++_oid), status, conta: 'overwine-ml', date_created: quando, order_items: [{ item: { id: itemId, title: 'x' }, quantity: qtd, unit_price: 40 }] });
const pedAmz = (asin, sku, qtd, quando, status = 'amazon:shipped') => ({ id: '702-' + (++_oid), canal: 'amazon', status, conta: 'alemmar-amazon', date_created: quando, order_items: [{ item: { id: asin, title: 'x', seller_sku: sku, variation_id: null }, quantity: qtd, unit_price: 39.9 }] });

function montar({ itens, pedidos = [], selecao = ['alemmar-amazon'], emMemoria = true, porItem30d = null, semanas = '', apSku = '' } = {}) {
  const fonte = [
    "const CONTA_LEGADA = 'overwine-ml';",
    'let CONTAS_DISPONIVEIS = _contas, SELECAO = _sel;',
    extrairFuncao('selecaoLegada'), extrairFuncao('selecaoConsolidada'), extrairFuncao('selecaoChave'), extrairFuncao('contaInfo'),
    'function empresaNome(r) { return r; }', extrairFuncao('empresaDaConta'),
    extrairFuncao('contaDaEmpresaOverwine'), extrairFuncao('contaEhAmazon'), extrairFuncao('selecaoTemAmazon'),
    extrairFuncao('selecaoDaEmpresaOverwine'), extrairFuncao('estoqueMostraFba'),
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('dentroDoPeriodo'),
    'let allItems = _itens, allOrders = _ped;',
    'let _metrics = _p30 ? { estoque30d: { porItem: _p30 } } : null;',
    'function pedidosEmMemoria() { return _mem; }',
    extrairFuncao('_skuDoVendedor'), 'let _indiceCatalogo = { ref: null, mapa: null };', extrairFuncao('_skuPorCatalogo'), extrairFuncao('itemSKU'),
    extrairFuncao('rotuloIdentidade'),
    'let _indiceItemSku = { ref: null, n: -1, sel: null, ids: null, vend: null };',
    extrairFuncao('_registrarChave'), extrairFuncao('indiceItemSku'), extrairFuncao('skuDoIdentificador'), extrairFuncao('skuDaLinhaPedido'),
    extrairFuncao('isFullItem'), extrairFuncao('fullStockKey'), extrairFuncao('isFbaItem'), extrairFuncao('consolidarEstoqueGrupo'),
    extrairFuncao('_qtdInformada'), extrairFuncao('estoqueFisicoDoGrupo'), extrairFuncao('estoqueFisicoTotal'), extrairConstante('ROTULO_PENDENCIA_ESTOQUE'),
    extrairFuncao('estoqueDoGrupo'),
    'const MOD_PLACEHOLDER = "\\u2014";',
    'function escHtml(x) { return String(x); } function fmtPrice(v) { return String(v); }',
    'const _dom = { "gr-semanas": { value: _sem }, "ap-produto": { value: _ap } };',
    'const document = { querySelectorAll: () => [], getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", title: "", style: {}, value: "" }) };',
    'function gdrGet() { const f = new Date(Date.now() - 40 * 86400000), t = new Date(Date.now() + 86400000); return { fromDate: f, toDate: t, toDateEfetivo: t }; }',
    'let _estData = [], _estFiltro = "todos", _estSemInfo = 0;',
    extrairFuncao('renderKPIs'), extrairFuncao('estGetSKUData'), extrairFuncao('renderEstoque'),
    'let _grWeeks = {};',
    extrairFuncao('grSemanasEntre'), extrairFuncao('grCategoria'), extrairFuncao('grStatus'), extrairFuncao('grSemanasAlvo'),
    extrairFuncao('grSemanasDoSku'), extrairFuncao('grEstoquePorSku'), extrairFuncao('grVendasPorSku'), extrairFuncao('grBuildData'),
    extrairFuncao('apColetarVendas'),
    extrairFuncao('consVendasDoPeriodo'), extrairFuncao('buildConsolidado'),
    `return {
      sku: (o, oi) => skuDaLinhaPedido(o, oi),
      porId: id => skuDoIdentificador(id),
      gestao() { return estGetSKUData(); },
      giroVendas() { const g = gdrGet(); return grVendasPorSku(g.fromDate, g.toDate); },
      giro() { return grBuildData(); },
      semanasAlvo: () => grSemanasAlvo(),
      ap: () => apColetarVendas(),
      consolidado: () => Object.fromEntries(buildConsolidado().map(d => [d.sku, d])),
      home() { renderKPIs(); return _dom; },
      tabela() { renderEstoque(); return _dom; },
    };`,
  ].join('\n');
  return new Function('_contas', '_sel', '_itens', '_ped', '_mem', '_p30', '_sem', '_ap', fonte)(CONTAS, selecao, itens, pedidos, emMemoria, porItem30d, semanas, apSku);
}

// Catalogo Amazon real (formato do snapshot): so a linha FBA do 21002.
const CAT_AMZ = [amzFba('21002', ASIN, 73), amzProprio('25001', 'B0F7YSZ77M', 10), amzFba('25001', 'B0F7YSZ77M', 5)];
const AMZ_53 = [pedAmz(ASIN, '21002', 50, diasAtras(3)), pedAmz(ASIN, '21002', 3, diasAtras(10), 'amazon:pending')];

describe('resolucao unica identificador -> SKU', () => {
  test('1. pedido com item.id = ASIN e seller_sku 21002; catalogo 21002#fba com asin → SKU 21002', () => {
    const h = montar({ itens: CAT_AMZ });
    const o = AMZ_53[0];
    assert.equal(h.sku(o, o.order_items[0]), '21002');
    assert.equal(h.porId(ASIN), '21002');
    assert.equal(h.porId('21002#fba'), '21002', 'o id do anuncio continua casando');
  });

  test('2. linha propria + FBA com o MESMO ASIN e o mesmo SKU: nao e ambiguidade e a venda conta UMA vez', () => {
    const itens = [amzProprio('21002', ASIN, 20), amzFba('21002', ASIN, 73)];
    const h = montar({ itens, pedidos: AMZ_53 });
    assert.equal(h.porId(ASIN), '21002');
    assert.equal(h.giroVendas()['21002'].totalQty, 53);
    const g = h.gestao().find(l => l.sku === '21002');
    assert.equal(g.vel, +(53 / 30).toFixed(2), 'uma vez por SKU, nao uma vez por anuncio');
  });

  test('3. mesmo ASIN em dois SKUs fisicos diferentes: ambiguo, a venda nao vai para nenhum', () => {
    const itens = [amzFba('21002', ASIN, 73), amzFba('99999', ASIN, 8)];
    const h = montar({ itens, pedidos: [pedAmz(ASIN, null, 5, diasAtras(2))] });
    assert.equal(h.porId(ASIN), null);
    const o = h.giroVendas();
    assert.ok(!o['21002'] && !o['99999'], 'nem o primeiro nem o ultimo');
    assert.ok(h.gestao().every(l => l.vel === 0));
  });

  test('4. Mercado Livre: o casamento por id do anuncio fica identico (pausado, ativo, sem SKU)', () => {
    const itens = [mlItem('MLB1', '21101', 10), mlItem('MLB2', '21101', 0, { status: 'paused' }), mlItem('MLB3', null, 4, { seller_custom_field: null })];
    const ped = [pedML('MLB1', 2, diasAtras(1)), pedML('MLB2', 3, diasAtras(2)), pedML('MLB3', 1, diasAtras(2)), pedML('MLB404', 9, diasAtras(2)), pedML('MLB1', 7, diasAtras(2), 'cancelled')];
    const h = montar({ itens, pedidos: ped, selecao: ['overwine-ml'] });
    assert.deepEqual(Object.fromEntries(Object.entries(h.giroVendas()).map(([k, v]) => [k, v.totalQty])), { 21101: 5, 'sem-sku-MLB3': 1 });
    const g = Object.fromEntries(h.gestao().map(l => [l.sku, l.vel]));
    assert.equal(g['21101'], +(2 / 30).toFixed(2), 'Gestao: so os anuncios ATIVOS do SKU (regra A7 intacta)');
    assert.equal(h.porId('MLB404'), null, 'anuncio fora do catalogo continua sem SKU');
  });
});

describe('Gestao, Giro, Consolidado e Analise de Preco com venda Amazon', () => {
  const ITENS_CONS = [mlItem('MLB10', '21002', 100), amzFba('21002', ASIN, 73)];
  const PED_CONS = [pedML('MLB10', 140, diasAtras(5)), pedAmz(ASIN, '21002', 51, diasAtras(6))];

  test('5./9. consolidado Overwine: ML + Amazon do mesmo SKU somam (140 + 51 = 191)', () => {
    const h = montar({ itens: ITENS_CONS, pedidos: PED_CONS, selecao: ['overwine-ml', 'alemmar-amazon'] });
    const chave = '21002 · Overwine';
    assert.equal(h.giroVendas()[chave].totalQty, 191);
    assert.equal(h.consolidado()[chave].vendasTotal, 191);
    assert.equal(h.consolidado()[chave].pedidosCnt, 2);
  });

  test('6. Gestao: a velocidade Amazon deixa de ser zero (53 unidades em 30 dias)', () => {
    const h = montar({ itens: CAT_AMZ, pedidos: AMZ_53 });
    const g = h.gestao().find(l => l.sku === '21002');
    assert.equal(g.vel, +(53 / 30).toFixed(2));
    assert.notEqual(g.tipo, 'semvenda');
    assert.equal(g.dias, Math.round(73 / g.vel));
  });

  test('7. Giro: as vendas Amazon aparecem', () => {
    const h = montar({ itens: CAT_AMZ, pedidos: AMZ_53 });
    const l = h.giro().linhas.find(x => x.sku === '21002');
    assert.equal(l.vendido, 53);
    assert.notEqual(l.status, 'semgiro');
  });

  test('8. Analise de Preco: a venda Amazon casa com o produto', () => {
    const h = montar({ itens: CAT_AMZ, pedidos: AMZ_53, apSku: '21002' });
    const v = h.ap();
    assert.equal(v.length, 2);
    assert.equal(v.reduce((s, x) => s + x.qtd, 0), 53);
  });

  test('10. agregado estoque30d.porItem por ASIN casa, e nao soma com o historico', () => {
    const p30 = [{ itemId: ASIN, unidades: 53 }];
    const soAgregado = montar({ itens: CAT_AMZ, emMemoria: false, porItem30d: p30 }).gestao().find(l => l.sku === '21002');
    assert.equal(soAgregado.vel, +(53 / 30).toFixed(2));
    const comHistorico = montar({ itens: CAT_AMZ, pedidos: AMZ_53, emMemoria: true, porItem30d: p30 }).gestao().find(l => l.sku === '21002');
    assert.equal(comHistorico.vel, +(53 / 30).toFixed(2), 'historico tem precedencia; o agregado nao entra junto');
    const mlAgregado = montar({ itens: [mlItem('MLB1', '21101', 10)], selecao: ['overwine-ml'], emMemoria: false, porItem30d: [{ itemId: 'MLB1', unidades: 30 }] }).gestao()[0];
    assert.equal(mlAgregado.vel, 1, 'ML pelo agregado: igual a antes');
  });

  test('11. amazon:cancelled nao entra em nenhuma tela', () => {
    const ped = [...AMZ_53, pedAmz(ASIN, '21002', 9, diasAtras(2), 'amazon:cancelled')];
    const h = montar({ itens: CAT_AMZ, pedidos: ped, apSku: '21002' });
    assert.equal(h.giroVendas()['21002'].totalQty, 53);
    assert.equal(h.gestao().find(l => l.sku === '21002').vel, +(53 / 30).toFixed(2));
    assert.equal(h.ap().reduce((s, x) => s + x.qtd, 0), 53);
  });

  test('seller_sku do pedido Amazon casa dentro da mesma empresa e nunca vale para o ML', () => {
    const h = montar({ itens: [amzFba('21002', null, 73)] });   // anuncio sem asin
    const amz = pedAmz('B0NOVOASIN', '21002', 2, diasAtras(1));
    assert.equal(h.sku(amz, amz.order_items[0]), '21002');
    const mlSemId = { ...pedML('MLB999', 1, diasAtras(1)), order_items: [{ item: { id: 'MLB999', seller_sku: '21002' }, quantity: 1 }] };
    assert.equal(h.sku(mlSemId, mlSemId.order_items[0]), null, 'Mercado Livre nao ganha casamento novo');
  });
});

describe('24 semanas da Overwine decididas por EMPRESA', () => {
  const itens = [mlItem('MLB1', '21101', 10)];
  test('12. Overwine ML → 24 semanas', () => assert.equal(montar({ itens, selecao: ['overwine-ml'] }).semanasAlvo(), 24));
  test('13. Overwine Amazon → 24 semanas', () => assert.equal(montar({ itens, selecao: ['alemmar-amazon'] }).semanasAlvo(), 24));
  test('14. Overwine Todos (ML + Amazon) → 24 semanas', () => assert.equal(montar({ itens, selecao: ['overwine-ml', 'alemmar-amazon'] }).semanasAlvo(), 24));
  test('15. Degustar → a configuracao da Overwine NAO se aplica', () => assert.equal(montar({ itens, selecao: ['degustar-ml'] }).semanasAlvo(), null));
  test('16. mistura de empresas → nao se aplica', () => assert.equal(montar({ itens, selecao: ['overwine-ml', 'alemmar-amazon', 'degustar-ml'] }).semanasAlvo(), null));
  test('valor informado continua valendo; o numero 24 nao mudou', () => {
    assert.equal(montar({ itens, selecao: ['overwine-ml', 'alemmar-amazon'], semanas: '12' }).semanasAlvo(), 12);
    assert.equal(montar({ itens, selecao: ['degustar-ml'], semanas: '8' }).semanasAlvo(), 8);
    assert.match(extrairFuncao('aplicarSelecaoNaInterface'), /selecaoDaEmpresaOverwine\(\) \? '24' : ''/);
  });
});

describe('rotulos', () => {
  test('25. Giro: o card de estoque nao diz "todos os SKUs" (SKU so pausado fica fora da populacao)', () => {
    assert.ok(!/todos os SKUs/.test(html));
    assert.match(html, /id="gr-c-estoque">-<\/div>\s*<div class="kpi-delta neutral">unidades nos SKUs com anúncio ativo<\/div>/);
    // A populacao do Giro nao mudou: o SKU so pausado continua fora.
    const itens = [mlItem('MLB1', '21101', 10), mlItem('MLB2', 'BALUNFRV', 7, { status: 'paused' })];
    const h = montar({ itens, selecao: ['overwine-ml'] });
    assert.deepEqual(h.giro().linhas.map(l => l.sku), ['21101']);
  });

  test('26. Degustar: nada de FBA no subtitulo, no title e na tabela', () => {
    const itens = [mlItem('D1', 'DG1', 5, { conta: 'degustar-ml' })];
    const h = montar({ itens, selecao: ['degustar-ml'] });
    const d = h.home();
    assert.equal(d['kpi-stock-sub'].textContent, 'próprio + Full');
    assert.ok(!/FBA/.test(d['kpi-stock'].title));
    const t = h.tabela();
    assert.equal(t['est-th-fba'].style.display, 'none');
    assert.equal(t['est-th-total'].title, 'Próprio + Full');
    assert.equal((t['est-table'].innerHTML.match(/<td/g) || []).length, 8, '8 colunas, sem a de FBA');
    assert.match(html, /id="kpi-stock-sub">estoque físico</, 'texto inicial neutro, sem FBA');
  });

  test('27. Overwine (ML, Amazon e Todos) continua mostrando FBA', () => {
    for (const selecao of [['overwine-ml'], ['alemmar-amazon'], ['overwine-ml', 'alemmar-amazon']]) {
      const h = montar({ itens: [mlItem('MLB1', '21101', 10), amzFba('21101', 'B0X', 4)], selecao });
      const d = h.home();
      assert.match(d['kpi-stock'].title, /FBA/, selecao.join('+'));
      assert.equal(d['kpi-stock-sub'].textContent, 'próprio + Full + FBA', selecao.join('+'));
      const t = h.tabela();
      assert.equal(t['est-th-fba'].style.display, '', selecao.join('+'));
      assert.equal((t['est-table'].innerHTML.match(/<td/g) || []).length, 9, selecao.join('+'));
    }
  });
});

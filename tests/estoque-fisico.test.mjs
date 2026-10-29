/**
 * FASE A6 — Estoque fisico consolidado sem dupla contagem.
 *
 * Travado aqui:
 *  - estoqueFisicoDoGrupo e a definicao unica: proprio UNICO + ML Full + Amazon FBA;
 *  - o proprio espelhado (varios anuncios ML, linha propria da Amazon) conta
 *    UMA vez; Degustar so deduplica com vinculo explicito;
 *  - Full e FBA somam; zero e valido em todos os componentes;
 *  - componente nao informado (Amazon `null`, SKU Amazon sem linha `#fba`)
 *    nunca vira 0 — nem por inferencia de FBA de outro SKU: total PARCIAL;
 *  - estoque fisico nao depende do status do anuncio (ativo/pausado);
 *  - chave = itemSKU (SKU do vendedor; empresa no consolidado); titulo nunca;
 *  - Home, Gestao de Estoque e Consolidado usam a mesma definicao;
 *  - ruptura/giro/previsao e as demais areas nao mudam.
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

// ── Anuncios de fixture ──────────────────────────────────────────────────────
let _n = 0;
const mlProprio = (sku, q, extra = {}) => ({ id: 'MLB' + (++_n), title: 'Vinho ' + sku, status: 'active', price: 100, seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'xd_drop_off' }, tags: [], inventory_id: null, ...extra });
const mlFull = (sku, q, inv, extra = {}) => ({ id: 'MLB' + (++_n), title: 'Vinho ' + sku, status: 'active', price: 100, seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'fulfillment' }, tags: [], inventory_id: inv, ...extra });
const amzProprio = (sku, q, extra = {}) => ({ id: sku, title: 'Vinho ' + sku, status: 'active', price: 100, canal: 'amazon', conta: 'alemmar-amazon', seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'amazon_proprio' }, tags: null, inventory_id: null, amazon: { estoque: 'proprio', estoqueInformado: q !== null }, ...extra });
const amzFba = (sku, q, extra = {}) => ({ id: sku + '#fba', title: 'Vinho ' + sku, status: 'active', price: 100, canal: 'amazon', conta: 'alemmar-amazon', seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'amazon_fba' }, tags: null, inventory_id: 'FN' + sku, amazon: { estoque: 'fba', estoqueInformado: q !== null }, ...extra });
const ow = o => ({ ...o, conta: 'overwine-ml' });

function montar({ itens = [], selecao = ['overwine-ml'] } = {}) {
  const fonte = [
    "const CONTA_LEGADA = 'overwine-ml';",
    'let CONTAS_DISPONIVEIS = _contas, SELECAO = _sel;',
    extrairFuncao('selecaoLegada'), extrairFuncao('selecaoConsolidada'), extrairFuncao('contaInfo'),
    'function empresaNome(r) { return r; }', extrairFuncao('empresaDaConta'),
    extrairFuncao('contaDaEmpresaOverwine'), extrairFuncao('pedidoAmazon'),
    'let allItems = _itens, allOrders = [], _metrics = null;',
    'function pedidosEmMemoria() { return false; }',
    extrairFuncao('_skuDoVendedor'), 'let _indiceCatalogo = { ref: null, mapa: null };', extrairFuncao('_skuPorCatalogo'), extrairFuncao('itemSKU'),
    extrairFuncao('rotuloIdentidade'),
    extrairFuncao('isFullItem'), extrairFuncao('fullStockKey'), extrairFuncao('isFbaItem'), extrairFuncao('consolidarEstoqueGrupo'),
    extrairFuncao('_qtdInformada'),
    extrairFuncao('estoqueFisicoDoGrupo'), extrairFuncao('estoqueFisicoTotal'), extrairConstante('ROTULO_PENDENCIA_ESTOQUE'),
    extrairFuncao('estoqueDoGrupo'),
    'const MOD_PLACEHOLDER = "\\u2014";',
    'function escHtml(x) { return String(x); } function fmtPrice(v) { return String(v); }',
    'const _dom = {}; const document = { querySelectorAll: () => [], getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", title: "", style: {} }) };',
    'let _estData = [], _estFiltro = "todos", _estSemInfo = 0;',
    extrairFuncao('renderKPIs'), extrairFuncao('estGetSKUData'), extrairFuncao('renderEstoque'),
    `return {
      grupo: items => estoqueFisicoDoGrupo(items),
      total: items => estoqueFisicoTotal(items || allItems),
      doGrupo: items => estoqueDoGrupo(items),
      sku: i => itemSKU(i),
      home() { renderKPIs(); return _dom; },
      gestao() { renderEstoque(); return { dom: _dom, dados: _estData }; },
    };`,
  ].join('\n');
  return new Function('_contas', '_sel', '_itens', fonte)(CONTAS, selecao, itens);
}
const comp = f => [f.proprio, f.mlFull, f.amazonFba, f.totalFisico];

describe('definicao: proprio unico + ML Full + Amazon FBA', () => {
  test('1. proprio 10, Full 4, FBA 6 → 20', () => {
    const f = montar().grupo([mlProprio('A', 10), mlFull('A', 4, 'INV-A'), amzProprio('A', 10), amzFba('A', 6)]);
    assert.deepEqual(comp(f), [10, 4, 6, 20]);
    assert.equal(f.completo, true);
    assert.deepEqual(f.fontes, { proprio: 'catalogo_espelho_unico', mlFull: 'catalogo_full', amazonFba: 'catalogo_fba' });
  });

  test('2. proprio espelhado ML 10 + Amazon proprio 10 → proprio 10 (nunca 20)', () => {
    const f = montar().grupo([mlProprio('A', 10), amzProprio('A', 10), amzFba('A', 0)]);
    assert.equal(f.proprio, 10);
    // com inventory_id no anuncio do ML, a linha da Amazon continua sendo espelho
    assert.equal(montar().grupo([mlProprio('A', 10, { inventory_id: 'INV-P' }), amzProprio('A', 10), amzFba('A', 0)]).proprio, 10);
  });

  test('3. espelhado + Full + FBA → 10 + 4 + 6 = 20', () => {
    const f = montar().grupo([mlProprio('A', 10), mlProprio('A', 10), amzProprio('A', 10), mlFull('A', 4, 'INV-A'), amzFba('A', 6)]);
    assert.deepEqual(comp(f), [10, 4, 6, 20]);
  });

  test('4. dois anuncios ML proprios do mesmo SKU (Overwine) → nao duplica', () => {
    assert.equal(montar().grupo([mlProprio('A', 10), mlProprio('A', 10)]).proprio, 10);
    assert.equal(montar().grupo([mlProprio('A', 10, { inventory_id: 'I1' }), mlProprio('A', 10, { inventory_id: 'I1' })]).proprio, 10);
    // dois anuncios Full do mesmo inventory_id: um saldo
    assert.equal(montar().grupo([mlFull('A', 4, 'INV-A'), mlFull('A', 4, 'INV-A')]).mlFull, 4);
  });

  test('5. dois SKUs diferentes somam no total geral', () => {
    const h = montar({ itens: [mlProprio('A', 10), mlProprio('A', 10), mlProprio('B', 7)] });
    const t = h.total();
    assert.deepEqual([t.produtos, t.proprio, t.totalFisico], [2, 17, 17]);
  });

  test('6/7/8. zero e valido em FBA, Full e proprio (completo, nao "nao informado")', () => {
    const f = montar().grupo([mlProprio('A', 0), mlFull('A', 0, 'INV-A'), amzProprio('A', 0), amzFba('A', 0)]);
    assert.deepEqual(comp(f), [0, 0, 0, 0]);
    assert.equal(f.completo, true);
    assert.deepEqual(f.pendencias, []);
  });
});

describe('fonte ausente nunca vira zero', () => {
  test('9. SKU com Amazon e sem linha #fba → FBA nao informado, total parcial', () => {
    const h = montar({ itens: [mlProprio('A', 12), amzProprio('A', 12)] });
    const f = h.grupo([mlProprio('A', 12), amzProprio('A', 12)]);
    assert.deepEqual(comp(f), [12, 0, null, null]);
    assert.equal(f.completo, false);
    assert.equal(f.totalConhecido, 12);
    assert.deepEqual(f.pendencias, ['fba_nao_informado']);
  });

  test('9b. FBA de OUTRO SKU da mesma conta nao vira FBA 0 para este: SKU A segue null', () => {
    const itens = [ow(mlProprio('A', 12)), amzProprio('A', 12), amzProprio('B', 3), amzFba('B', 5)];
    const h = montar({ itens, selecao: ['overwine-ml', 'alemmar-amazon'] });
    assert.equal(h.sku(itens[0]), h.sku(itens[1]), 'ML e Amazon da mesma empresa: um produto');
    const a = h.grupo(itens.slice(0, 2));
    assert.deepEqual(comp(a), [12, 0, null, null]);
    assert.deepEqual(a.pendencias, ['fba_nao_informado']);
    assert.notEqual(a.amazonFba, 0);
    const b = h.grupo(itens.slice(2));
    assert.deepEqual(comp(b), [3, 0, 5, 8]);
    // a Home soma o que se sabe e declara o parcial
    const t = h.total();
    assert.deepEqual([t.totalConhecido, t.totalFisico, t.incompletos], [20, null, 1]);
  });

  test('9d. linha #fba presente com 0 → FBA 0 valido; com N → N', () => {
    assert.deepEqual(comp(montar().grupo([amzProprio('A', 4), amzFba('A', 0)])), [4, 0, 0, 4]);
    assert.deepEqual(comp(montar().grupo([amzProprio('A', 4), amzFba('A', 9)])), [4, 0, 9, 13]);
  });

  test('9c. linha #fba com quantidade nao informada (null) → FBA nao informado', () => {
    const f = montar().grupo([mlProprio('A', 12), amzProprio('A', 12), amzFba('A', null)]);
    assert.equal(f.amazonFba, null);
    assert.equal(f.totalFisico, null);
  });

  test('10. anuncios sem SKU nem catalogo: cada um e um produto, mesmo com titulo igual', () => {
    const a = mlProprio('X', 5, { seller_custom_field: null, title: 'Vinho Igual' });
    const b = mlProprio('X', 5, { seller_custom_field: null, title: 'Vinho Igual' });
    const h = montar({ itens: [a, b] });
    assert.notEqual(h.sku(a), h.sku(b));
    assert.deepEqual([h.total().produtos, h.total().totalFisico], [2, 10]);
    assert.ok(!/title|normalize/i.test(extrairFuncao('estoqueFisicoDoGrupo')));
  });
});

describe('contas e empresas', () => {
  const SEL = ['overwine-ml', 'alemmar-amazon', 'degustar-ml'];

  test('11. Degustar nunca recebe Amazon/FBA: mesmo codigo de SKU vira produtos separados', () => {
    const itens = [ow(mlProprio('A', 12)), amzProprio('A', 12), amzFba('A', 8), mlProprio('A', 30, { conta: 'degustar-ml' })];
    const h = montar({ itens, selecao: SEL });
    assert.notEqual(h.sku(itens[3]), h.sku(itens[1]));
    const deg = h.grupo([itens[3]]);
    assert.deepEqual(comp(deg), [30, 0, 0, 30]);
    assert.equal(deg.fontes.amazonFba, 'nao_se_aplica');
    const t = h.total();
    assert.deepEqual([t.produtos, t.proprio, t.amazonFba, t.totalFisico], [2, 42, 8, 50]);
  });

  test('11b. Degustar com dois anuncios proprios sem vinculo explicito: proprio nao afirmado', () => {
    const d = (q, extra) => mlProprio('D', q, { conta: 'degustar-ml', ...extra });
    const h = montar({ selecao: SEL });
    const f = h.grupo([d(137), d(137)]);
    assert.equal(f.proprio, null);
    assert.deepEqual(f.pendencias, ['compartilhamento_nao_confirmado']);
    assert.deepEqual(f.porAnuncio, [137, 137]);
    assert.equal(h.grupo([d(137, { user_product_id: 'U1' }), d(137, { user_product_id: 'U1' })]).proprio, 137);
  });

  test('12. consolidado Overwine ML + Amazon: proprio nao duplica, FBA soma', () => {
    const itens = [ow(mlProprio('A', 12)), ow(mlProprio('A', 12)), ow(mlFull('A', 5, 'INV-A')), amzProprio('A', 12), amzFba('A', 8)];
    const h = montar({ itens, selecao: ['overwine-ml', 'alemmar-amazon'] });
    assert.equal(new Set(itens.map(h.sku)).size, 1, 'mesma chave: mesma empresa');
    const t = h.total();
    assert.deepEqual([t.produtos, t.proprio, t.mlFull, t.amazonFba, t.totalFisico], [1, 12, 5, 8, 25]);
  });

  test('13. produto so na Amazon: proprio + FBA; proprio nao informado fica parcial', () => {
    assert.deepEqual(comp(montar().grupo([amzProprio('Z', 12), amzFba('Z', 8)])), [12, 0, 8, 20]);
    const f = montar().grupo([amzProprio('Z', null), amzFba('Z', 8)]);
    assert.deepEqual(comp(f), [null, 0, 8, null]);
    assert.equal(f.totalConhecido, 8);
    assert.deepEqual(f.pendencias, ['proprio_nao_informado']);
    // so FBA (sem canal proprio): proprio 0, nao se inventa espelho
    assert.deepEqual(comp(montar().grupo([amzFba('Z', 8)])), [0, 0, 8, 8]);
  });

  test('14. produto so no ML: proprio + Full, FBA nao se aplica', () => {
    const f = montar().grupo([mlProprio('M', 7), mlFull('M', 3, 'INV-M')]);
    assert.deepEqual(comp(f), [7, 3, 0, 10]);
    assert.equal(f.fontes.amazonFba, 'nao_se_aplica');
  });
});

describe('telas', () => {
  // Fixture da verificacao numerica: SKU A (25) + SKU B (7) = 32; soma crua = 56.
  const FIX = () => [
    mlProprio('A', 12), mlProprio('A', 12), mlFull('A', 5, 'INV-A'), amzProprio('A', 12), amzFba('A', 8),
    mlProprio('B', 7), mlFull('B', 0, 'INV-B'),
  ];

  test('Home: "Estoque Fisico" = 32 (soma crua dos anuncios daria 56)', () => {
    const itens = FIX();
    const d = montar({ itens }).home();
    assert.equal(itens.reduce((s, i) => s + i.available_quantity, 0), 56);
    assert.equal(d['kpi-stock'].textContent, '32');
    assert.equal(d['kpi-stock-sub'].textContent, 'próprio + Full + FBA');
    assert.equal(d['kpi-stock'].title, 'Próprio 19 · Full 5 · FBA 8');
  });

  test('Home: total parcial identificado quando falta FBA', () => {
    const d = montar({ itens: [mlProprio('A', 12), amzProprio('A', 12), mlProprio('B', 7)] }).home();
    assert.equal(d['kpi-stock'].textContent, '19');
    assert.equal(d['kpi-stock-sub'].textContent, 'parcial · 1 produto sem saldo informado');
    assert.match(d['kpi-stock'].title, /FBA não informado em 1/);
  });

  test('Home: "Sem Estoque" conta anuncio com 0, nao anuncio com saldo nao informado', () => {
    const d = montar({ itens: [mlProprio('A', 0), amzProprio('B', null), amzProprio('C', 3)] }).home();
    assert.equal(d['kpi-nostock'].textContent, 1);
  });

  test('Gestao de Estoque: colunas Proprio · Full · FBA · Total fisico pela mesma definicao; cobertura intacta', () => {
    const r = montar({ itens: FIX() }).gestao();
    const a = r.dados.find(g => g.sku === 'A');
    assert.deepEqual(comp(a.fis), [12, 5, 8, 25]);
    assert.equal(a.est, 25, 'FASE A7: a cobertura usa o total fisico');
    const tabela = r.dom['est-table'].innerHTML.replace(/\s+/g, ' ');
    assert.match(tabela, />12<\/td> <td[^>]*>5<\/td> <td[^>]*>8<\/td> <td[^>]*>25<\/td>/);
    assert.match(tabela, />7<\/td> <td[^>]*>0<\/td> <td[^>]*>0<\/td> <td[^>]*>7<\/td>/);
  });

  test('estoque fisico nao depende do status: anuncio pausado com Full entra; Home e Gestao dao o mesmo total do SKU', () => {
    const itens = [mlProprio('P', 10), mlFull('P', 6, 'INV-P', { status: 'paused' }), amzProprio('P', 10, { status: 'paused' }), amzFba('P', 4, { status: 'paused' })];
    const h = montar({ itens });
    const d = h.home();
    assert.equal(d['kpi-stock'].textContent, '20');
    const r = h.gestao();
    const p = r.dados.find(g => g.sku === 'P');
    assert.deepEqual(comp(p.fis), [10, 6, 4, 20]);
    assert.equal(p.fis.totalFisico, h.total().totalFisico);
    assert.equal(p.anuncios, 1, 'a linha e a cobertura continuam so com os ativos (A7)');
    const tabela = r.dom['est-table'].innerHTML.replace(/\s+/g, ' ');
    assert.match(tabela, />10<\/td> <td[^>]*>6<\/td> <td[^>]*>4<\/td> <td[^>]*>20<\/td>/);
    // FASE A7: a cobertura usa o mesmo total fisico (pausados inclusive)
    assert.equal(p.est, 20);
  });

  test('Gestao: componente nao informado aparece "—", nunca 0', () => {
    const r = montar({ itens: [mlProprio('A', 12), amzProprio('A', 12)] }).gestao();
    const tabela = r.dom['est-table'].innerHTML.replace(/\s+/g, ' ');
    assert.match(tabela, />12<\/td> <td[^>]*>0<\/td> <td[^>]*title="FBA não informado">—<\/td> <td[^>]*title="FBA não informado">—<\/td>/);
  });

  test('Consolidado: mesma definicao; parcial identificado; zero aparece como 0', () => {
    const h = montar();
    assert.deepEqual(h.doGrupo([mlProprio('A', 12), amzProprio('A', 12), amzFba('A', 8)]), { valor: 20, confirmado: true, porAnuncio: null });
    assert.deepEqual(h.doGrupo([mlProprio('A', 12), amzProprio('A', 12)]), { valor: null, confirmado: true, porAnuncio: null, parcial: 12, pendencias: ['fba_nao_informado'] });
    assert.deepEqual(h.doGrupo([mlProprio('A', 0)]), { valor: 0, confirmado: true, porAnuncio: null });
    const b = extrairFuncao('renderConsolidado');
    assert.match(b, /data-estoque="parcial"/);
    assert.match(b, /d\.estTotal\.toLocaleString\('pt-BR'\)/);
    assert.ok(!/d\.estTotal > 0 \? d\.estTotal\.toLocaleString\('pt-BR'\) : '-'/.test(b), 'zero nao vira "-"');
  });
});

describe('o resto nao muda', () => {
  test('15. (A7) Gestao e Giro sobre o estoque fisico; formula de dias, Estoque Full e Previsao intactos', () => {
    const est = extrairFuncao('estGetSKUData');
    assert.match(est, /const est = fis\.completo \? fis\.totalFisico : null;/);
    assert.match(est, /dias = vel > 0 \? Math\.round\(est \/ vel\) : 9999;/);
    assert.match(extrairFuncao('grEstoquePorSku'), /estoque: f\.completo \? f\.totalFisico : null,/);
    assert.match(extrairFuncao('renderEstoqueFull'), /consolidarEstoqueGrupo\(g\.items\)/);
    for (const f of ['renderEstoqueFull', 'pvCalc']) assert.ok(!/estoqueFisico/.test(extrairFuncao(f)), f);
  });

  test('16. vendas, liquido, publicidade, Margem e cancelamentos nao leem estoque fisico', () => {
    for (const f of ['contaComoVenda', 'calcLiquidoPeriodo', 'totaisDoPeriodo', 'publicidadeDoPeriodo', 'renderMargem', 'cancelamentoOperacional', 'renderKPIsPeriodo']) {
      assert.ok(!/estoqueFisico/.test(extrairFuncao(f)), f);
    }
  });

  test('nenhuma soma crua de available_quantity alimenta o KPI de estoque da Home', () => {
    const k = extrairFuncao('renderKPIs');
    assert.ok(!/reduce\([^)]*available_quantity/.test(k));
    assert.match(k, /estoqueFisicoTotal\(allItems\)/);
  });
});

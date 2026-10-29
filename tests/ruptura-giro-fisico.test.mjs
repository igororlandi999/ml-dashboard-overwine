/**
 * FASE A7 — Ruptura, cobertura, giro e reposicao sobre o ESTOQUE FISICO.
 *
 * Travado aqui:
 *  - Gestao de Estoque: dias = round(totalFisico / vel), com totalFisico da
 *    definicao unica da A6 (estoqueFisicoDoGrupo: proprio unico + Full + FBA);
 *    velocidade (vendas 30d / 30) e faixas de classificacao intactas;
 *  - total incompleto: sem dias, sem classificacao ('parcial'), fora dos KPIs
 *    de ruptura — nunca o total conhecido como se fosse o fisico, nunca 0;
 *  - zero completo e valido: 0 dias, ruptura imediata;
 *  - Giro: o mesmo total fisico; incompleto = sem meta e sem status; cards nao
 *    afirmam total com SKU parcial;
 *  - Analise Inteligente (ruptura prevista / reposicao): so SKUs completos;
 *  - Previsao de Vendas e Estoque Full nao mudam de base.
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

let _n = 0;
const mlProprio = (sku, q, extra = {}) => ({ id: 'MLB' + (++_n), title: 'Vinho tinto ' + sku, status: 'active', price: 100, seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'xd_drop_off' }, tags: [], inventory_id: null, ...extra });
const mlFull = (sku, q, inv, extra = {}) => ({ id: 'MLB' + (++_n), title: 'Vinho tinto ' + sku, status: 'active', price: 100, seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'fulfillment' }, tags: [], inventory_id: inv, ...extra });
const amzProprio = (sku, q, extra = {}) => ({ id: sku, title: 'Vinho tinto ' + sku, status: 'active', price: 100, canal: 'amazon', conta: 'alemmar-amazon', seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'amazon_proprio' }, tags: null, inventory_id: null, amazon: { estoque: 'proprio', estoqueInformado: q !== null }, ...extra });
const amzFba = (sku, q, extra = {}) => ({ id: sku + '#fba', title: 'Vinho tinto ' + sku, status: 'active', price: 100, canal: 'amazon', conta: 'alemmar-amazon', seller_custom_field: sku, available_quantity: q, shipping: { logistic_type: 'amazon_fba' }, tags: null, inventory_id: 'FN' + sku, amazon: { estoque: 'fba', estoqueInformado: q !== null }, ...extra });
const ow = o => ({ ...o, conta: 'overwine-ml' });
const deg = o => ({ ...o, conta: 'degustar-ml' });

/**
 * `vendas30` = unidades vendidas em 30 dias por id de anuncio (via agregado
 * estoque30d, o mesmo caminho do dashboard sem historico em memoria).
 * `vendasCiclo` = vendas do ciclo do Giro por SKU ({ totalQty, porSemana }).
 */
function montar({ itens = [], selecao = ['overwine-ml'], vendas30 = {}, vendasCiclo = {}, semanas = 24 } = {}) {
  const fonte = [
    "const CONTA_LEGADA = 'overwine-ml';",
    'let CONTAS_DISPONIVEIS = _contas, SELECAO = _sel;',
    extrairFuncao('selecaoLegada'), extrairFuncao('selecaoConsolidada'), extrairFuncao('contaInfo'),
    'function empresaNome(r) { return r; }', extrairFuncao('empresaDaConta'),
    extrairFuncao('contaDaEmpresaOverwine'), extrairFuncao('pedidoAmazon'),
    'let allItems = _itens, allOrders = [];',
    'let _metrics = { estoque30d: { porItem: Object.keys(_v30).map(k => ({ itemId: k, unidades: _v30[k] })) } };',
    'function pedidosEmMemoria() { return false; }',
    extrairFuncao('_skuDoVendedor'), 'let _indiceCatalogo = { ref: null, mapa: null };', extrairFuncao('_skuPorCatalogo'), extrairFuncao('itemSKU'),
    extrairFuncao('rotuloIdentidade'),
    extrairFuncao('isFullItem'), extrairFuncao('fullStockKey'), extrairFuncao('isFbaItem'), extrairFuncao('consolidarEstoqueGrupo'),
    extrairFuncao('_qtdInformada'), extrairFuncao('estoqueFisicoDoGrupo'), extrairConstante('ROTULO_PENDENCIA_ESTOQUE'),
    'const MOD_PLACEHOLDER = "\\u2014";',
    'function escHtml(x) { return String(x); } function fmtPrice(v) { return String(v); }',
    'const _dom = { "gr-semanas": { value: String(_semanas) } };',
    'const document = { querySelectorAll: () => [], getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", title: "", style: {}, value: "" }) };',
    'let _estData = [], _estFiltro = "todos", _estSemInfo = 0;',
    extrairFuncao('estGetSKUData'), extrairFuncao('renderEstoque'),
    // Giro
    'let _grWeeks = {};',
    'function gdrGet() { return { fromDate: new Date("2026-10-01T00:00:00-03:00"), toDate: new Date("2026-10-31T23:59:59-03:00") }; }',
    'function grVendasPorSku() { return _vc; }',
    extrairFuncao('grSemanasEntre'), extrairFuncao('grCategoria'), extrairFuncao('grStatus'), extrairFuncao('grSemanasAlvo'),
    extrairFuncao('grSemanasDoSku'), extrairFuncao('grEstoquePorSku'), extrairFuncao('grBuildData'), extrairFuncao('grCardEstoque'),
    `return {
      gestao() { renderEstoque(); return { dom: _dom, dados: _estData, semInfo: _estSemInfo }; },
      giro() { return grBuildData(); },
      cardGiro(linhas) { const el = { textContent: '', title: '' }; const v = grCardEstoque(el, linhas); return { v, el }; },
      estoqueGiro: () => grEstoquePorSku(),
      grupo: items => estoqueFisicoDoGrupo(items),
    };`,
  ].join('\n');
  return new Function('_contas', '_sel', '_itens', '_v30', '_vc', '_semanas', fonte)(CONTAS, selecao, itens, vendas30, vendasCiclo, semanas);
}
/** vendas de 30 dias: `porDia` unidades/dia no 1o anuncio ativo do SKU. */
const v30 = (itens, porDia) => ({ [itens.find(i => i.status === 'active').id]: Math.round(porDia * 30) });
const linha = (r, sku) => r.dados.find(g => g.sku === sku);

describe('Gestao de Estoque: cobertura sobre o estoque fisico', () => {
  test('1/2. proprio 10 + Full 5 + FBA 5, venda 2/dia → 20 / 2 = 10 dias (proprio sozinho daria 5)', () => {
    const itens = [mlProprio('A', 10), mlFull('A', 5, 'INV-A'), amzProprio('A', 10), amzFba('A', 5)];
    const r = montar({ itens, vendas30: v30(itens, 2) }).gestao();
    const a = linha(r, 'A');
    assert.deepEqual([a.est, a.vel, a.dias, a.tipo], [20, 2, 10, 'ruptura']);
    // a regra antiga (so proprio) daria 10 / 2 = 5 — o proprio continua visivel na coluna
    assert.equal(a.fis.proprio, 10);
    assert.notEqual(a.dias, Math.round(a.fis.proprio / a.vel));
    assert.ok(!/consolidarEstoqueGrupo\(g\.items\)\.proprio/.test(extrairFuncao('estGetSKUData')), 'regra antiga fora do calculo');
  });

  test('3. estoque fisico completo 0 com venda: 0 dias, ruptura imediata (zero nao e "parcial")', () => {
    const itens = [mlProprio('Z', 0), mlFull('Z', 0, 'INV-Z')];
    const a = linha(montar({ itens, vendas30: v30(itens, 1) }).gestao(), 'Z');
    assert.deepEqual([a.est, a.dias, a.tipo], [0, 0, 'ruptura']);
  });

  test('4. estoque parcial: sem dias, sem classificacao, fora dos KPIs de ruptura; tabela mostra "—"', () => {
    const itens = [mlProprio('P', 12), amzProprio('P', 12)];      // Amazon sem #fba: FBA nao informado
    const r = montar({ itens, vendas30: v30(itens, 3) }).gestao();
    const p = linha(r, 'P');
    assert.deepEqual([p.est, p.dias, p.tipo], [null, null, 'parcial']);
    assert.equal(p.fis.totalConhecido, 12, 'o conhecido existe, mas nao vira cobertura');
    assert.equal(r.dom['est-k-ruptura'].textContent, 0);
    assert.equal(r.semInfo, 1);
    assert.match(r.dom['est-meta'].textContent, /1 com estoque físico incompleto/);
    const tabela = r.dom['est-table'].innerHTML.replace(/\s+/g, ' ');
    assert.match(tabela, /Estoque parcial/);
    assert.ok(!/NaN|Infinity|null/.test(tabela));
  });

  test('5/6. Full 0 e FBA 0 validos: cobertura completa sobre o proprio', () => {
    const itens = [mlProprio('B', 60), mlFull('B', 0, 'INV-B'), amzProprio('B', 60), amzFba('B', 0)];
    const b = linha(montar({ itens, vendas30: v30(itens, 1) }).gestao(), 'B');
    assert.deepEqual([b.est, b.dias, b.tipo], [60, 60, 'alerta']);
  });

  test('7. SKU so no ML: proprio + Full', () => {
    const itens = [mlProprio('M', 30), mlFull('M', 15, 'INV-M')];
    const m = linha(montar({ itens, vendas30: v30(itens, 1) }).gestao(), 'M');
    assert.deepEqual([m.est, m.dias, m.tipo], [45, 45, 'alerta']);
  });

  test('8. Overwine ML + Amazon no consolidado: proprio nao duplica, FBA soma', () => {
    const itens = [ow(mlProprio('A', 12)), ow(mlProprio('A', 12)), ow(mlFull('A', 5, 'INV-A')), amzProprio('A', 12), amzFba('A', 8)];
    const r = montar({ itens, selecao: ['overwine-ml', 'alemmar-amazon'], vendas30: v30(itens, 2.5) }).gestao();
    assert.equal(r.dados.length, 1);
    assert.deepEqual([r.dados[0].est, r.dados[0].dias], [25, 10]);
  });

  test('9. Degustar: sem Amazon/FBA; sem vinculo explicito fica parcial (nao volta ao maior espelho)', () => {
    const SEL = ['overwine-ml', 'alemmar-amazon', 'degustar-ml'];
    const so = [deg(mlProprio('D', 40))];
    const d1 = linha(montar({ itens: so, selecao: SEL, vendas30: v30(so, 1) }).gestao(), 'D · Degustar');
    assert.deepEqual([d1.est, d1.fis.amazonFba, d1.fis.fontes.amazonFba, d1.dias], [40, 0, 'nao_se_aplica', 40]);
    const dois = [deg(mlProprio('E', 40)), deg(mlProprio('E', 40))];
    const d2 = linha(montar({ itens: dois, selecao: SEL, vendas30: v30(dois, 1) }).gestao(), 'E · Degustar');
    assert.deepEqual([d2.est, d2.tipo], [null, 'parcial'], 'antes: 40 (maior espelho) e cobertura 40 dias');
  });
});

describe('Giro e Analise Inteligente sobre o mesmo estoque fisico', () => {
  test('10. Giro usa exatamente o total fisico da A6 (pausados inclusive)', () => {
    const itens = [mlProprio('A', 12), mlFull('A', 5, 'INV-A', { status: 'paused' }), amzProprio('A', 12), amzFba('A', 8)];
    const h = montar({ itens, vendasCiclo: { A: { totalQty: 0, totalRev: 0, porSemana: {} } } });
    const g = h.estoqueGiro().A;
    assert.equal(g.estoque, h.grupo(itens).totalFisico);
    assert.equal(g.estoque, 25);
    assert.ok(!/consolidarEstoqueGrupo/.test(extrairFuncao('grEstoquePorSku')), 'sem regra duplicada');
  });

  test('10b. Giro: meta semanal = estoque fisico / semanas (formula intacta); parcial sem meta nem status', () => {
    const itens = [mlProprio('A', 12), mlFull('A', 12, 'INV-A'), mlProprio('P', 9), amzProprio('P', 9)];
    const h = montar({ itens, semanas: 24, vendasCiclo: { A: { totalQty: 4, totalRev: 0, porSemana: {} }, P: { totalQty: 4, totalRev: 0, porSemana: {} } } });
    const { linhas } = h.giro();
    const a = linhas.find(l => l.sku === 'A'), p = linhas.find(l => l.sku === 'P');
    assert.equal(a.estoque, 24);
    assert.equal(a.metaSemanal, 1);
    assert.equal(typeof a.diferencaProjetada, 'number');
    assert.deepEqual([p.estoque, p.metaSemanal, p.status, p.diferencaProjetada], [null, null, 'parcial', null]);
    assert.equal(linhas[linhas.length - 1].sku, 'P', 'parcial vai para o fim');
    // card: nao afirma total com SKU parcial
    const c = h.cardGiro(linhas);
    assert.deepEqual([c.v, c.el.textContent, c.el.title], [null, '—', '1 produto com estoque físico incompleto']);
    assert.deepEqual(h.cardGiro([a]).v, 24);
  });

  test('11. Analise Inteligente (ruptura prevista, reposicao, cobertura) so com estoque fisico completo', () => {
    const av = extrairFuncao('aiAvaliarPortfolio');
    assert.match(av, /_grLinhas\.filter\(l => l\.estoque !== null\)\.map\(l => \(\{ l, m: aiMetricas\(l\) \}\)\)/);
    assert.match(av, /foraPorEstoqueParcial/);
    assert.match(extrairFuncao('renderAiRecomendacoes'), /fora \(estoque f\\u00edsico incompleto\)/);
    // a previsao da IA continua lendo l.estoque — que agora e o fisico do Giro
    assert.match(extrairFuncao('aiProjecaoMensal'), /let estoque = l\.estoque;/);
  });
});

describe('o resto nao muda', () => {
  test('12. formula de velocidade e de dias intactas', () => {
    const f = extrairFuncao('estGetSKUData');
    assert.match(f, /const vel = \+\(g\.vendas30 \/ 30\)\.toFixed\(2\);/);
    assert.match(f, /dias = vel > 0 \? Math\.round\(est \/ vel\) : 9999;/);
    assert.match(f, /if \(dt < limite30\) return;/);
    assert.match(extrairFuncao('grBuildData'), /const mediaReal = semanasDecorridas > 0 \? v\.totalQty \/ semanasDecorridas : 0;/);
  });

  test('13. thresholds intactos (Gestao 30/90/365; Giro 0,8/1,2)', () => {
    const f = extrairFuncao('estGetSKUData');
    assert.match(f, /else if \(dias < 30\) tipo = 'ruptura';/);
    assert.match(f, /else if \(dias < 90\) tipo = 'alerta';/);
    assert.match(f, /else if \(dias <= 365\) tipo = 'ok';/);
    const s = extrairFuncao('grStatus');
    assert.match(s, /mediaReal < metaSemanal \* 0\.8/);
    assert.match(s, /mediaReal <= metaSemanal \* 1\.2/);
  });

  test('14. receita, publicidade, Margem, cancelamentos, Previsao de Vendas e Estoque Full fora da A7', () => {
    for (const f of ['calcLiquidoPeriodo', 'publicidadeDoPeriodo', 'renderMargem', 'cancelamentoOperacional', 'pvCalc', 'renderEstoqueFull', 'renderKPIs']) {
      assert.ok(!/grEstoquePorSku|estGetSKUData/.test(extrairFuncao(f)), f);
    }
    assert.match(extrairFuncao('renderEstoqueFull'), /consolidarEstoqueGrupo\(g\.items\)/);
  });
});

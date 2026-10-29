/**
 * FASE A3 — Receita liquida da Home com UMA fonte e rotulos que nao se confundem
 * com a Margem.
 *
 * Travado aqui:
 *  - Home: bruto, tarifas e liquido saem de `/api/orders/metrics ->
 *    periodo.faturamento` do periodo EXATO, com ou sem historico em memoria. O
 *    card nao troca de fonte quando allOrders carrega, e o frontend nao aplica
 *    mais 14,8% + 14,4% em lugar nenhum;
 *  - troca de periodo pede o agregado do NOVO periodo (aplicarPeriodoGlobal);
 *    agregado de outro periodo nunca vira o liquido do periodo atual;
 *  - sem agregado do periodo: liquido e tarifas = placeholder; bruto so com
 *    historico (mesma regra do backend);
 *  - rotulo da Home diz "Receita Liquida Estimada" e "tarifas medias de X%",
 *    com X lido do proprio agregado;
 *  - Margem usa outro nome ("Receita apos Tarifas e Frete", "Receita Bruta de
 *    Produtos") e mostra a cobertura receitaComCusto / receitaProdutos;
 *    nenhuma formula de /margin muda; publicidade fora desta fase.
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

// ── Fixture: outubro/2026 ───────────────────────────────────────────────────
const DIA = '2026-10-20T12:00:00.000-03:00';
const it = (id, quantity, unit_price) => ({ item: { id, title: id }, quantity, unit_price });
const ml = (id, status, paid, items, dia = DIA) => ({ id, status, date_created: dia, paid_amount: paid, total_amount: paid, order_items: items });
const PEDIDOS = [
  ml(1, 'paid', 100, [it('MLB1', 1, 100)]),
  ml(2, 'partially_refunded', 30.51, [it('MLB1', 1, 34.29)]),
  ml(3, 'cancelled', 0, [it('MLB1', 5, 100)]),
  ml(5, 'paid', 250, [it('MLB1', 1, 100), it('MLB2', 3, 50)]),
  ml(6, 'paid', 80, [it('MLB9', 2, 40)]),
  ml(7, 'paid', 999, [it('MLB1', 1, 999)], '2026-09-15T12:00:00.000-03:00'), // setembro
];
const ITENS = [
  { id: 'MLB1', title: 'Vinho A', status: 'active', sold_quantity: 100 },
  { id: 'MLB2', title: 'Vinho B', status: 'active', sold_quantity: 10 },
];
const OUT = { from: '2026-10-01', to: '2026-10-31' };
const SET = { from: '2026-09-01', to: '2026-09-30' };

/** Agregado como o backend devolve: bruto por faturamentoPeriodo e a estimativa por config/taxas.json. */
function metrics({ from, to }, bruto, extra = {}) {
  return {
    periodo: {
      fromYmd: from, toYmd: to,
      faturamento: { bruto, tarifaML: -bruto * 0.148, tarifaEnv: -bruto * 0.144, liquido: bruto * (1 - 0.148 - 0.144), estimado: true, fonte: 'dashboard_legado', metodologia: 'x' },
      porItem: [],
      ...extra,
    },
  };
}
const BRUTO_OUT = 100 + 30.51 + 250 + 80; // 460,51 — mesma regra que o local
const BRUTO_SET = 999;

/**
 * Monta a Home com as funcoes REAIS: aplicarPeriodoGlobal, loadPeriodoData,
 * calcLiquidoPeriodo, liquidoApurado, renderKPIsPeriodo. `porPeriodo` e o que
 * o backend devolve para cada periodo (loadMetrics simulado).
 */
function montar({ historico = false, porPeriodo = {}, metricsInicial = null, financeiro = true, pedidos = PEDIDOS } = {}) {
  const fonte = [
    'const _AGORA = new Date("2026-10-28T12:00:00.000-03:00");',
    extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'), extrairFuncao('dentroDoPeriodo'),
    'function hojeBRT() { return ymdBRT(_AGORA); }',
    extrairFuncao('gdrDiasEntre'),
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
    'let allOrders = _hist ? _pedidos : [], allItems = _itens, _metrics = _m0;',
    'let periodoData = [], periodoTotais = null, periodoDateInicio = null, periodoDateFim = null;',
    'let _periodo = { from: "2026-10-01", to: "2026-10-31" };',
    'function gdrGet() { return { from: _periodo.from, toEfetivo: _periodo.to, fromDate: brtStartOfDay(_periodo.from), toDateEfetivo: brtEndOfDay(_periodo.to), dias: 31 }; }',
    'function pedidosEmMemoria() { return _hist; }',
    'function selecaoTemFinanceiro() { return _fin; }',
    'function selecaoLegada() { return _fin; } function selecaoConsolidada() { return false; }',
    'function selecaoTemAmazon() { return false; } function selecaoTemMercadoLivre() { return true; }',
    'const USER_ID = 1; async function mlFetch() { return { results: [] }; }',
    'async function visitasDaSelecao() { return { results: [] }; }',
    // loadMetrics simulado: devolve o agregado do periodo pedido (ou nada).
    'const _pedidosMetrics = [];',
    'async function loadMetrics(dias, from, to) { _pedidosMetrics.push(from + ".." + to); const r = _porPeriodo[from + ".." + to]; if (r) _metrics = r; return r; }',
    'async function loadAdCost() { return 0; }',
    'function showToast() {}',
    'function renderQualidade() {} function renderChartReceitaProduto() {} function renderCardReputacao() {} function renderVisaoGeral() {}',
    'let _adsLoadState = "loaded", _periodoLoadState = "loaded";',
    'function publicidadeDoPeriodo() { return { disponivel: false, custo: null, fonte: null, periodoExato: false, parcial: false, motivo: "sem_fonte_confiavel" }; }',
    'function rotuloFontePublicidade() { return ""; } function textoPublicidadeIndisponivel() { return "dados de Ads indisponiveis"; }',
    'const MOD_PLACEHOLDER = "\\u2014", INDISPONIVEL = "indisponivel";',
    'function htmlIndisponivel(m) { return "[indisponivel: " + m + "]"; } function htmlAvisoSelecao(x) { return x; } function escHtml(x) { return String(x); }',
    'function rotuloMetodo() { return ""; } function textoRessalvas() { return ""; } function textoCobertura() { return "cobertura"; } function textoFinanceiroAmazon() { return ""; }',
    'const _dom = {}; const document = { getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", value: "", style: {}, title: "", setAttribute() {} }) };',
    'const console = { warn() {}, log() {} };',
    extrairFuncao('metricsDoPeriodo'), extrairFuncao('agregadoCompleto'),
    extrairFuncao('fontePorItemPeriodo'), extrairFuncao('totaisDoPeriodo'), extrairFuncao('ticketMedioExibido'),
    'async ' + extrairFuncao('loadPeriodoData'),
    extrairFuncao('calcLiquidoPeriodo'), extrairFuncao('liquidoApurado'),
    extrairFuncao('renderKPIsPeriodo'),
    'async ' + extrairFuncao('aplicarPeriodoGlobal'),
    `return {
      async boot() { await loadPeriodoData(_periodo.from, _periodo.to); renderKPIsPeriodo(); return _dom; },
      carregarHistorico() { allOrders = _pedidos; _hist = true; renderKPIsPeriodo(); return _dom; },
      async trocarPeriodo(p) { _periodo = p; await aplicarPeriodoGlobal(); return _dom; },
      calc() { return calcLiquidoPeriodo(); },
      totais() { return periodoTotais; },
      pedidosMetrics: _pedidosMetrics, dom: _dom,
    };`,
  ].join('\n');
  return new Function('_pedidos', '_itens', '_hist', '_m0', '_porPeriodo', '_fin', fonte)(pedidos, ITENS, historico, metricsInicial, porPeriodo, financeiro);
}

const reais = s => Number(String(s).replace(/[^\d-]/g, ''));
const PH = '—';
const chave = p => p.from + '..' + p.to;

describe('Home — fonte unica do liquido (/metrics periodo.faturamento)', () => {
  test('1. boot: bruto e liquido vem do agregado do periodo', async () => {
    const h = montar({ metricsInicial: metrics(OUT, BRUTO_OUT) });
    const d = await h.boot();
    assert.equal(reais(d['kpi-faturamento'].textContent), Math.round(BRUTO_OUT));
    assert.equal(reais(d['kpi-liq'].textContent), Math.round(BRUTO_OUT * 0.708));
    assert.equal(h.calc().estimado, true);
  });

  test('2. depois de carregar o historico o liquido NAO muda de valor nem de fonte', async () => {
    const h = montar({ metricsInicial: metrics(OUT, BRUTO_OUT) });
    const antes = { ...(await h.boot()) };
    const vAntes = ['kpi-faturamento', 'kpi-liq', 'kpi-tarifa-ml', 'kpi-tarifa-env', 'kpi-liq-pct'].map(id => antes[id].textContent);
    const depois = h.carregarHistorico();
    const vDepois = ['kpi-faturamento', 'kpi-liq', 'kpi-tarifa-ml', 'kpi-tarifa-env', 'kpi-liq-pct'].map(id => depois[id].textContent);
    assert.deepEqual(vDepois, vAntes);
  });

  test('3. populacao local diferente nao altera o liquido: ele sempre segue o agregado', async () => {
    // Agregado (backend antigo) com numeros proprios — ex.: snapshot com mais pedidos que a memoria.
    const ag = metrics(OUT, 2000);
    const h = montar({ historico: true, metricsInicial: ag });
    const d = await h.boot();
    assert.equal(reais(d['kpi-liq'].textContent), Math.round(2000 * 0.708));
    // A conta local antiga (14,8% + 14,4% sobre 460,51) daria 326 — nao aparece.
    assert.notEqual(reais(d['kpi-liq'].textContent), Math.round(BRUTO_OUT * 0.708));
    // O percentual da estimativa e do proprio agregado, nao de bruto local / liquido do agregado.
    assert.equal(d['kpi-liq-pct'].textContent, 'estimado \u00b7 tarifas m\u00e9dias de 29,2%');
  });

  test('4. troca de periodo usa o agregado do NOVO periodo, com e sem historico', async () => {
    for (const historico of [false, true]) {
      const h = montar({ historico, metricsInicial: metrics(OUT, BRUTO_OUT), porPeriodo: { [chave(OUT)]: metrics(OUT, BRUTO_OUT), [chave(SET)]: metrics(SET, BRUTO_SET) } });
      await h.boot();
      const d = await h.trocarPeriodo(SET);
      assert.ok(h.pedidosMetrics.includes(chave(SET)), 'pediu /metrics do novo periodo (historico=' + historico + ')');
      assert.equal(reais(d['kpi-faturamento'].textContent), BRUTO_SET);
      assert.equal(reais(d['kpi-liq'].textContent), Math.round(BRUTO_SET * 0.708));
    }
  });

  test('5. agregado de OUTRO periodo nao e aceito como liquido do periodo atual', async () => {
    // Sem historico: tudo indisponivel.
    const d1 = await montar({ metricsInicial: metrics(SET, BRUTO_SET) }).boot();
    for (const id of ['kpi-faturamento', 'kpi-liq', 'kpi-tarifa-ml', 'kpi-tarifa-env']) assert.equal(d1[id].textContent, PH, id);
    // Com historico: bruto local (mesma regra do backend); liquido e tarifas indisponiveis.
    const d2 = await montar({ historico: true, metricsInicial: metrics(SET, BRUTO_SET) }).boot();
    assert.equal(reais(d2['kpi-faturamento'].textContent), Math.round(BRUTO_OUT));
    for (const id of ['kpi-liq', 'kpi-tarifa-ml', 'kpi-tarifa-env']) assert.equal(d2[id].textContent, PH, id);
  });

  test('6. sem agregado confiavel: liquido = placeholder e o frontend NAO recalcula 29,2%', async () => {
    const h = montar({ historico: true, metricsInicial: null });
    const d = await h.boot();
    assert.equal(d['kpi-liq'].textContent, PH);
    assert.match(d['kpi-liq'].title, /estimativa indispon/);
    const r = h.calc();
    assert.deepEqual([r.liquido, r.tarifaML, r.tarifaEnv, r.liquidoIndisponivel], [null, null, null, true]);
    // Nenhuma taxa embutida no frontend.
    assert.doesNotMatch(extrairFuncao('calcLiquidoPeriodo'), /0\.14|TAXA_/);
  });
});

describe('Bloco Performance do Periodo — fonte unica (revisao A3 x contrato A2)', () => {
  // Local (outubro): vendas 1, 2, 5 e 6 -> 4 pedidos, 8 unidades, R$ 460,51.
  const LOCAL = { pedidos: 4, unidades: 8, bruto: BRUTO_OUT };
  const completo = (p, bruto, pedidos, unidades) => metrics(p, bruto, { pedidos, unidades });
  const bloco = d => ['kpi-faturamento', 'kpi-transacoes', 'kpi-unidades', 'kpi-ticket'].map(id => d[id].textContent);

  test('1. bruto = 0 de agregado completo e valor oficial, mesmo com historico local diferente', async () => {
    const h = montar({ historico: true, metricsInicial: completo(OUT, 0, 0, 0) });
    const d = await h.boot();
    assert.equal(reais(d['kpi-faturamento'].textContent), 0);
    assert.notEqual(reais(d['kpi-faturamento'].textContent), Math.round(LOCAL.bruto));
    assert.equal(d['kpi-transacoes'].textContent, '0');
    assert.equal(d['kpi-unidades'].textContent, '0');
    assert.equal(reais(d['kpi-ticket'].textContent), 0);   // zero pedidos: comportamento seguro de sempre
    assert.equal(reais(d['kpi-liq'].textContent), 0);      // liquido do mesmo agregado
    assert.equal(h.calc().fonteBruto, 'agregado');
  });

  test('1b. bruto = 0 tambem vale sem historico (nada de fallback por truthiness)', async () => {
    const d = await montar({ historico: false, metricsInicial: completo(OUT, 0, 0, 0) }).boot();
    assert.equal(reais(d['kpi-faturamento'].textContent), 0);
    assert.notEqual(d['kpi-faturamento'].textContent, PH);
  });

  test('2. /metrics completo mais novo que allOrders: bruto, pedidos, unidades e ticket todos do agregado', async () => {
    const h = montar({ historico: true, metricsInicial: completo(OUT, 575.51, 5, 10) });
    const d = await h.boot();
    assert.deepEqual(bloco(d).map((v, i) => i === 0 || i === 3 ? reais(v) : Number(v)), [576, 5, 10, Math.round(575.51 / 5)]);
    // Nenhum valor local aparece no bloco.
    assert.notEqual(reais(d['kpi-faturamento'].textContent), Math.round(LOCAL.bruto));
    assert.notEqual(Number(d['kpi-transacoes'].textContent), LOCAL.pedidos);
  });

  test('3. backend novo + historico: nenhum KPI do bloco mistura agregado e local', async () => {
    const h = montar({ historico: true, metricsInicial: completo(OUT, 575.51, 5, 10) });
    await h.boot();
    assert.equal(h.calc().fonteBruto, 'agregado');
    assert.equal(h.totais().fonte, 'agregado');
    // E a mesma decisao vale para os quatro: trocar o historico local nao move nenhum deles.
    const a = bloco(h.dom);
    const h2 = montar({ historico: true, metricsInicial: completo(OUT, 575.51, 5, 10), pedidos: PEDIDOS.slice(0, 2) });
    await h2.boot();
    assert.deepEqual(bloco(h2.dom), a);
  });

  test('4. backend antigo: com historico o bloco e todo local; sem historico so o faturamento (do agregado)', async () => {
    const com = montar({ historico: true, metricsInicial: metrics(OUT, 2000) });
    const d = await com.boot();
    assert.equal(com.calc().fonteBruto, 'local');
    assert.equal(com.totais().fonte, 'local');
    assert.deepEqual([reais(d['kpi-faturamento'].textContent), Number(d['kpi-transacoes'].textContent), Number(d['kpi-unidades'].textContent), reais(d['kpi-ticket'].textContent)],
      [Math.round(LOCAL.bruto), LOCAL.pedidos, LOCAL.unidades, Math.round(LOCAL.bruto / LOCAL.pedidos)]);
    // Liquido continua do agregado, e o percentual da estimativa usa o bruto DO agregado.
    assert.equal(reais(d['kpi-liq'].textContent), Math.round(2000 * 0.708));
    assert.equal(com.calc().brutoAgregado, 2000);

    const sem = montar({ historico: false, metricsInicial: metrics(OUT, 2000) });
    const d2 = await sem.boot();
    assert.equal(reais(d2['kpi-faturamento'].textContent), 2000);
    assert.deepEqual(bloco(d2).slice(1), [PH, PH, PH]);
  });

  test('5. troca de periodo busca o agregado correto e o bloco inteiro o segue', async () => {
    const h = montar({ historico: true, metricsInicial: completo(OUT, 575.51, 5, 10),
      porPeriodo: { [chave(OUT)]: completo(OUT, 575.51, 5, 10), [chave(SET)]: completo(SET, 1500, 3, 6) } });
    await h.boot();
    const d = await h.trocarPeriodo(SET);
    assert.ok(h.pedidosMetrics.includes(chave(SET)));
    assert.deepEqual(bloco(d).map((v, i) => i === 0 || i === 3 ? reais(v) : Number(v)), [1500, 3, 6, 500]);
    assert.equal(reais(d['kpi-liq'].textContent), Math.round(1500 * 0.708));
  });

  test('6. liquido estimado sempre do /metrics, em todas as combinacoes de fonte do bloco', async () => {
    for (const [historico, ag] of [[false, completo(OUT, 575.51, 5, 10)], [true, completo(OUT, 575.51, 5, 10)], [false, metrics(OUT, 2000)], [true, metrics(OUT, 2000)]]) {
      const h = montar({ historico, metricsInicial: ag });
      const d = await h.boot();
      assert.equal(reais(d['kpi-liq'].textContent), Math.round(ag.periodo.faturamento.liquido), `historico=${historico}`);
      assert.equal(h.calc().liquido, ag.periodo.faturamento.liquido);
    }
  });
});

describe('Home — rotulo de estimativa', () => {
  test('7. rotulo e subtitulo dizem que e estimativa; o percentual vem do agregado', async () => {
    const d = await montar({ metricsInicial: metrics(OUT, BRUTO_OUT) }).boot();
    assert.equal(d['kpi-liq-rotulo'].textContent, 'Receita Líquida Estimada');
    assert.equal(d['kpi-liq-pct'].textContent, 'estimado · tarifas médias de 29,2%');
    assert.match(d['kpi-tarifa-ml-pct'].textContent, /14\.8% do bruto · estimado/);
    assert.match(d['kpi-tarifa-env-pct'].textContent, /14\.4% do bruto · estimado/);
    // Taxa diferente no backend aparece no texto sem mudar o frontend.
    const m = metrics(OUT, 1000);
    m.periodo.faturamento.tarifaML = -100; m.periodo.faturamento.tarifaEnv = -150; m.periodo.faturamento.liquido = 750;
    const d2 = await montar({ metricsInicial: m }).boot();
    assert.equal(d2['kpi-liq-pct'].textContent, 'estimado · tarifas médias de 25,0%');
  });

  test('HTML inicial do card da Home ja nasce como estimativa', () => {
    assert.match(html, /<div class="kpi-label" id="kpi-liq-rotulo">Receita Líquida Estimada<\/div>/);
    assert.doesNotMatch(html, /id="kpi-liq-rotulo">Receita Liquida ML</);
  });

  test('selecao sem perfil proprio continua no caminho apurado (sem rotulo "Estimada" escrito pelo render)', async () => {
    const m = metrics(OUT, BRUTO_OUT);
    m.periodo.faturamento = { bruto: BRUTO_OUT, tarifaML: null, tarifaEnv: null, liquido: null, estimado: false };
    const d = await montar({ metricsInicial: m, financeiro: false }).boot();
    // O render nao toca no rotulo nesse caminho (fica o de aplicarRotulosPorCanal, sem "Estimada").
    assert.equal(d['kpi-liq-rotulo']?.textContent ?? '', '');
    assert.equal(reais(d['kpi-faturamento'].textContent), Math.round(BRUTO_OUT));
  });
});

describe('Margem — outra grandeza, outro nome', () => {
  test('8. a Margem nao usa o rotulo da Home; cards dizem receita de produtos e apos tarifas e frete', () => {
    assert.match(html, /<div class="kpi-label">Receita Bruta de Produtos<\/div>\s*<div class="kpi-value gold" id="mg-bruto">/);
    assert.match(html, /<div class="kpi-label" id="mg-liq-rotulo">Receita após Tarifas e Frete<\/div>/);
    assert.doesNotMatch(html, /id="mg-liq-rotulo">Receita Liquida/);
    assert.match(extrairFuncao('aplicarRotulosPorCanal'), /'mg-liq-rotulo': 'Receita ap\\u00f3s Tarifas e Frete'/);
  });

  test('8b. subtitulo do liquido da Margem mostra a cobertura receitaComCusto / receitaProdutos', () => {
    const r = extrairFuncao('renderMargem');
    assert.match(r, /'produtos com custo: ' \+ pct\(T\.receitaComCusto, totBruto\) \+ ' da receita'/);
    assert.doesNotMatch(r, /mg-liq-pct'\)\.textContent = pct\(totLiq, totBruto\)/);
  });

  test('9. nenhuma formula de /margin muda no frontend', () => {
    const r = extrairFuncao('renderMargem');
    for (const linha of [
      'const totBruto = T.receitaProdutos;',
      'const totLiq = T.receitaLiquida;',
      'const totCusto = T.custoTotal;',
      'const totMargem = T.margem - totPub;',
      "liq: (l.receitaComCusto || 0) - (l.tarifaML || 0) - (l.tarifaEnvio || 0),",
    ]) assert.ok(r.includes(linha), linha);
  });

  test('10. publicidade (FASE A4): Home e Margem leem a MESMA fonte, do periodo global', () => {
    const k = extrairFuncao('renderKPIsPeriodo');
    assert.ok(k.includes('const _pub = publicidadeDoPeriodo(_gPub.from, _gPub.toEfetivo);'));
    const r = extrairFuncao('renderMargem');
    assert.ok(r.includes('const _pub = publicidadeDoPeriodo(from, to);'));
    assert.ok(r.includes('const totPub = _pub.disponivel ? _pub.custo : 0;'));
    assert.doesNotMatch(html, /ADS_DATA|getAdsDataParaPeriodo/);
  });
});

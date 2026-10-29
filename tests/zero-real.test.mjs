/**
 * FASE A9 — loading, indisponivel e zero real.
 *
 * Travado aqui (zero e dado; ausencia e ausencia):
 *  - HTML inicial: nenhum KPI nasce com 0 / R$ 0 / 0%;
 *  - Home: carregando = "—"; faturamento/pedidos/Ads/visitas zero real = 0;
 *    Ads indisponivel, visitas que falharam ou fora da janela = indisponivel;
 *  - cancelamentos, estoque e reputacao: sem fonte = "—", zero real = 0;
 *  - Giro e Previsao: antes do historico chegar, placeholder (nunca 0 vendido);
 *  - nenhum `|| 0` / `?? 0` nas decisoes corrigidas.
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
const PH = '—';

// ── Home: funcoes REAIS do periodo; rede e DOM falsos ────────────────────────
const P = { from: '2026-10-01', to: '2026-10-20' };
const metrics = ({ from, to }, bruto, extra = {}) => ({ periodo: { fromYmd: from, toYmd: to, faturamento: { bruto, tarifaML: -bruto * 0.148, tarifaEnv: -bruto * 0.144, liquido: bruto * 0.708, estimado: true, fonte: 'dashboard_legado', metodologia: 'x' }, porItem: [], ...extra } });

/**
 * `visitas`: 'falha' | lista de { date, total } devolvida pela API.
 * `ads`: resposta de campaigns/search do periodo (ausente = falha).
 */
function home({ m = metrics(P, 0, { pedidos: 0, unidades: 0 }), visitas = [], ads, periodo = P, periodoLoad = 'loaded' } = {}) {
  const fonte = [
    'const _AGORA = new Date("2026-10-28T12:00:00.000-03:00");',
    extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'), extrairFuncao('dentroDoPeriodo'),
    'function hojeBRT() { return ymdBRT(_AGORA); }',
    extrairFuncao('gdrDiasEntre'),
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
    'let allOrders = [], allItems = [{ id: "MLB1", status: "active", title: "Vinho", sold_quantity: 3 }], _metrics = null;',
    'let periodoData = [], periodoTotais = null, periodoDateInicio = null, periodoDateFim = null;',
    'let _periodo = _p0;',
    'function gdrGet() { return { from: _periodo.from, toEfetivo: _periodo.to, fromDate: brtStartOfDay(_periodo.from), toDateEfetivo: brtEndOfDay(_periodo.to), dias: 1 }; }',
    'function pedidosEmMemoria() { return false; }',
    'function selecaoTemFinanceiro() { return true; }',
    'function selecaoLegada() { return true; } function selecaoConsolidada() { return false; }',
    'function selecaoTemAmazon() { return false; } function selecaoTemMercadoLivre() { return true; }',
    'function contasParaProxy() { return [null]; } function _contaProxy(c) { return c; } function chaveLocal(b) { return b; }',
    'const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };',
    'const USER_ID = 1;',
    'async function mlFetch(path) {',
    '  if (path.includes("items_visits")) { if (_vis === "falha") throw new Error("HTTP 500"); return { results: _vis }; }',
    '  if (path.includes("/advertising/advertisers?product_id=PADS")) return { advertisers: [{ site_id: "MLB", advertiser_id: 7 }] };',
    '  if (path.includes("/product_ads/campaigns/search")) { if (!_ads) throw new Error("HTTP 500"); return _ads; }',
    '  return { results: [] };',
    '}',
    'async function visitasDaSelecao() { return { results: [] }; }',
    'let _adsLoadState = "idle", _periodoLoadState = _pl; let _visitasPeriodoOk = null;',
    'let adsApi = null; let _adsSeq = 0; let pubManual = null; let mlAdsReports = [];',
    'const MOD_PLACEHOLDER = "\\u2014", INDISPONIVEL = "indispon\\u00edvel";',
    'function htmlIndisponivel(m) { return "[indisponivel: " + m + "]"; } function htmlAvisoSelecao(x) { return x; } function escHtml(x) { return String(x); }',
    'function rotuloMetodo() { return ""; } function textoRessalvas() { return ""; } function textoCobertura() { return "cobertura"; } function textoFinanceiroAmazon() { return ""; }',
    'const _dom = {}; const document = { activeElement: null, getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", value: "", placeholder: "", disabled: false, style: {}, title: "", setAttribute() {} }) };',
    'const console = { warn() {}, log() {} };',
    extrairFuncao('metricsDoPeriodo'), extrairFuncao('agregadoCompleto'),
    extrairFuncao('fontePorItemPeriodo'), extrairFuncao('totaisDoPeriodo'), extrairFuncao('ticketMedioExibido'),
    'async ' + extrairFuncao('loadPeriodoData'),
    extrairFuncao('calcLiquidoPeriodo'), extrairFuncao('liquidoApurado'),
    'const VISITAS_JANELA_API_DIAS = 150;', extrairFuncao('janelaVisitas'),
    extrairFuncao('renderKPIsPeriodo'),
    extrairFuncao('pubManualPermitida'), extrairFuncao('pubManualDoPeriodo'),
    'async ' + extrairFuncao('loadAdCost'), 'async ' + extrairFuncao('loadAdCostDaConta'),
    extrairFuncao('custoDaCampanha'), extrairFuncao('valorDeCusto'), extrairFuncao('valorDeCustoOuZero'),
    extrairFuncao('publicidadeDoPeriodo'), extrairFuncao('rotuloFontePublicidade'), extrairFuncao('textoPublicidadeIndisponivel'),
    extrairFuncao('ymdDeDataXlsx'), extrairFuncao('xlsxDoPeriodo'),
    `return {
      async boot() {
        _metrics = _m;
        if (_periodoLoadState === 'loaded') await loadPeriodoData(_periodo.from, _periodo.to);
        _adsLoadState = "loading";
        await loadAdCost(_periodo.from, _periodo.to).then(() => { _adsLoadState = "loaded"; }, () => { _adsLoadState = "error"; });
        renderKPIsPeriodo();
        return _dom;
      },
    };`,
  ].join('\n');
  return new Function('_m', '_vis', '_ads', '_p0', '_pl', fonte)(m, visitas, ads, periodo, periodoLoad);
}
const v = (d, id) => (d[id].innerHTML && /indisponivel/.test(d[id].innerHTML)) ? 'IND' : d[id].textContent;

describe('1. HTML inicial: nenhum KPI nasce com zero', () => {
  test('cards da Home, Pedidos, Margem, Giro e Previsao comecam em "-"', () => {
    const ids = ['kpi-active', 'kpi-total', 'kpi-paused', 'kpi-nostock', 'kpi-avgprice', 'kpi-stock', 'kpi-sold',
      'kpi-faturamento', 'kpi-liq', 'kpi-tarifa-ml', 'kpi-tarifa-env', 'kpi-visitas', 'kpi-transacoes', 'kpi-unidades', 'kpi-conversao', 'kpi-ticket',
      'ord-hoje-val', 'ord-mes-val', 'ord-sem-val', 'ord-ticket', 'ord-cancel', 'mg-bruto', 'mg-liq', 'mg-pub', 'mg-margem',
      'gr-c-estoque', 'pv-c-vendido', 'pv-c-media', 'pv-c-proj', 'canc-total', 'canc-taxa'];
    for (const id of ids) {
      const m = html.match(new RegExp('id="' + id + '"[^>]*>([^<]*)<'));
      assert.ok(m, id);
      assert.ok(!/^\s*(0|0%|R\$\s*0([.,]0+)?)\s*$/.test(m[1]), id + ' nasce com zero: "' + m[1] + '"');
    }
    assert.match(html, /id="kpi-pub-input"[^>]*placeholder="—"/);
    assert.match(html, /id="kpi-pub-status">carregando\.\.\.</);
  });
});

describe('Home', () => {
  test('1b. periodo ainda carregando: visitas, transacoes, unidades, conversao e ticket em "—"', async () => {
    const d = await home({ periodoLoad: 'loading', ads: undefined }).boot();
    for (const id of ['kpi-visitas', 'kpi-transacoes', 'kpi-unidades', 'kpi-conversao', 'kpi-ticket']) assert.equal(d[id].textContent, PH, id);
  });

  test('2/3. agregado valido com faturamento 0 e 0 pedidos: R$ 0 e 0 (zero real)', async () => {
    const d = await home({ ads: { metrics_summary: { cost: 0 }, results: [], paging: { total: 0 } } }).boot();
    assert.equal(d['kpi-faturamento'].textContent.replace(/\s/g, ' '), 'R$ 0');
    assert.equal(d['kpi-transacoes'].textContent, '0');
    assert.equal(d['kpi-unidades'].textContent, '0');
  });

  test('4. Ads indisponivel: "—"; 5. Ads valido = 0: R$ 0,00', async () => {
    const ind = await home({ ads: undefined }).boot();
    assert.equal(ind['kpi-pub-input'].value, '');
    assert.equal(ind['kpi-pub-input'].placeholder, PH);
    assert.match(ind['kpi-pub-status'].textContent, /indispon/);
    const zero = await home({ ads: { metrics_summary: { cost: 0 }, results: [], paging: { total: 0 } } }).boot();
    assert.equal(zero['kpi-pub-input'].value, '0.00');
  });

  test('12. visitas com o periodo fora da janela da API: indisponivel', async () => {
    const d = await home({ periodo: { from: '2026-01-01', to: '2026-03-31' }, m: metrics({ from: '2026-01-01', to: '2026-03-31' }, 0) }).boot();
    assert.equal(v(d, 'kpi-visitas'), 'IND');
    assert.equal(v(d, 'kpi-conversao'), 'IND');
  });

  test('13. visitas validas = 0: mostra 0 (a API cobriu o periodo e devolveu zero)', async () => {
    const dias = ['2026-10-05', '2026-10-06'].map(date => ({ date: date + 'T00:00:00.000-03:00', total: 0 }));
    const d = await home({ visitas: dias }).boot();
    assert.equal(d['kpi-visitas'].textContent, '0');
    assert.equal(d['kpi-visitas-sub'].textContent, 'no período');
  });

  test('14. erro de rede nas visitas NAO vira zero: visitas e conversao indisponiveis', async () => {
    const d = await home({ visitas: 'falha' }).boot();
    assert.equal(v(d, 'kpi-visitas'), 'IND');
    assert.match(d['kpi-visitas'].innerHTML, /consulta de visitas falhou/);
    assert.equal(v(d, 'kpi-conversao'), 'IND');
  });
});

describe('cancelamentos, estoque, reputacao', () => {
  test('6/7. cancelamentos: sem populacao "—"; 0 em populacao completa = 0%', () => {
    const fab = (hist, canc, ok) => new Function('_h', '_c', '_ok', [
      extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'), extrairFuncao('dentroDoPeriodo'), extrairFuncao('pedidoAmazon'), extrairFuncao('pedidoCancelado'),
      'let allOrders = _h, allCancelledOrders = _c, _ultimoPartial = false, _ordersLoadState = _h.length ? "loaded" : "idle";',
      'let _cancelLoadState = _ok ? "loaded" : "idle", _cancelCobertura = _ok ? { ok: true, limiteYmd: null } : null;',
      'function pedidosEmMemoria() { return _ordersLoadState === "loaded" && allOrders.length > 0; } function selecaoTemMercadoLivre() { return true; }',
      extrairFuncao('motivoCoberturaCancelados'), extrairFuncao('cancelamentoOperacional'),
      'return cancelamentoOperacional("2026-10-01", "2026-10-20", { canal: "ml" });',
    ].join('\n'))(hist, canc, ok);
    const pago = id => ({ id, status: 'paid', date_created: '2026-10-05T12:00:00.000-03:00' });
    const sem = fab([], [], false);
    assert.deepEqual([sem.disponivel, sem.taxa], [false, null]);
    const zero = fab([pago(1), pago(2)], [], true);
    assert.deepEqual([zero.disponivel, zero.cancelados, zero.pedidos, zero.taxa], [true, 0, 2, 0]);
  });

  test('8/9. estoque: incompleto = parcial (null); completo zero = 0; componente zero = 0', () => {
    const g = new Function([
      "const CONTA_LEGADA = 'overwine-ml'; let CONTAS_DISPONIVEIS = [];",
      extrairFuncao('contaInfo'), extrairFuncao('contaDaEmpresaOverwine'), extrairFuncao('pedidoAmazon'),
      "function itemSKU(i) { return i.seller_custom_field; }",
      extrairFuncao('isFullItem'), extrairFuncao('fullStockKey'), extrairFuncao('isFbaItem'), extrairFuncao('consolidarEstoqueGrupo'),
      extrairFuncao('_qtdInformada'), extrairFuncao('estoqueFisicoDoGrupo'),
      'return estoqueFisicoDoGrupo;',
    ].join('\n'))();
    const ml = q => ({ id: 'MLB1', seller_custom_field: 'A', available_quantity: q, shipping: { logistic_type: 'xd_drop_off' }, tags: [] });
    const amz = q => ({ id: 'A', canal: 'amazon', seller_custom_field: 'A', available_quantity: q, shipping: { logistic_type: 'amazon_proprio' }, tags: null });
    const fba = q => ({ id: 'A#fba', canal: 'amazon', seller_custom_field: 'A', available_quantity: q, shipping: { logistic_type: 'amazon_fba' }, tags: null, inventory_id: 'FN' });
    const parcial = g([ml(5), amz(5)]);
    assert.deepEqual([parcial.completo, parcial.totalFisico, parcial.amazonFba], [false, null, null]);
    const zero = g([ml(0), amz(0), fba(0)]);
    assert.deepEqual([zero.completo, zero.totalFisico, zero.amazonFba], [true, 0, 0]);
  });

  function reputacao(rep, { hist = false, metrics60 = null } = {}) {
    const dom = {};
    new Function('_rep', '_hist', '_m60', '_dom', [
      extrairConstante('ML_REPUTATION_TARGETS'),
      'let reputacaoData = _rep, _repIndisponivelConsolidado = false, _repLoadState = "loaded", allOrders = [], _metrics = _m60 ? { reputacao60d: _m60 } : null;',
      'function pedidosEmMemoria() { return _hist; } function pedidoPago() { return true; }',
      'const MOD_PLACEHOLDER = "\\u2014", INDISPONIVEL = "indispon\\u00edvel";',
      'const document = { getElementById: id => (_dom[id] ??= { innerHTML: "" }) };',
      extrairFuncao('renderCardReputacao'), 'renderCardReputacao();',
    ].join('\n'))(rep, hist, metrics60, dom);
    return dom['card-reputacao'].innerHTML.replace(/\s+/g, ' ');
  }

  test('10. reputacao ausente: "—" nas taxas, nas vendas do historico e no progresso (nunca 0 / "Faltam")', () => {
    const r = reputacao({ level_id: '5_green', metrics: {} });
    assert.equal((r.match(/60d\)<\/span> <span[^>]*>—<\/span>/g) || []).length, 3);
    assert.match(r, />— vendas no historico</);
    assert.ok(!/>0 vendas no historico</.test(r));
    assert.ok(!/Faltam/.test(r), 'sem vendas nem faturamento conhecidos nao ha "Faltam"');
    assert.ok(!/>R\$ 0 </.test(r));
  });

  test('11. reputacao real = 0: "0% perfeito"; vendas 0 e faturamento 0 sao zero real', () => {
    const r = reputacao({ level_id: '5_green', transactions: { total: 0 }, metrics: { sales: { completed: 0 }, cancellations: { rate: 0 }, claims: { rate: 0 }, delayed_handling_time: { rate: 0 } } }, { metrics60: { bruto: 0 } });
    assert.equal((r.match(/0% perfeito/g) || []).length, 3);
    assert.match(r, />0 vendas no historico</);
    assert.match(r, /Faltam/);
  });
});

describe('telas que dependem do historico: loading nunca e zero', () => {
  test('Giro e Previsao antes do historico: placeholder e "carregando", sem 0 vendido', () => {
    const g = extrairFuncao('renderGiro');
    assert.match(g, /if \(!pedidosEmMemoria\(\)\) \{[\s\S]*?\['gr-c-vendido', 'gr-c-meta', 'gr-c-giro'\]\.forEach\(id => \{[^}]*MOD_PLACEHOLDER/);
    assert.match(g, /Carregando hist\\u00f3rico de pedidos\.\.\./);
    assert.ok(g.indexOf('if (!pedidosEmMemoria())') < g.indexOf('grBuildData()'), 'guarda antes do calculo');
    const p = extrairFuncao('renderPrevisao');
    assert.match(p, /if \(!pedidosEmMemoria\(\)\) \{[\s\S]*?\['pv-c-vendido', 'pv-c-media', 'pv-c-proj'\]\.forEach\(id => \{[^}]*MOD_PLACEHOLDER/);
    assert.ok(p.indexOf('if (!pedidosEmMemoria())') < p.indexOf("getElementById('pv-c-vendido').textContent = pvFmtBRL"));
  });

  test('Home "Vendas Totais" e "Preco Medio": sem dado = "—", nunca 0', () => {
    const run = itens => {
      const dom = {};
      new Function('_itens', '_dom', [
        "const CONTA_LEGADA = 'overwine-ml'; let CONTAS_DISPONIVEIS = []; let SELECAO = ['overwine-ml'];",
        extrairFuncao('selecaoConsolidada'), extrairFuncao('contaInfo'), extrairFuncao('contaDaEmpresaOverwine'), extrairFuncao('pedidoAmazon'),
        'let allItems = _itens;',
        extrairFuncao('_skuDoVendedor'), 'let _indiceCatalogo = { ref: null, mapa: null };', extrairFuncao('_skuPorCatalogo'),
        'function empresaDaConta(c) { return c; }', extrairFuncao('itemSKU'),
        extrairFuncao('isFullItem'), extrairFuncao('fullStockKey'), extrairFuncao('isFbaItem'), extrairFuncao('consolidarEstoqueGrupo'),
        extrairFuncao('_qtdInformada'), extrairFuncao('estoqueFisicoDoGrupo'), extrairFuncao('estoqueFisicoTotal'), extrairConstante('ROTULO_PENDENCIA_ESTOQUE'),
        'const MOD_PLACEHOLDER = "\\u2014";',
        'const document = { getElementById: id => (_dom[id] ??= { textContent: "", title: "" }) };',
        extrairFuncao('renderKPIs'), 'renderKPIs();',
      ].join('\n'))(itens, dom);
      return dom;
    };
    const amz = { id: 'A', canal: 'amazon', status: 'paused', seller_custom_field: 'A', sold_quantity: null, available_quantity: 3, price: 50, shipping: { logistic_type: 'amazon_proprio' }, tags: null, amazon: { estoqueInformado: true } };
    const d = run([amz]);
    assert.equal(d['kpi-sold'].textContent, PH);
    assert.equal(d['kpi-avgprice'].textContent, PH);
    const ml = { id: 'MLB1', status: 'active', seller_custom_field: 'B', sold_quantity: 0, available_quantity: 0, price: 80, shipping: { logistic_type: 'xd_drop_off' }, tags: [] };
    const d2 = run([ml, amz]);
    assert.equal(d2['kpi-sold'].textContent, '0', 'zero real do ML');
    assert.match(d2['kpi-sold'].title, /1 anúncio sem vendas informadas \(Amazon\)/);
    assert.equal(d2['kpi-avgprice'].textContent.replace(/\s/g, ' '), 'R$ 80');
  });
});

describe('15. nenhum || 0 / ?? 0 nas decisoes corrigidas', () => {
  test('reputacao, Margem sem financeiro, Home e Mais Vendidos', () => {
    const rep = extrairFuncao('renderCardReputacao');
    assert.ok(!/transactions\?\.total \|\| 0/.test(rep));
    assert.ok(!/fallback defensivo/.test(rep));
    assert.ok(!/reputacao60d\.bruto \|\| 0/.test(rep));
    assert.ok(!/receitaProdutos \|\| 0/.test(extrairFuncao('renderMargemSemFinanceiro')));
    const k = extrairFuncao('renderKPIs');
    assert.ok(!/sold_quantity \|\| 0/.test(k));
    assert.ok(!/\(active \|\| 1\)/.test(k));
    assert.ok(!/sold_quantity \|\| 0\} vendas/.test(extrairFuncao('renderTopVendasSidebar')));
    const lp = extrairFuncao('loadPeriodoData');
    assert.match(lp, /_visitasPeriodoOk = false;/);
  });
});

describe('Qualidade: visitas que falharam ou nao chegaram nao viram "0 visitas"', () => {
  function qualidade(estadoVisitas) {
    const dom = {};
    new Function('_estado', '_dom', [
      'let _visitasPeriodoOk = _estado;',
      'const MOD_PLACEHOLDER = "\\u2014";',
      'function escHtml(x) { return String(x); } function fmtPrice(v) { return String(v); } function attrConta() { return ""; } function tagConta() { return ""; }',
      'function gdrGet() { return { label: "out/26" }; }',
      // dois anuncios ativos; um com atividade no periodo (0 visitas, 1 venda), um sem atividade
      'let allItems = [{ id: "MLB1", status: "active", title: "Vinho A", listing_type_id: "gold_special", price: 100, available_quantity: 5 },',
      '                { id: "MLB2", status: "active", title: "Vinho B", listing_type_id: "gold_special", price: 90, available_quantity: 4 }];',
      'let periodoData = [{ id: "MLB1", titulo: "Vinho A", visitas: 0, vendas: 1, receita: 100, conversao: 0 }];',
      'const document = { getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "" }) };',
      extrairFuncao('renderQualidade'), 'renderQualidade();',
    ].join('\n'))(estadoVisitas, dom);
    const t = id => dom[id].innerHTML.replace(/\s+/g, ' ');
    return { ranking: t('qualidade-table'), semVisitas: t('semvisitas-table'), periodo: t('periodo-table') };
  }

  test('1. falha de visitas: nenhum ranking "menos visitas", nenhuma lista "sem visitas", colunas em "—"', () => {
    const q = qualidade(false);
    assert.match(q.ranking, /Visitas indisponíveis \(a consulta falhou\)/);
    assert.ok(!/MLB1|MLB2/.test(q.ranking));
    assert.match(q.semVisitas, /Visitas indisponíveis \(a consulta falhou\)/);
    assert.ok(!/MLB2/.test(q.semVisitas), 'MLB2 nao e "sem visitas" por falha da fonte');
    assert.match(q.periodo, /MLB1<\/div><\/td> <td title="Visitas indisponíveis \(a consulta falhou\)">—<\/td> <td>1<\/td>/);
    assert.ok(!/>0<\/td>|0%/.test(q.periodo), 'nem visitas 0 nem conversao 0%');
  });

  test('2. visitas ainda carregando: nao classifica (mensagem de carregamento)', () => {
    const q = qualidade(null);
    assert.match(q.ranking, /Carregando visitas\.\.\./);
    assert.match(q.semVisitas, /Carregando visitas\.\.\./);
    assert.ok(!/MLB2/.test(q.semVisitas));
    assert.match(q.periodo, /<td title="Carregando visitas\.\.\.">—<\/td>/);
  });

  test('3. resposta valida com zero: zero e legitimo e participa da classificacao', () => {
    const q = qualidade(true);
    assert.match(q.ranking, /MLB1<\/div> <\/td> <td><span[^>]*>gold_special<\/span><\/td> <td>0<\/td>/);
    assert.match(q.semVisitas, /MLB2/);
    assert.match(q.periodo, /MLB1<\/div><\/td> <td>0<\/td> <td>1<\/td>/);
    assert.match(q.periodo, /0%/);
  });
});

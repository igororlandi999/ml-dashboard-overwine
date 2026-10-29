/**
 * FASE A4 — Publicidade com fonte confiavel e periodo exato.
 *
 * Travado aqui:
 *  - publicidadeDoPeriodo(from, to) e a fonte unica de Home e Margem, com a
 *    precedencia manual (do periodo exato) > API Product Ads (metrics_summary
 *    .cost do periodo exato) > XLSX importado (periodo exato) > indisponivel;
 *  - zero e valor valido; custo de outro periodo, resposta atrasada de outro
 *    periodo, periodo acima de 90 dias e consulta que falhou nunca viram custo;
 *  - nada de valor fixo, media diaria ou extrapolacao (ADS_DATA removido);
 *  - hoje entra como veio, sinalizado "parcial hoje";
 *  - ROAS/ACOS so existem na aba ML Ads e saem do proprio relatorio;
 *  - receita/liquido da A3 e as formulas da Margem nao mudam.
 *
 * Os cards da Home sao montados com as funcoes REAIS (renderKPIsPeriodo,
 * aplicarPeriodoGlobal, loadAdCost, loadAdCostDaConta, publicidadeDoPeriodo,
 * fonte manual e XLSX); so a rede (mlFetch/loadMetrics) e o DOM sao falsos.
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

// ── Fixture deterministica ──────────────────────────────────────────────────
const P1 = { from: '2026-10-01', to: '2026-10-20' };   // 20 dias, receita 2.000
const P2 = { from: '2026-09-01', to: '2026-09-30' };   // 30 dias, receita 5.000
const HOJE = { from: '2026-10-28', to: '2026-10-28' }; // "hoje" do relogio falso
const LONGO = { from: '2026-06-01', to: '2026-10-20' }; // > 90 dias
const chave = p => p.from + '..' + p.to;

function metrics({ from, to }, bruto) {
  return {
    periodo: {
      fromYmd: from, toYmd: to,
      faturamento: { bruto, tarifaML: -bruto * 0.148, tarifaEnv: -bruto * 0.144, liquido: bruto * (1 - 0.148 - 0.144), estimado: true, fonte: 'dashboard_legado', metodologia: 'x' },
      porItem: [],
    },
  };
}
const METRICS = { [chave(P1)]: metrics(P1, 2000), [chave(P2)]: metrics(P2, 5000), [chave(HOJE)]: metrics(HOJE, 100), [chave(LONGO)]: metrics(LONGO, 9000) };

/** Resposta de campaigns/search: o resumo e as campanhas podem divergir de proposito. */
const resposta = (resumo, campanhas = []) => ({
  metrics_summary: resumo === undefined ? undefined : { cost: resumo, clicks: 1 },
  results: campanhas.map((cost, i) => ({ id: i + 1, metrics: { cost } })),
  paging: { total: campanhas.length },
});

/**
 * `ads` = resposta de campaigns/search por "date_from..date_to" pedido; ausente
 * = a consulta falha (HTTP 500). `atraso` = ms de espera por periodo.
 */
function montar({ ads = {}, atraso = {}, consolidado = false, xlsx = [], storage = {}, periodo = P1 } = {}) {
  const fonte = [
    'const _AGORA = new Date("2026-10-28T12:00:00.000-03:00");',
    extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'), extrairFuncao('dentroDoPeriodo'),
    'function hojeBRT() { return ymdBRT(_AGORA); }',
    extrairFuncao('gdrDiasEntre'),
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
    'let allOrders = [], allItems = [], _metrics = null;',
    'let periodoData = [], periodoTotais = null, periodoDateInicio = null, periodoDateFim = null;',
    'let _periodo = _p0;',
    'function gdrGet() { return { from: _periodo.from, toEfetivo: _periodo.to, fromDate: brtStartOfDay(_periodo.from), toDateEfetivo: brtEndOfDay(_periodo.to), dias: 1 }; }',
    'function pedidosEmMemoria() { return false; }',
    'function selecaoTemFinanceiro() { return true; }',
    'function selecaoLegada() { return !_consol; } function selecaoConsolidada() { return _consol; }',
    'function selecaoTemAmazon() { return false; } function selecaoTemMercadoLivre() { return true; }',
    'function contasParaProxy() { return _consol ? ["overwine-ml", "degustar-ml"] : [null]; }',
    'function _contaProxy(c) { return c; }',
    'function chaveLocal(b) { return b; }',
    'const localStorage = { getItem: k => (k in _st ? _st[k] : null), setItem: (k, v) => { _st[k] = String(v); }, removeItem: k => { delete _st[k]; } };',
    'const _pedidosAds = [];',
    'async function mlFetch(path) {',
    '  if (path.includes("/advertising/advertisers?product_id=PADS")) return { advertisers: [{ site_id: "MLB", advertiser_id: 7 }] };',
    '  if (path.includes("/product_ads/campaigns/search")) {',
    '    const q = new URLSearchParams(path.split("?")[1]); const k = q.get("date_from") + ".." + q.get("date_to");',
    '    _pedidosAds.push(k);',
    '    if (_atraso[k]) await new Promise(r => setTimeout(r, _atraso[k]));',
    '    if (!(k in _ads)) throw new Error("HTTP 500");',
    '    return _ads[k];',
    '  }',
    '  return { results: [] };',
    '}',
    'async function visitasDaSelecao() { return { results: [] }; }',
    'async function loadMetrics(dias, from, to) { const r = _metricsPor[from + ".." + to]; if (r) _metrics = r; return r; }',
    'function showToast() {}',
    'function renderQualidade() {} function renderChartReceitaProduto() {} function renderCardReputacao() {} function renderVisaoGeral() {}',
    'let _adsLoadState = "idle", _periodoLoadState = "loaded";',
    'let adsApi = null; let _adsSeq = 0; let pubManual = null; let mlAdsReports = _xlsx;',
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
    'async ' + extrairFuncao('aplicarPeriodoGlobal'),
    // Publicidade: tudo REAL.
    extrairFuncao('pubManualPermitida'), extrairFuncao('pubManualLer'), extrairFuncao('pubManualCarregar'),
    extrairFuncao('pubManualDoPeriodo'), extrairFuncao('pubManualGravar'), extrairFuncao('saveKpiPubManual'),
    'async ' + extrairFuncao('loadAdCost'), 'async ' + extrairFuncao('loadAdCostDaConta'),
    extrairFuncao('custoDaCampanha'), extrairFuncao('valorDeCusto'), extrairFuncao('valorDeCustoOuZero'),
    extrairFuncao('publicidadeDoPeriodo'), extrairFuncao('rotuloFontePublicidade'), extrairFuncao('textoPublicidadeIndisponivel'),
    extrairFuncao('ymdDeDataXlsx'), extrairFuncao('xlsxDoPeriodo'),
    'pubManualCarregar();',
    `return {
      async boot() {
        await loadMetrics(null, _periodo.from, _periodo.to);
        await loadPeriodoData(_periodo.from, _periodo.to);
        _adsLoadState = "loading";
        await loadAdCost(_periodo.from, _periodo.to).then(() => { _adsLoadState = "loaded"; }, () => { _adsLoadState = "error"; });
        renderKPIsPeriodo();
        return _dom;
      },
      async trocarPeriodo(p) { _periodo = p; await aplicarPeriodoGlobal(); return _dom; },
      async consultar(p) { return loadAdCost(p.from, p.to); },
      definirPeriodoSemConsultar(p) { _periodo = p; renderKPIsPeriodo(); return _dom; },
      digitarManual(v) { _dom['kpi-pub-input'] = _dom['kpi-pub-input'] || { style: {} }; document.getElementById('kpi-pub-input').value = String(v); saveKpiPubManual(); renderKPIsPeriodo(); return _dom; },
      pub(p) { return publicidadeDoPeriodo(p.from, p.to); },
      api() { return adsApi; },
      render() { renderKPIsPeriodo(); return _dom; },
      pedidosAds: _pedidosAds, storage: _st, dom: _dom,
    };`,
  ].join('\n');
  return new Function('_ads', '_atraso', '_consol', '_xlsx', '_st', '_metricsPor', '_p0', fonte)(ads, atraso, consolidado, xlsx, storage, METRICS, periodo);
}

const card = d => ({ valor: d['kpi-pub-input'].value, placeholder: d['kpi-pub-input'].placeholder, status: d['kpi-pub-status'].textContent, title: d['kpi-pub-status'].title });

describe('API Product Ads — metrics_summary.cost do periodo exato', () => {
  test('1. custo positivo: usa EXATAMENTE metrics_summary.cost (nao a soma das campanhas)', async () => {
    const h = montar({ ads: { [chave(P1)]: resposta(200, [150, 30]) } });
    const d = await h.boot();
    assert.deepEqual(h.pub(P1), { disponivel: true, custo: 200, fonte: 'api_product_ads', periodoExato: true, parcial: false, motivo: null });
    assert.equal(card(d).valor, '200.00');
    assert.equal(card(d).status, '10.0% do bruto · Product Ads');
    assert.deepEqual(h.pedidosAds, [chave(P1)], 'pediu o periodo exato');
  });

  test('2. custo zero e valor valido (nem "—", nem fallback)', async () => {
    const h = montar({ ads: { [chave(P1)]: resposta(0, [0]) } });
    const d = await h.boot();
    const p = h.pub(P1);
    assert.equal(p.disponivel, true); assert.equal(p.custo, 0); assert.equal(p.fonte, 'api_product_ads');
    assert.equal(card(d).valor, '0.00');
    assert.equal(card(d).status, '0.0% do bruto · Product Ads');
  });

  test('3. API indisponivel: custo "—" e o motivo, nunca zero', async () => {
    const h = montar({ ads: {} });
    const d = await h.boot();
    assert.equal(h.pub(P1).disponivel, false);
    assert.equal(h.pub(P1).custo, null);
    assert.equal(h.pub(P1).motivo, 'consulta_falhou');
    assert.equal(card(d).valor, '');
    assert.equal(card(d).placeholder, '—');
    assert.equal(card(d).status, 'publicidade indisponível (a consulta falhou)');
  });

  test('4. custo consultado para OUTRO periodo nao e usado', async () => {
    const h = montar({ ads: { [chave(P2)]: resposta(350) } });
    await h.consultar(P2);                 // a ultima consulta foi de setembro
    const d = h.definirPeriodoSemConsultar(P1);
    assert.equal(h.api().custo, 350);
    assert.equal(h.pub(P1).disponivel, false);
    assert.equal(card(d).valor, '');
    assert.equal(card(d).status, 'publicidade indisponível (sem dado do período)');
  });

  test('4b. resposta atrasada de um periodo ja trocado e descartada', async () => {
    const h = montar({ ads: { [chave(P1)]: resposta(200), [chave(P2)]: resposta(350) }, atraso: { [chave(P1)]: 30 } });
    await Promise.all([h.consultar(P1), h.consultar(P2)]); // P1 chega por ultimo
    assert.deepEqual([h.api().de, h.api().ate, h.api().custo], [P2.from, P2.to, 350]);
    assert.equal(h.pub(P1).disponivel, false);
  });

  test('5. troca de periodo: o custo passa a ser o do NOVO periodo (200 → 350)', async () => {
    const h = montar({ ads: { [chave(P1)]: resposta(200), [chave(P2)]: resposta(350) } });
    assert.equal(card(await h.boot()).valor, '200.00');
    const d = await h.trocarPeriodo(P2);
    assert.equal(card(d).valor, '350.00');
    assert.equal(card(d).status, '7.0% do bruto · Product Ads');
    assert.deepEqual(h.pedidosAds, [chave(P1), chave(P2)]);
  });

  test('5b. periodo acima de 90 dias: a API so responde os ultimos 90 — indisponivel, nao o recorte', async () => {
    const recorte = '2026-07-23..2026-10-20';
    const h = montar({ ads: { [recorte]: resposta(999) }, periodo: LONGO });
    const d = await h.boot();
    assert.deepEqual(h.pedidosAds, [recorte]);
    assert.equal(h.pub(LONGO).disponivel, false);
    assert.equal(h.pub(LONGO).motivo, 'periodo_acima_90_dias');
    assert.equal(card(d).valor, '');
    assert.equal(card(d).status, 'publicidade indisponível (período acima de 90 dias)');
  });

  test('5c. custo invalido (negativo / nao numerico) no resumo nao vira custo', async () => {
    for (const ruim of [-50, 'abc']) {
      const h = montar({ ads: { [chave(P1)]: resposta(ruim, [10]) } });
      await h.boot();
      // sem resumo valido cai na soma das campanhas do MESMO periodo (lista completa)
      assert.equal(h.pub(P1).custo, 10, String(ruim));
    }
  });

  test('5d. sem resumo e lista de campanhas maior que 4 paginas: indisponivel, nunca soma parcial', async () => {
    const pagina = { results: Array.from({ length: 50 }, () => ({ metrics: { cost: 1 } })), paging: { total: 400 } };
    const h = montar({ ads: { [chave(P1)]: pagina } });
    await h.boot();
    assert.equal(h.pub(P1).disponivel, false);
    assert.equal(h.pub(P1).motivo, 'consulta_falhou');
  });

  test('5e. consolidado: uma conta falhou → indisponivel, nunca a parte que veio', async () => {
    let n = 0;
    const h = montar({ consolidado: true, ads: { get [chave(P1)]() { n++; if (n > 1) throw new Error('500'); return resposta(200); } } });
    await h.boot();
    assert.equal(h.pub(P1).disponivel, false);
  });
});

describe('sem valor fixo, sem media diaria, sem extrapolacao', () => {
  test('6. nenhum vestigio do relatorio de marco/2026 embutido', () => {
    for (const s of ['147.91', '147,91', 'ADS_DATA', '2026-03-06', '2026-03-12', '06-mar-2026', '12-mar-2026', "'MLB4027199755': 53.28", 'getAdsDataParaPeriodo']) {
      assert.ok(!html.includes(s), s);
    }
  });

  test('7. nenhuma extrapolacao diaria: o custo nao escala com a duracao do periodo', async () => {
    for (const s of ['custoDiario', 'totalExtrapolado', 'diasCobertos', 'diasBase', 'currentPeriodoDias', "'extrapolado'"]) {
      assert.ok(!html.includes(s), s);
    }
    // Mesmo custo devolvido para um periodo de 20 e um de 30 dias: aparece igual.
    const h = montar({ ads: { [chave(P1)]: resposta(200), [chave(P2)]: resposta(200) } });
    assert.equal(card(await h.boot()).valor, '200.00');
    assert.equal(card(await h.trocarPeriodo(P2)).valor, '200.00');
    const corpo = extrairFuncao('publicidadeDoPeriodo');
    assert.ok(!/\/\s*dias|\*\s*dias|gdrDiasEntre/.test(corpo), 'nenhuma conta por dia na decisao');
  });

  test('13. hoje: valor como veio, sinalizado "parcial hoje", sem projecao do resto do dia', async () => {
    const h = montar({ ads: { [chave(HOJE)]: resposta(12.5) }, periodo: HOJE });
    const d = await h.boot();
    assert.equal(h.pub(HOJE).custo, 12.5);
    assert.equal(h.pub(HOJE).parcial, true);
    assert.equal(card(d).valor, '12.50');
    assert.equal(card(d).status, '12.5% do bruto · Product Ads · parcial hoje');
    assert.match(card(d).title, /sem proje/);
    // Periodo fechado nao e parcial.
    const h2 = montar({ ads: { [chave(P1)]: resposta(200) } });
    await h2.boot();
    assert.equal(h2.pub(P1).parcial, false);
  });
});

describe('fonte manual (mecanismo existente, agora preso ao periodo)', () => {
  test('10. manual digitado para o periodo vence a API NESSE periodo', async () => {
    const h = montar({ ads: { [chave(P1)]: resposta(200), [chave(P2)]: resposta(350) } });
    await h.boot();
    const d = h.digitarManual('300');
    assert.deepEqual(JSON.parse(h.storage.kpi_pub_manual), { valor: 300, de: P1.from, ate: P1.to });
    assert.equal(h.pub(P1).fonte, 'manual');
    assert.equal(h.pub(P1).custo, 300);
    assert.equal(card(d).status, '15.0% do bruto · manual');
  });

  test('11. manual de outro periodo nao contamina: em setembro vale a API', async () => {
    const h = montar({ ads: { [chave(P1)]: resposta(200), [chave(P2)]: resposta(350) } });
    await h.boot();
    h.digitarManual('300');
    const d = await h.trocarPeriodo(P2);
    assert.equal(h.pub(P2).fonte, 'api_product_ads');
    assert.equal(card(d).valor, '350.00');
  });

  test('11b. valor manual LEGADO (numero solto, sem periodo) e ignorado', async () => {
    const h = montar({ storage: { kpi_pub_manual: '150', mg_pub_manual: '150' }, ads: { [chave(P1)]: resposta(200) } });
    const d = await h.boot();
    assert.equal(h.pub(P1).fonte, 'api_product_ads');
    assert.equal(card(d).valor, '200.00');
    // e sem API nao vira fonte: fica indisponivel
    const h2 = montar({ storage: { kpi_pub_manual: '150' }, ads: {} });
    await h2.boot();
    assert.equal(h2.pub(P1).disponivel, false);
  });

  test('11c. apagar o campo remove o manual e devolve a API', async () => {
    const h = montar({ ads: { [chave(P1)]: resposta(200) } });
    await h.boot();
    h.digitarManual('300');
    const d = h.digitarManual('');
    assert.equal(h.storage.kpi_pub_manual, undefined);
    assert.equal(h.pub(P1).fonte, 'api_product_ads');
    assert.equal(card(d).valor, '200.00');
  });
});

describe('XLSX importado na aba ML Ads (sessao)', () => {
  const linhas = (desde, ate, invs) => invs.map(i => ({ desde, ate, investimento: i, receita: 0 }));
  const rel = (desde, ate, invs) => ({ de: desde, ate, rows: linhas(desde, ate, invs), totalInv: invs.reduce((s, x) => s + x, 0), totalRec: 0 });

  test('12. relatorio do periodo exato entra quando a API falha', async () => {
    const h = montar({ ads: {}, xlsx: [rel('01/10/2026', '20/10/2026', [120, 100])] });
    const d = await h.boot();
    assert.equal(h.pub(P1).fonte, 'xlsx_ml_ads');
    assert.equal(h.pub(P1).custo, 220);
    assert.equal(card(d).status, '11.0% do bruto · relatório ML Ads');
  });

  test('12b. relatorio de outro periodo, data ilegivel ou visao consolidada: nao entra', async () => {
    for (const [xlsx, consolidado] of [
      [[rel('06/03/2026', '12/03/2026', [147.91])], false],
      [[rel('01/10/2026', '19/10/2026', [100])], false],
      [[rel('46296', '46315', [100])], false],          // serial do Excel: periodo nao validavel
      [[rel('01/10/2026', '20/10/2026', [100])], true],
    ]) {
      const h = montar({ ads: {}, xlsx, consolidado });
      await h.boot();
      assert.equal(h.pub(P1).disponivel, false, JSON.stringify(xlsx[0].rows[0]) + ' consolidado=' + consolidado);
    }
  });

  test('12c. formatos de data aceitos e a precedencia: API do periodo vence o XLSX', async () => {
    const ymd = new Function(extrairFuncao('ymdDeDataXlsx') + '; return ymdDeDataXlsx;')();
    assert.equal(ymd('2026-10-01'), '2026-10-01');
    assert.equal(ymd('1/10/2026'), '2026-10-01');
    assert.equal(ymd('01-out-2026'), '2026-10-01');
    assert.equal(ymd('06-mar.-2026'), '2026-03-06');
    assert.equal(ymd(46296), null);
    assert.equal(ymd(''), null);
    const h = montar({ ads: { [chave(P1)]: resposta(200) }, xlsx: [rel('2026-10-01', '2026-10-20', [220])] });
    await h.boot();
    assert.equal(h.pub(P1).fonte, 'api_product_ads');
  });
});

describe('ROAS e ACOS — so na aba ML Ads, do proprio relatorio', () => {
  function relatorio(totalInv, totalRec) {
    const dom = {};
    const fn = new Function('document', [
      'function mladsRenderChartCampanhas() {} function mladsRenderChartDias() {} function mladsRenderTable() {}',
      extrairFuncao('mladsRenderReport'),
      'return mladsRenderReport;',
    ].join('\n'))({ getElementById: id => (dom[id] ??= { textContent: '', innerHTML: '', style: {} }) });
    fn({ de: '01/10/2026', ate: '20/10/2026', rows: [], totalInv, totalRec, totalImp: 0, totalClq: 0 }, 'r.xlsx');
    return dom['mlads-kpis'].innerHTML.replace(/\s+/g, ' ');
  }

  test('8/9. ROAS 2.000 / 200 = 10,0; investimento zero nao divide; nada de Infinity/NaN', () => {
    const ok = relatorio(200, 2000);
    assert.match(ok, /ROAS Geral<\/div> <div[^>]*> 10\.00x/);
    assert.match(ok, /ACOS[^<]*<\/div> <div[^>]*> 10\.0%/);
    const zero = relatorio(0, 2000);
    assert.match(zero, /ROAS Geral<\/div> <div[^>]*> - </);
    assert.ok(!/Infinity|NaN/.test(zero));
    const semReceita = relatorio(200, 0);
    assert.match(semReceita, /ACOS[^<]*<\/div> <div[^>]*> - </);
  });

  test('8b. a Home nao calcula ROAS e o relatorio nao escreve em nenhuma fonte global de custo', () => {
    assert.ok(!/roas|ROAS/.test(extrairFuncao('renderKPIsPeriodo')));
    assert.ok(!/ADS_DATA|adsApi|pubManual/.test(extrairFuncao('mladsRenderReport')));
  });
});

describe('o resto nao muda', () => {
  test('14. receita/liquido da A3 identicos com e sem custo de publicidade', async () => {
    const com = await montar({ ads: { [chave(P1)]: resposta(200) } }).boot();
    const sem = await montar({ ads: {} }).boot();
    for (const id of ['kpi-faturamento', 'kpi-liq', 'kpi-liq-pct', 'kpi-tarifa-ml', 'kpi-tarifa-env']) {
      assert.equal(com[id].textContent, sem[id].textContent, id);
    }
    assert.equal(com['kpi-faturamento'].textContent.replace(/\D/g, ''), '2000');
  });

  test('15. Margem: formulas intactas; so a origem do custo de publicidade mudou', () => {
    const r = extrairFuncao('renderMargem');
    for (const linha of [
      'const totBruto = T.receitaProdutos;',
      'const totLiq = T.receitaLiquida;',
      'const totCusto = T.custoTotal;',
      'const totMargem = T.margem - totPub;',
      'const pubProp = totPub > 0 && totBruto > 0 && p.bruto > 0 ? totPub * (p.bruto / totBruto) : 0;',
      'const _pub = publicidadeDoPeriodo(from, to);',
      'const totPub = _pub.disponivel ? _pub.custo : 0;',
    ]) assert.ok(r.includes(linha), linha);
    assert.ok(extrairFuncao('renderMargemSemFinanceiro').includes('const _pub = publicidadeDoPeriodo(_gPub.from, _gPub.toEfetivo);'));
  });
});

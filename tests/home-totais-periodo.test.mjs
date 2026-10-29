/**
 * FASE A2 — Performance do Periodo (Home) com UMA unica base.
 *
 * Travado aqui:
 *  - Transacoes, Unidades e Ticket da Home saem de `totaisDoPeriodo`: todos os
 *    pedidos validos (contaComoVenda) do periodo, cada pedido UMA vez, TODOS os
 *    order_items, sem filtro pelo status atual do anuncio;
 *  - ticket exibido = faturamento exibido / transacoes exibidas, por construcao
 *    (ticketMedioExibido sobre o mesmo valor escrito em kpi-faturamento);
 *  - pedido multi-item: 1 pedido, unidades = soma das quantidades, faturamento
 *    uma vez;
 *  - venda de anuncio hoje PAUSADO continua nos totais;
 *  - as visoes POR PRODUTO (periodoData: Receita por Produto, Qualidade,
 *    conversao) ficam como eram — inclusive o paid_amount inteiro no 1o item e
 *    o filtro de anuncios ativos — e nao alimentam mais os totais;
 *  - conversao continua vendas de anuncios ativos (1o item) / visitas ML;
 *  - SEM historico em memoria (FASE A2c): os totais vem de
 *    `_metrics.periodo.pedidos` e `_metrics.periodo.unidades` (backend A2b),
 *    quando o agregado e do periodo exato e os DOIS campos sao inteiros >= 0
 *    (zero e dado valido). Backend antigo (sem os campos) ou contrato
 *    parcial: placeholder com title — nunca zero e NUNCA a soma de `porItem`,
 *    que nao e total oficial (pedido sem item.id no 1o item fica fora, e
 *    itens 2+ nunca contam). Faturamento continua pelo agregado.
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

// ── Fixture: outubro/2026, todos os pedidos em 20/10 BRT ───────────────────
const DIA = '2026-10-20T12:00:00.000-03:00';
const it = (id, quantity, unit_price) => ({ item: { id, title: id, seller_sku: 'S-' + id }, quantity, unit_price });
const ml = (id, status, paid, items) => ({ id, status, date_created: DIA, paid_amount: paid, total_amount: paid, order_items: items });
const am = (id, status, paid, items) => ({ ...ml(id, status, paid, items), canal: 'amazon' });
const PEDIDOS = [
  ml(1, 'paid', 100, [it('MLB1', 1, 100)]),                         // 1. simples
  ml(2, 'partially_refunded', 30.51, [it('MLB1', 1, 34.29)]),        // 2. venda (dinheiro entrou)
  ml(3, 'cancelled', 0, [it('MLB1', 5, 100)]),                       // 3. fora
  ml(4, 'pending', 0, [it('MLB1', 1, 100)]),                         // 4. ML pending: fora
  am('A1', 'amazon:pending', 60, [it('B0X', 1, 60)]),                // 5. Amazon pending: dentro
  ml(5, 'paid', 250, [it('MLB1', 1, 100), it('MLB2', 3, 50)]),       // 6. multi-item: 1 pedido, 4 un
  ml(6, 'paid', 80, [it('MLB9', 2, 40)]),                            // 7. anuncio hoje PAUSADO
];
const ITENS = [
  { id: 'MLB1', title: 'Vinho A', status: 'active', sold_quantity: 100 },
  { id: 'MLB2', title: 'Vinho B', status: 'active', sold_quantity: 10 },
  { id: 'MLB9', title: 'Vinho C (pausado)', status: 'paused', sold_quantity: 5 },
  { id: 'B0X', title: 'Vinho Amazon', status: 'active', sold_quantity: 1 },
];
// Vendas: 1, 2, A1, 5, 6.
const ESPERADO = { faturamento: 100 + 30.51 + 60 + 250 + 80, pedidos: 5, unidades: 1 + 1 + 1 + 4 + 2 };
const FROM = '2026-10-01', TO = '2026-10-31';

/**
 * Agregado do backend para o periodo, como montarMetrics o devolve (porItem = vendasPorItem: 1o item, paid_amount inteiro).
 * Padrao: backend ANTIGO (publicado hoje), sem os totais. `{ novo: true }`: backend A2b, com `periodo.pedidos` e
 * `periodo.unidades` calculados como calcularMetricas (contaComoVenda, todos os order_items, quantity ?? 1).
 */
function metricsDoBackend(pedidos, fromYmd, toYmd, { novo = false } = {}) {
  const venda = o => o.status === 'paid' || o.status === 'partially_refunded' || (String(o.status).startsWith('amazon:') && o.status !== 'amazon:cancelled');
  const porItem = {}; let bruto = 0;
  for (const o of pedidos) {
    if (!venda(o)) continue;
    bruto += o.paid_amount || o.total_amount || 0;
    const oi = o.order_items[0]; const id = oi?.item?.id; if (!id) continue;
    porItem[id] ??= { itemId: id, pedidos: 0, unidades: 0, receita: 0 };
    porItem[id].pedidos++; porItem[id].unidades += oi.quantity || 1; porItem[id].receita += o.paid_amount || 0;
  }
  const periodo = { fromYmd, toYmd, faturamento: { bruto, tarifaML: -bruto * 0.148, tarifaEnv: -bruto * 0.144, liquido: bruto * 0.708 }, porItem: Object.values(porItem) };
  if (novo) {
    const vendas = pedidos.filter(venda);
    periodo.pedidos = vendas.length;
    periodo.unidades = vendas.reduce((s, o) => s + (o.order_items || []).reduce((u, oi) => u + (oi.quantity ?? 1), 0), 0);
  }
  return { periodo };
}

/** Monta loadPeriodoData + renderKPIsPeriodo REAIS com stubs minimos; devolve o que a Home escreve. */
function montar({ pedidos = PEDIDOS, itens = ITENS, historico = true, metrics = null } = {}) {
  const fonte = [
    'const _AGORA = new Date("2026-10-20T12:00:00.000-03:00");',
    extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'), extrairFuncao('dentroDoPeriodo'),
    'function hojeBRT() { return ymdBRT(_AGORA); }',
    extrairFuncao('gdrDiasEntre'),
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
    'let allOrders = _pedidos, allItems = _itens, _metrics = _metrics0;',
    'let periodoData = [], periodoTotais = null, periodoDateInicio = null, periodoDateFim = null;',
    'function pedidosEmMemoria() { return _hist; }',
    'function selecaoTemFinanceiro() { return true; }',
    'function selecaoLegada() { return true; } function selecaoConsolidada() { return false; }',
    'function selecaoTemAmazon() { return false; } function selecaoTemMercadoLivre() { return true; }',
    'function gdrGet() { return { fromDate: periodoDateInicio, toDate: periodoDateFim }; }',
    // Visitas: 1000 no periodo (API de visitas falsa).
    'const USER_ID = 1; async function mlFetch() { return { results: [{ date: "2026-10-20", total: 1000 }] }; }',
    'async function visitasDaSelecao() { return { results: [] }; }',
    // Publicidade e textos auxiliares: neutros (fora do escopo).
    'let _adsLoadState = "loaded", _periodoLoadState = "loaded";',
    'function publicidadeDoPeriodo() { return { disponivel: false, custo: null, fonte: null, periodoExato: false, parcial: false, motivo: "sem_fonte_confiavel" }; }',
    'function rotuloFontePublicidade() { return ""; } function textoPublicidadeIndisponivel() { return "dados de Ads indisponiveis"; }',
    'const MOD_PLACEHOLDER = "\\u2014", INDISPONIVEL = "indisponivel";',
    'function htmlIndisponivel(m) { return "[indisponivel: " + m + "]"; } function htmlAvisoSelecao(x) { return x; } function escHtml(x) { return String(x); }',
    'function rotuloMetodo() { return ""; } function textoRessalvas() { return ""; } function textoCobertura() { return ""; } function textoFinanceiroAmazon() { return ""; }',
    'const _dom = {}; const document = { getElementById: id => (_dom[id] ??= { textContent: "", innerHTML: "", value: "", style: {}, title: "", setAttribute() {} }) };',
    'const console = { warn() {}, log() {} };',
    extrairFuncao('fontePorItemPeriodo'),
    extrairFuncao('metricsDoPeriodo'), extrairFuncao('agregadoCompleto'),
    extrairFuncao('totaisDoPeriodo'),
    extrairFuncao('ticketMedioExibido'),
    'async ' + extrairFuncao('loadPeriodoData'),
    extrairFuncao('calcLiquidoPeriodo'),
    extrairFuncao('liquidoApurado'),
    extrairFuncao('renderKPIsPeriodo'),
    'return { async run(from, to) { await loadPeriodoData(from, to); renderKPIsPeriodo(); return { dom: _dom, periodoData, totais: periodoTotais }; }, totaisDoPeriodo, ticketMedioExibido };',
  ].join('\n');
  return new Function('_pedidos', '_itens', '_hist', '_metrics0', fonte)(pedidos, itens, historico, metrics);
}

/** "R$ 1.234" -> 1234 (fmt da Home arredonda para inteiro). */
const reais = s => Number(String(s).replace(/[^\d-]/g, ''));
const inteiro = s => Number(String(s).replace(/\./g, ''));

describe('totaisDoPeriodo — populacao unica', () => {
  const m = montar();
  const t = m.totaisDoPeriodo(FROM, TO);

  test('conta cada pedido valido uma vez: simples, partially_refunded, Amazon pending, multi-item e pausado', () => {
    assert.equal(t.disponivel, true);
    assert.equal(t.fonte, 'local');
    assert.equal(t.pedidos, ESPERADO.pedidos);
  });
  test('cancelado e ML pending ficam fora', () => {
    const so = montar({ pedidos: PEDIDOS.filter(o => o.status === 'cancelled' || o.status === 'pending') });
    assert.deepEqual([so.totaisDoPeriodo(FROM, TO).pedidos, so.totaisDoPeriodo(FROM, TO).unidades], [0, 0]);
  });
  test('unidades = soma de quantity de TODOS os order_items (multi-item = 4, nao 1)', () => {
    assert.equal(t.unidades, ESPERADO.unidades);
    const multi = montar({ pedidos: [PEDIDOS[5]] }).totaisDoPeriodo(FROM, TO);
    assert.deepEqual([multi.pedidos, multi.unidades], [1, 4]);
  });
  test('quantity ausente vira 1; quantity 0 permanece 0 (como o sales-metrics do backend)', () => {
    const p = [ml(7, 'paid', 10, [{ item: { id: 'MLB1' }, unit_price: 10 }, { item: { id: 'MLB2' }, quantity: 0, unit_price: 10 }])];
    assert.deepEqual([montar({ pedidos: p }).totaisDoPeriodo(FROM, TO).pedidos, montar({ pedidos: p }).totaisDoPeriodo(FROM, TO).unidades], [1, 1]);
  });
  test('o status atual do anuncio nao apaga a venda: sem o anuncio no catalogo, totais iguais', () => {
    const semCatalogo = montar({ itens: [] }).totaisDoPeriodo(FROM, TO);
    const tudoPausado = montar({ itens: ITENS.map(i => ({ ...i, status: 'paused' })) }).totaisDoPeriodo(FROM, TO);
    assert.deepEqual([semCatalogo.pedidos, semCatalogo.unidades], [ESPERADO.pedidos, ESPERADO.unidades]);
    assert.deepEqual([tudoPausado.pedidos, tudoPausado.unidades], [ESPERADO.pedidos, ESPERADO.unidades]);
  });
  test('respeita o periodo BRT: pedidos fora do intervalo nao entram', () => {
    assert.deepEqual([m.totaisDoPeriodo('2026-09-01', '2026-09-30').pedidos, m.totaisDoPeriodo('2026-10-21', '2026-10-31').pedidos], [0, 0]);
  });
});

describe('Home com historico em memoria', () => {
  test('faturamento, transacoes, unidades e ticket da MESMA populacao; ticket = faturamento / transacoes exibidos', async () => {
    const r = await montar().run(FROM, TO);
    const d = r.dom;
    const fat = reais(d['kpi-faturamento'].textContent);
    const ped = inteiro(d['kpi-transacoes'].textContent);
    assert.equal(fat, Math.round(ESPERADO.faturamento));           // 521
    assert.equal(ped, ESPERADO.pedidos);                            // 5 (antes: 4, o pausado sumia)
    assert.equal(inteiro(d['kpi-unidades'].textContent), ESPERADO.unidades); // 9 (antes: 4, so o 1o item)
    assert.equal(reais(d['kpi-ticket'].textContent), Math.round(ESPERADO.faturamento / ESPERADO.pedidos)); // 104 (antes: 110)
    assert.equal(d['kpi-unidades'].title, '');
  });

  test('anuncio pausado com venda valida entra em faturamento, pedidos, unidades e ticket', async () => {
    const com = (await montar().run(FROM, TO)).dom;
    const sem = (await montar({ pedidos: PEDIDOS.filter(o => o.id !== 6) }).run(FROM, TO)).dom;
    assert.equal(reais(com['kpi-faturamento'].textContent) - reais(sem['kpi-faturamento'].textContent), 80);
    assert.equal(inteiro(com['kpi-transacoes'].textContent) - inteiro(sem['kpi-transacoes'].textContent), 1);
    assert.equal(inteiro(com['kpi-unidades'].textContent) - inteiro(sem['kpi-unidades'].textContent), 2);
    assert.notEqual(com['kpi-ticket'].textContent, sem['kpi-ticket'].textContent);
  });

  test('a Home nao muda os totais por causa do status atual do anuncio', async () => {
    const a = (await montar().run(FROM, TO)).dom;
    const b = (await montar({ itens: ITENS.map(i => ({ ...i, status: i.status === 'paused' ? 'active' : 'paused' })) }).run(FROM, TO)).dom;
    for (const id of ['kpi-faturamento', 'kpi-transacoes', 'kpi-unidades', 'kpi-ticket']) {
      assert.equal(a[id].textContent, b[id].textContent, id);
    }
  });

  test('Receita por Produto (periodoData) preservada: por anuncio ativo, paid_amount inteiro no 1o item, sem duplicar nenhum pedido', async () => {
    const r = await montar().run(FROM, TO);
    const porId = Object.fromEntries(r.periodoData.map(p => [p.id, p]));
    // MLB1 e o 1o item dos pedidos 1, 2 e 5: recebe os tres paid_amount inteiros (inclusive os 250 do multi-item).
    assert.deepEqual([porId.MLB1.vendas, +porId.MLB1.receita.toFixed(2), porId.MLB1.unidades], [3, 380.51, 3]);
    // MLB2 so aparece como 2o item: nenhuma venda atribuida (quirk legado preservado, registrado para etapa futura).
    assert.deepEqual([porId.MLB2.vendas, porId.MLB2.receita], [0, 0]);
    assert.deepEqual([porId.B0X.vendas, porId.B0X.receita], [1, 60]);
    // Anuncio pausado nao entra na visao por produto (comportamento anterior mantido)...
    assert.equal(porId.MLB9, undefined);
    // ...mas cada pedido aparece no maximo uma vez: a soma por produto nunca passa do faturamento total.
    const somaProdutos = r.periodoData.reduce((s, p) => s + p.receita, 0);
    assert.ok(somaProdutos <= ESPERADO.faturamento + 1e-9);
    assert.equal(+somaProdutos.toFixed(2), 440.51); // 520.51 - 80 do pausado
  });

  test('conversao continua vendas de anuncios ativos (1o item) / visitas do ML — nao usa os totais', async () => {
    const r = await montar().run(FROM, TO);
    const vendasAtivos = r.periodoData.reduce((s, p) => s + p.vendas, 0); // 4
    assert.equal(r.dom['kpi-conversao'].textContent, (vendasAtivos / 1000 * 100).toFixed(1) + '%');
    assert.notEqual(vendasAtivos, ESPERADO.pedidos);
  });
});

describe('Home sem historico + backend ANTIGO (sem periodo.pedidos/unidades)', () => {
  const PH = '\u2014';

  test('faturamento aparece pelo agregado; transacoes, unidades e ticket ficam em placeholder com title — nunca numero parcial', async () => {
    const r = await montar({ historico: false, metrics: metricsDoBackend(PEDIDOS, FROM, TO) }).run(FROM, TO);
    const d = r.dom;
    assert.equal(reais(d['kpi-faturamento'].textContent), Math.round(ESPERADO.faturamento));
    for (const id of ['kpi-transacoes', 'kpi-unidades', 'kpi-ticket']) {
      assert.equal(d[id].textContent, PH, id);
      assert.match(d[id].title, /aguarda dados completos/, id);
    }
    assert.deepEqual([r.totais.disponivel, r.totais.motivo], [false, 'aguarda_historico']);
    // Em especial: nem os 5 "pedidos" nem as 6 "unidades" que Σ porItem daria aparecem.
    assert.notEqual(d['kpi-unidades'].textContent, '6');
    assert.notEqual(d['kpi-transacoes'].textContent, '5');
  });

  test('por que Σ porItem.pedidos NAO e total oficial: pedido sem item.id no 1o item some da soma, mas esta no faturamento', async () => {
    const semId = ml(8, 'paid', 40, [{ item: { id: null, title: 'sem id' }, quantity: 1, unit_price: 40 }, it('MLB2', 1, 0)]);
    const pedidos = [...PEDIDOS, semId];
    const mb = metricsDoBackend(pedidos, FROM, TO);
    const somaPorItem = mb.periodo.porItem.reduce((s, l) => s + l.pedidos, 0);
    const somaUnidades = mb.periodo.porItem.reduce((s, l) => s + l.unidades, 0);
    // Total real (historico local, mesma regra do contrato): 6 pedidos, 11 unidades.
    const real = montar({ pedidos }).totaisDoPeriodo(FROM, TO);
    assert.deepEqual([real.pedidos, real.unidades], [6, 11]);
    // O agregado por item perde o pedido inteiro e os itens 2+: 5 pedidos, 6 unidades.
    assert.deepEqual([somaPorItem, somaUnidades], [5, 6]);
    // ...enquanto o faturamento do agregado conta o pedido normalmente.
    assert.equal(+mb.periodo.faturamento.bruto.toFixed(2), +(ESPERADO.faturamento + 40).toFixed(2));
    // Logo, a Home sem historico nao exibe nenhum dos dois.
    const d = (await montar({ pedidos, historico: false, metrics: mb }).run(FROM, TO)).dom;
    assert.deepEqual(['kpi-transacoes', 'kpi-unidades', 'kpi-ticket'].map(id => d[id].textContent), [PH, PH, PH]);
  });

  test('sem agregado do periodo exato: faturamento tambem em placeholder; os tres totais nunca zero', async () => {
    const outro = metricsDoBackend(PEDIDOS, '2026-09-01', '2026-09-30');
    const d = (await montar({ historico: false, metrics: outro }).run(FROM, TO)).dom;
    for (const id of ['kpi-faturamento', 'kpi-transacoes', 'kpi-unidades', 'kpi-ticket']) assert.equal(d[id].textContent, PH, id);
  });

  test('com historico os titles ficam vazios (nada a declarar)', async () => {
    const d = (await montar().run(FROM, TO)).dom;
    for (const id of ['kpi-transacoes', 'kpi-unidades', 'kpi-ticket']) assert.equal(d[id].title, '', id);
  });
});

describe('Home sem historico + backend NOVO (FASE A2c: periodo.pedidos/unidades)', () => {
  const PH = '\u2014';
  const novo = (pedidos = PEDIDOS) => metricsDoBackend(pedidos, FROM, TO, { novo: true });

  test('cards exibem 5 / 9 / ticket = faturamento exibido / periodo.pedidos', async () => {
    const mb = novo();
    assert.deepEqual([mb.periodo.pedidos, mb.periodo.unidades], [5, 9]);
    const r = await montar({ historico: false, metrics: mb }).run(FROM, TO);
    const d = r.dom;
    assert.equal(r.totais.fonte, 'agregado');
    const fat = reais(d['kpi-faturamento'].textContent);
    assert.equal(fat, Math.round(ESPERADO.faturamento));
    assert.equal(inteiro(d['kpi-transacoes'].textContent), 5);
    assert.equal(inteiro(d['kpi-unidades'].textContent), 9);
    assert.equal(reais(d['kpi-ticket'].textContent), Math.round(ESPERADO.faturamento / 5));
    for (const id of ['kpi-transacoes', 'kpi-unidades', 'kpi-ticket']) assert.equal(d[id].title, '', id);
  });

  test('mesmos numeros que o calculo local com historico (as duas fontes concordam)', async () => {
    const local = (await montar().run(FROM, TO)).dom;
    const boot = (await montar({ historico: false, metrics: novo() }).run(FROM, TO)).dom;
    for (const id of ['kpi-faturamento', 'kpi-transacoes', 'kpi-unidades', 'kpi-ticket']) {
      assert.equal(boot[id].textContent, local[id].textContent, id);
    }
  });

  test('porItem com numeros diferentes: os campos novos vencem — porItem nao voltou a ser usado', async () => {
    const mb = novo();
    // Σ porItem daria 5 pedidos e 6 unidades; aqui vira lixo proposital.
    mb.periodo.porItem = mb.periodo.porItem.map(l => ({ ...l, pedidos: 777, unidades: 888 }));
    const d = (await montar({ historico: false, metrics: mb }).run(FROM, TO)).dom;
    assert.equal(inteiro(d['kpi-transacoes'].textContent), 5);
    assert.equal(inteiro(d['kpi-unidades'].textContent), 9);
    // E sem os campos novos, o mesmo porItem adulterado tambem nao aparece.
    const antigo = metricsDoBackend(PEDIDOS, FROM, TO);
    antigo.periodo.porItem = antigo.periodo.porItem.map(l => ({ ...l, pedidos: 777, unidades: 888 }));
    const d2 = (await montar({ historico: false, metrics: antigo }).run(FROM, TO)).dom;
    assert.deepEqual(['kpi-transacoes', 'kpi-unidades', 'kpi-ticket'].map(id => d2[id].textContent), [PH, PH, PH]);
  });

  test('pedidos = 0 e unidades = 0 sao dado valido: exibe 0, nao placeholder', async () => {
    const mb = metricsDoBackend([], FROM, TO, { novo: true });
    assert.deepEqual([mb.periodo.pedidos, mb.periodo.unidades], [0, 0]);
    const r = await montar({ pedidos: [], historico: false, metrics: mb }).run(FROM, TO);
    assert.equal(r.totais.disponivel, true);
    assert.deepEqual([r.totais.pedidos, r.totais.unidades], [0, 0]);
    assert.equal(r.dom['kpi-transacoes'].textContent, '0');
    assert.equal(r.dom['kpi-unidades'].textContent, '0');
    // Ticket com zero pedidos: comportamento seguro de sempre (ticketMedioExibido -> 0), sem divisao por zero.
    assert.equal(reais(r.dom['kpi-ticket'].textContent), 0);
  });

  test('apenas um dos dois campos presente: contrato parcial nao e aceito — os tres KPIs indisponiveis', async () => {
    for (const falta of ['pedidos', 'unidades']) {
      const mb = novo();
      delete mb.periodo[falta];
      const r = await montar({ historico: false, metrics: mb }).run(FROM, TO);
      assert.equal(r.totais.disponivel, false, 'sem ' + falta);
      assert.deepEqual(['kpi-transacoes', 'kpi-unidades', 'kpi-ticket'].map(id => r.dom[id].textContent), [PH, PH, PH], 'sem ' + falta);
    }
  });

  test('valores invalidos (null, negativo, fracionario, string) contam como ausentes', async () => {
    for (const ruim of [null, -1, 2.5, '5']) {
      const mb = novo();
      mb.periodo.pedidos = ruim;
      const r = await montar({ historico: false, metrics: mb }).run(FROM, TO);
      assert.equal(r.dom['kpi-transacoes'].textContent, PH, String(ruim));
    }
  });

  test('agregado de OUTRO periodo nao vale, mesmo com os campos novos', async () => {
    const outro = metricsDoBackend(PEDIDOS, '2026-09-01', '2026-09-30', { novo: true });
    const d = (await montar({ historico: false, metrics: outro }).run(FROM, TO)).dom;
    for (const id of ['kpi-faturamento', 'kpi-transacoes', 'kpi-unidades', 'kpi-ticket']) assert.equal(d[id].textContent, PH, id);
  });

  test('com historico em memoria e agregado COMPLETO, o agregado e a fonte unica do bloco (revisao da A3)', async () => {
    // Snapshot do backend mais novo que a memoria: o bloco inteiro segue o agregado, sem misturar com o local.
    const mb = novo();
    mb.periodo.pedidos = 123; mb.periodo.unidades = 456; mb.periodo.faturamento.bruto = 12300;
    const r = await montar({ historico: true, metrics: mb }).run(FROM, TO);
    assert.equal(r.totais.fonte, 'agregado');
    assert.deepEqual([r.totais.pedidos, r.totais.unidades], [123, 456]);
    assert.equal(reais(r.dom['kpi-faturamento'].textContent), 12300);
    assert.equal(reais(r.dom['kpi-ticket'].textContent), 100);
  });

  test('com historico e backend ANTIGO (sem pedidos/unidades), o bloco inteiro fica local', async () => {
    const r = await montar({ historico: true, metrics: metricsDoBackend(PEDIDOS, FROM, TO) }).run(FROM, TO);
    assert.equal(r.totais.fonte, 'local');
    assert.deepEqual([r.totais.pedidos, r.totais.unidades], [5, 9]);
  });

  test('contrato de codigo: totaisDoPeriodo nao le porItem', () => {
    assert.doesNotMatch(extrairFuncao('totaisDoPeriodo'), /porItem/);
  });

  test('Receita por Produto, Qualidade e Conversao continuam saindo de porItem/periodoData, como antes', async () => {
    const antigo = await montar({ historico: false, metrics: metricsDoBackend(PEDIDOS, FROM, TO) }).run(FROM, TO);
    const comNovo = await montar({ historico: false, metrics: novo() }).run(FROM, TO);
    assert.deepEqual(comNovo.periodoData, antigo.periodoData);
    assert.equal(comNovo.dom['kpi-conversao'].textContent, antigo.dom['kpi-conversao'].textContent);
    assert.equal(comNovo.dom['kpi-visitas'].textContent, antigo.dom['kpi-visitas'].textContent);
  });
});

describe('contrato de codigo', () => {
  test('ticket exibido deriva do mesmo valor escrito em kpi-faturamento', () => {
    const f = extrairFuncao('renderKPIsPeriodo');
    assert.match(f, /const fatExibido = bruto;/);
    assert.doesNotMatch(f, /const fatExibido = bruto \|\|/);
    assert.match(f, /const ticketMedio = ticketMedioExibido\(fatExibido, totalTransacoes \|\| 0\);/);
    assert.equal((f.match(/getElementById\('kpi-faturamento'\)\.textContent = fmt\(fatExibido\)/g) || []).length, 2);
    assert.doesNotMatch(f, /getElementById\('kpi-faturamento'\)\.textContent = fmt\(bruto \|\| totalFaturamento\)/);
  });
  test('transacoes e unidades nao somam mais periodoData', () => {
    const f = extrairFuncao('renderKPIsPeriodo');
    assert.doesNotMatch(f, /totalTransacoes = periodoData\.reduce/);
    assert.doesNotMatch(f, /totalUnidades = periodoData\.reduce/);
  });
  test('ticketMedioExibido: zero pedidos nao divide por zero', () => {
    const m = montar();
    assert.equal(m.ticketMedioExibido(100, 0), 0);
    assert.equal(m.ticketMedioExibido(100, 4), 25);
  });
});

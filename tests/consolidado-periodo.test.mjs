/**
 * Aba Consolidado — vendas e pedidos respeitam o PERIODO GLOBAL.
 *
 * Travado aqui:
 *  - Vendas Total, Pedidos e Preco Medio Vendido sao do periodo do filtro
 *    global (gdrGet), com o mesmo criterio de data e de status das abas
 *    Pedidos e Analise de Preco (dentroDoPeriodo + pedidoPago, que desde a
 *    FASE A1 e a regra unica contaComoVenda: paid e partially_refunded);
 *  - Produto, Anuncios, Estoque Total e Preco Medio NAO mudam com o periodo;
 *  - pedido conta uma vez por produto; todos os itens do pedido entram;
 *  - sem venda no periodo: 0 unidades, 0 pedidos e preco medio vendido nulo;
 *  - trocar o periodo re-renderiza a aba aberta.
 *
 * Rodar: node --test tests/*.test.mjs
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
  const achado = html.indexOf(marca);
  assert.notEqual(achado, -1, 'funcao ' + nome + ' nao encontrada em index.html');
  const i = html.indexOf('{', achado);
  let nivel = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (nivel === 0) return html.slice(achado, j + 1); }
  }
  throw new Error('funcao ' + nome + ' nao fecha');
}
function extrairConstante(nome) {
  const m = html.match(new RegExp('const ' + nome + ' = ([^;]+);'));
  assert.ok(m, 'constante ' + nome + ' nao encontrada');
  return m[0];
}

const HOJE = '2026-10-22';

/** Sandbox: filtro global REAL + regras de status REAIS + buildConsolidado REAL. */
function montar({ preset = 'mes_atual', de, ate, itens, pedidos }) {
  const fonte = [
    'let currentPeriodoDias = 7;',
    'function brtStartOfDay(ymd) { if (!ymd) return null; return new Date(ymd + "T00:00:00.000-03:00"); }',
    'function brtEndOfDay(ymd) { if (!ymd) return null; return new Date(ymd + "T23:59:59.999-03:00"); }',
    'function ymdBRT(date) { const d = (date instanceof Date) ? date : new Date(date); return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); }',
    'function hojeBRT() { return _hoje; }',
    extrairConstante('MESES_GDR'),
    extrairConstante('globalDateRange'),
    extrairConstante('GDR_PRESETS_DIA'),
    extrairFuncao('gdrPrecisaVirar'),
    extrairFuncao('gdrUltimoDia'), extrairFuncao('gdrYmd'), extrairFuncao('gdrDiasEntre'),
    extrairFuncao('gdrCalcularRange'), extrairFuncao('gdrRotulo'), extrairFuncao('gdrGet'),
    extrairFuncao('dentroDoPeriodo'),
    extrairFuncao('contaComoVenda'), extrairFuncao('contaComoVendaAmazon'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'),
    // Estoque e SKU: stubs simples (as regras deles tem testes proprios).
    'function itemSKU(i) { return i.sku; }',
    'function estoqueDoGrupo(items) { return { confirmado: true, valor: items.reduce((s, i) => s + (i.available_quantity || 0), 0), porAnuncio: [] }; }',
    'let allItems = _itens; let allOrders = _pedidos;',
    extrairFuncao('consVendasDoPeriodo'),
    extrairFuncao('buildConsolidado'),
    'const r = gdrCalcularRange(_preset, _hoje, _de, _ate); globalDateRange.preset = _preset; globalDateRange.from = r.from; globalDateRange.to = r.to;',
    'return { buildConsolidado, consVendasDoPeriodo, gdrGet, porSku: () => Object.fromEntries(buildConsolidado().map(d => [d.sku, d])) };',
  ].join('\n');
  return new Function('_hoje', '_preset', '_de', '_ate', '_itens', '_pedidos', fonte)(HOJE, preset, de, ate, itens, pedidos);
}

// Catalogo: o produto A tem DOIS anuncios (agrupados); B tem um; C nunca vendeu.
const ITENS = [
  { id: 'MLB1', sku: 'A', title: 'Vinho A 750ml', status: 'active', price: 100, available_quantity: 5, sold_quantity: 900 },
  { id: 'MLB2', sku: 'A', title: 'Vinho A 750ml kit', status: 'active', price: 120, available_quantity: 3, sold_quantity: 400 },
  { id: 'MLB3', sku: 'B', title: 'Vinho B', status: 'active', price: 80, available_quantity: 10, sold_quantity: 50 },
  { id: 'MLB4', sku: 'C', title: 'Vinho C', status: 'paused', price: 60, available_quantity: 2, sold_quantity: 7 },
];
const it = (id, quantity, unit_price) => ({ item: { id, title: id }, quantity, unit_price });
const ped = (id, date_created, status, order_items, extra = {}) =>
  ({ id, date_created, status, order_items, paid_amount: 9999, total_amount: 9999, ...extra });
const PEDIDOS = [
  // Outubro (mes atual)
  ped(1, '2026-10-21T10:00:00.000-03:00', 'paid', [it('MLB1', 2, 90)]),                    // A: 2 un a 90 (com desconto)
  ped(2, '2026-10-20T23:30:00.000-03:00', 'paid', [it('MLB1', 1, 100), it('MLB2', 1, 120)]),// A: mesmo pedido, 2 anuncios -> 1 pedido
  ped(3, '2026-10-02T09:00:00.000-03:00', 'paid', [it('MLB3', 3, 80), it('MLB1', 1, 100)]), // B e A no mesmo carrinho
  ped(4, '2026-10-19T12:00:00.000-03:00', 'cancelled', [it('MLB1', 5, 100)]),              // cancelado: fora
  ped(5, '2026-10-18T12:00:00.000-03:00', 'partially_refunded', [it('MLB3', 1, 80)]),      // venda (FASE A1): o dinheiro entrou
  // Virada de mes em horario de Brasilia: 30/09 23:30 BRT (02:30Z de 01/10) fica em setembro.
  ped(6, '2026-10-01T00:30:00.000-03:00', 'paid', [it('MLB3', 1, 70)]),
  ped(7, '2026-09-30T23:30:00.000-03:00', 'paid', [it('MLB3', 1, 75)]),
  // Antigos
  ped(8, '2026-03-10T10:00:00.000-03:00', 'paid', [it('MLB1', 4, 95)]),
  // Anuncio fora do catalogo atual: nao vira produto novo nem soma em outro
  ped(9, '2026-10-10T10:00:00.000-03:00', 'paid', [it('MLB999', 1, 50)]),
];

describe('mes atual (outubro/2026)', () => {
  const c = montar({ itens: ITENS, pedidos: PEDIDOS }).porSku();

  test('A: 2 anuncios agrupados; 5 un em 3 pedidos; pedido com dois anuncios do mesmo produto conta uma vez', () => {
    assert.equal(c.A.anuncios, 2);
    assert.equal(c.A.vendasTotal, 2 + 1 + 1 + 1);
    assert.equal(c.A.pedidosCnt, 3);
  });

  test('preco medio vendido = media ponderada de unit_price por unidade (desconto incluso, frete e paid_amount fora)', () => {
    // (2x90 + 100 + 120 + 100) / 5 = 100
    assert.equal(c.A.precoMedioVendido, 100);
    // B: 3x80 + 1x80 (partially_refunded) + 1x70 = 390 / 5
    assert.equal(c.B.vendasTotal, 5);
    assert.equal(c.B.pedidosCnt, 3);
    assert.equal(c.B.precoMedioVendido, 390 / 5);
  });

  test('cancelado nao entra; partially_refunded entra (regra unica de venda, FASE A1)', () => {
    assert.equal(c.A.vendasTotal, 5); // o cancelado de 5 un nao somou
    assert.equal(c.B.vendasTotal, 5); // o partially_refunded de 1 un somou
  });

  test('virada de mes em horario de Brasilia: 30/09 23:30 fica fora de outubro', () => {
    assert.equal(c.B.vendasTotal, 5); // 3 + 1 + 1 de outubro; o de 30/09 nao
  });

  test('sem venda no periodo: zero unidades, zero pedidos e preco medio vendido nulo (nunca inventado)', () => {
    assert.equal(c.C.vendasTotal, 0);
    assert.equal(c.C.pedidosCnt, 0);
    assert.equal(c.C.precoMedioVendido, null);
  });

  test('estoque, anuncios e preco medio NAO dependem do periodo', () => {
    assert.equal(c.A.estTotal, 8);
    assert.equal(c.A.precoMedio, 110);
    assert.equal(c.C.precoMedio, 0); // pausado: regra antiga (so ativos)
  });

  test('anuncio fora do catalogo atual nao cria produto nem soma em outro', () => {
    assert.deepEqual(Object.keys(c).sort(), ['A', 'B', 'C']);
  });
});

describe('outros periodos', () => {
  test('ultimos 7 dias (16 a 22/10, personalizado): pedidos 1 e 2 (A) e o partially_refunded 5 (B)', () => {
    const c = montar({ preset: 'custom', de: '2026-10-16', ate: '2026-10-22', itens: ITENS, pedidos: PEDIDOS }).porSku();
    assert.deepEqual([c.A.vendasTotal, c.A.pedidosCnt, c.B.vendasTotal, c.B.pedidosCnt], [4, 2, 1, 1]);
    assert.equal(c.A.precoMedioVendido, (180 + 100 + 120) / 4);
    assert.equal(c.B.precoMedioVendido, 80);
  });

  test('historico inteiro (personalizado desde 2020): todos os pagos, ainda sem cancelados', () => {
    const c = montar({ preset: 'custom', de: '2020-01-01', ate: HOJE, itens: ITENS, pedidos: PEDIDOS }).porSku();
    assert.deepEqual([c.A.vendasTotal, c.A.pedidosCnt], [9, 4]);
    assert.deepEqual([c.B.vendasTotal, c.B.pedidosCnt], [6, 4]);
    // Nunca o sold_quantity do anuncio (900 + 400 de vida inteira)
    assert.notEqual(c.A.vendasTotal, 1300);
  });

  test('setembro/2026: so o pedido de 30/09 23:30 BRT', () => {
    const c = montar({ preset: 'mes:2026-09', itens: ITENS, pedidos: PEDIDOS }).porSku();
    assert.deepEqual([c.B.vendasTotal, c.B.pedidosCnt, c.B.precoMedioVendido], [1, 1, 75]);
    assert.deepEqual([c.A.vendasTotal, c.A.pedidosCnt, c.A.precoMedioVendido], [0, 0, null]);
  });

  test('periodo sem vendas (agosto/2026): tudo zero, nenhum preco vendido, estoque intacto', () => {
    const c = montar({ preset: 'mes:2026-08', itens: ITENS, pedidos: PEDIDOS }).porSku();
    for (const k of ['A', 'B', 'C']) {
      assert.equal(c[k].vendasTotal, 0, k);
      assert.equal(c[k].pedidosCnt, 0, k);
      assert.equal(c[k].precoMedioVendido, null, k);
    }
    assert.equal(c.A.estTotal, 8);
  });

  test('ultimos 3 meses (preset existente)', () => {
    const c = montar({ preset: 'ultimos:3', itens: ITENS, pedidos: PEDIDOS }).porSku();
    assert.deepEqual([c.A.vendasTotal, c.B.vendasTotal], [5, 6]);
  });
});

describe('consistencia com a aba Pedidos no mesmo periodo', () => {
  test('soma de pedidos por produto = vendas do periodo (paid + partially_refunded) que tem item do produto', () => {
    const m = montar({ itens: ITENS, pedidos: PEDIDOS });
    const g = m.gdrGet();
    // Mesmo filtro de getFilteredOrders (aba Pedidos) + card "pagos".
    const pagos = PEDIDOS.filter(o => ['paid', 'partially_refunded'].includes(o.status) && new Date(o.date_created) >= g.fromDate && new Date(o.date_created) <= g.toDate);
    const comA = pagos.filter(o => o.order_items.some(oi => ['MLB1', 'MLB2'].includes(oi.item.id))).length;
    const comB = pagos.filter(o => o.order_items.some(oi => oi.item.id === 'MLB3')).length;
    const c = m.porSku();
    assert.deepEqual([c.A.pedidosCnt, c.B.pedidosCnt], [comA, comB]);
  });

  test('Amazon segue a regra propria de venda (pendente conta, cancelado nao)', () => {
    const am = [
      ped('A1', '2026-10-10T10:00:00.000-03:00', 'amazon:pending', [it('MLB3', 1, 80)], { canal: 'amazon' }),
      ped('A2', '2026-10-10T10:00:00.000-03:00', 'amazon:cancelled', [it('MLB3', 1, 80)], { canal: 'amazon' }),
    ];
    const c = montar({ itens: ITENS, pedidos: am }).porSku();
    assert.deepEqual([c.B.vendasTotal, c.B.pedidosCnt], [1, 1]);
  });
});

describe('integracao com a tela', () => {
  test('trocar o periodo re-renderiza a aba Consolidado aberta', () => {
    assert.match(extrairFuncao('gdrRerenderAbaAtiva'), /aba === 'consolidado'\) \{ consPage = 1; renderConsolidado\(\); \}/);
  });

  test('sem historico em memoria, vendas/pedidos aparecem como carregando, nunca 0', () => {
    const r = extrairFuncao('renderConsolidado');
    assert.match(r, /const historico = pedidosEmMemoria\(\);/);
    assert.match(r, /historico \? d\.vendasTotal/);
    assert.match(r, /historico \? d\.pedidosCnt/);
  });

  test('buildConsolidado le o periodo do filtro global, sem segunda logica de datas', () => {
    const b = extrairFuncao('buildConsolidado');
    assert.match(b, /gdrGet\(\)/);
    assert.doesNotMatch(b, /sold_quantity|new Date\(|setDate/);
    assert.match(extrairFuncao('consVendasDoPeriodo'), /dentroDoPeriodo\(o\.date_created, inicio, fim\)/);
  });
});

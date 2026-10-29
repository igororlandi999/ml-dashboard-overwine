/**
 * FASE A1 — regra UNICA de venda no frontend.
 *
 * Travado aqui:
 *  - `contaComoVenda` espelha src/lib/status-venda.ts do backend:
 *      ML: paid e partially_refunded contam; cancelled, pending e qualquer
 *      status fora da lista nao contam (lista de PERMISSAO);
 *      Amazon: todo `amazon:*` conta, exceto `amazon:cancelled`;
 *  - `pedidoPago` e `pedidoForaDaVenda` sao a MESMA pergunta e delegam a
 *    `contaComoVenda` em todos os canais (antes, no ML, eram `=== 'paid'` e
 *    `=== 'cancelled'`: tres populacoes sob o nome "venda");
 *  - Home (bruto de calcLiquidoPeriodo), Pedidos (KPIs locais), Previsao
 *    (pvGroupByDay) e Consolidado (consVendasDoPeriodo) tomam a MESMA decisao
 *    para o MESMO pedido — o partially_refunded entra em todas, o pendente e o
 *    cancelado ficam fora de todas;
 *  - o que NAO e venda nao passa por aqui: cancelamento (pedidoCancelado), o
 *    filtro "Pagos" da tabela (igualdade estrita) e os badges de status.
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

// ── Pedidos de teste: um de cada status relevante, todos em 20/10/2026 BRT ──
const DIA = '2026-10-20T12:00:00.000-03:00';
const it = (id, quantity, unit_price) => ({ item: { id, title: id, seller_sku: 'S-' + id }, quantity, unit_price });
const ml = (id, status, paid, items) => ({ id, status, date_created: DIA, paid_amount: paid, total_amount: paid, order_items: items });
const am = (id, status, paid, items) => ({ ...ml(id, status, paid, items), canal: 'amazon' });
const PEDIDOS = [
  ml(1, 'paid', 100, [it('MLB1', 1, 100)]),
  ml(2, 'partially_refunded', 30.51, [it('MLB1', 1, 34.29)]),  // paid_amount ja liquido do estorno
  ml(3, 'cancelled', 0, [it('MLB1', 5, 100)]),
  ml(4, 'pending', 0, [it('MLB1', 1, 100)]),                   // nao ocorre hoje na base; se ocorrer, fora
  am('A1', 'amazon:pending', 60, [it('B0X', 1, 60)]),
  am('A2', 'amazon:shipped', 120, [it('B0X', 2, 60)]),
  am('A3', 'amazon:cancelled', 0, [it('B0X', 1, 60)]),
];
// Vendas esperadas pela regra oficial: 1, 2, A1, A2.
const ESPERADO = { faturamento: 100 + 30.51 + 60 + 120, pedidos: 4, unidades: 1 + 1 + 1 + 2 };

function montarStatus() {
  const fonte = [
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
    extrairFuncao('filtroStatusPedido'),
    'return { contaComoVenda, pedidoPago, pedidoForaDaVenda, pedidoCancelado, filtroStatusPedido };',
  ].join('\n');
  return new Function(fonte)();
}

describe('contaComoVenda espelha status-venda.ts', () => {
  const m = montarStatus();
  test('ML paid conta', () => assert.equal(m.contaComoVenda('paid'), true));
  test('ML partially_refunded conta', () => assert.equal(m.contaComoVenda('partially_refunded'), true));
  test('ML cancelled nao conta', () => assert.equal(m.contaComoVenda('cancelled'), false));
  test('ML pending (se ocorrer) nao conta — lista de permissao', () => {
    for (const s of ['pending', 'payment_required', 'confirmed', 'payment_in_process', 'invalid', 'xpto', '', null, undefined]) {
      assert.equal(m.contaComoVenda(s), false, String(s));
    }
  });
  test('Amazon amazon:pending conta', () => assert.equal(m.contaComoVenda('amazon:pending'), true));
  test('Amazon aprovado conta (unshipped, partially_shipped, shipped)', () => {
    for (const s of ['amazon:unshipped', 'amazon:partially_shipped', 'amazon:shipped']) assert.equal(m.contaComoVenda(s), true, s);
  });
  test('Amazon amazon:cancelled nao conta', () => assert.equal(m.contaComoVenda('amazon:cancelled'), false));
});

describe('pedidoPago e pedidoForaDaVenda delegam a contaComoVenda em todos os canais', () => {
  const m = montarStatus();
  test('para todo pedido, pedidoPago === contaComoVenda(status) e pedidoForaDaVenda === !pedidoPago', () => {
    for (const o of PEDIDOS) {
      assert.equal(m.pedidoPago(o), m.contaComoVenda(o.status), 'pedidoPago ' + o.id);
      assert.equal(m.pedidoForaDaVenda(o), !m.pedidoPago(o), 'pedidoForaDaVenda ' + o.id);
    }
    // Pedido ML sem campo `canal` (Overwine sozinha) e pedido ausente.
    assert.equal(m.pedidoPago({ status: 'partially_refunded' }), true);
    assert.equal(m.pedidoPago(null), false);
    assert.equal(m.pedidoForaDaVenda(null), true);
  });
  test('cancelamento continua sendo pergunta separada: pendente nao e cancelado', () => {
    assert.equal(m.pedidoCancelado(PEDIDOS[3]), false); // pending: fora da venda, mas nao cancelado
    assert.equal(m.pedidoCancelado(PEDIDOS[2]), true);
    assert.equal(m.pedidoCancelado(PEDIDOS[6]), true);
    assert.equal(m.pedidoCancelado(PEDIDOS[4]), false);
  });
  test('filtro "Pagos" da tabela (exibicao) segue a igualdade estrita no ML', () => {
    assert.equal(m.filtroStatusPedido(PEDIDOS[0], 'paid'), true);
    assert.equal(m.filtroStatusPedido(PEDIDOS[1], 'paid'), false); // partially_refunded aparece so em "Todos"
    assert.equal(m.filtroStatusPedido(PEDIDOS[4], 'paid'), true);  // Amazon: pelos auxiliares
  });
});

// ── Mesma populacao em Home, Pedidos, Previsao e Consolidado ───────────────
function montarAreas() {
  const fonte = [
    // Relogio fixo em 20/10/2026 12:00 BRT, para hoje/7d/mes conterem o DIA.
    'const _AGORA = new Date("2026-10-20T12:00:00.000-03:00"); Date.now = () => _AGORA.getTime();',
    extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'),
    extrairFuncao('dentroDoPeriodo'),
    'function hojeBRT() { return ymdBRT(_AGORA); }',
    extrairFuncao('gdrDiasEntre'),
    extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
    // Estado minimo das areas.
    'let allOrders = _pedidos;',
    'let periodoDateInicio = brtStartOfDay("2026-10-01"), periodoDateFim = brtEndOfDay("2026-10-31");',
    'function pedidosEmMemoria() { return true; }',
    'function selecaoTemFinanceiro() { return true; }',
    'let _metrics = null;',
    'function gdrGet() { return { fromDate: periodoDateInicio, toDate: periodoDateFim }; }',
    // DOM falso: so o que renderPedidosKPIsLocal escreve.
    'const _dom = {}; const document = { getElementById: id => (_dom[id] ??= { textContent: "" }) };',
    extrairFuncao('metricsDoPeriodo'), extrairFuncao('agregadoCompleto'),
    extrairFuncao('calcLiquidoPeriodo'),
    extrairFuncao('renderPedidosKPIsLocal'),
    extrairFuncao('pvGroupByDay'),
    extrairFuncao('consVendasDoPeriodo'),
    'return { calcLiquidoPeriodo, renderPedidosKPIsLocal, pvGroupByDay, consVendasDoPeriodo, dom: _dom };',
  ].join('\n');
  return new Function('_pedidos', fonte)(PEDIDOS);
}

describe('o mesmo pedido recebe a mesma decisao em todas as areas locais', () => {
  const a = montarAreas();
  const numero = s => Number(String(s).replace(/[^\d]/g, ''));

  test('Home: bruto do periodo = soma das vendas (partially_refunded entra; pending e cancelados nao)', () => {
    assert.equal(a.calcLiquidoPeriodo().bruto, ESPERADO.faturamento);
  });

  test('Pedidos: hoje, 7 dias e mes contam as mesmas 4 vendas (cancelados: definicao unica da FASE A5)', () => {
    a.renderPedidosKPIsLocal();
    const d = a.dom;
    assert.equal(numero(d['ord-hoje-cnt'].textContent), ESPERADO.pedidos);
    assert.equal(numero(d['ord-sem-cnt'].textContent), ESPERADO.pedidos);
    assert.equal(numero(d['ord-mes-cnt'].textContent), ESPERADO.pedidos);
    // fmt arredonda para inteiro: 310,51 -> 311
    assert.equal(numero(d['ord-hoje-val'].textContent), Math.round(ESPERADO.faturamento));
    assert.equal(numero(d['ord-ticket'].textContent), Math.round(ESPERADO.faturamento / ESPERADO.pedidos));
    // FASE A5: o contador de cancelados nao sai mais do calculo local (o snapshot
    // nao garante os cancelados do ML); vem de cancelamentoOperacional.
    assert.equal(d['ord-cancel'], undefined);
  });

  test('Previsao: o dia do periodo soma as mesmas vendas', () => {
    const porDia = a.pvGroupByDay('2026-10-01', '2026-10-31');
    const total = Object.values(porDia).reduce((s, v) => s + v, 0);
    assert.equal(+total.toFixed(2), ESPERADO.faturamento);
  });

  test('Consolidado: unidades e pedidos por SKU seguem a mesma regra', () => {
    const skuDoItem = { MLB1: 'ML', B0X: 'AMZ' }; // item_id -> sku
    const c = a.consVendasDoPeriodo(PEDIDOS, skuDoItem, periodo().ini, periodo().fim);
    assert.equal(c.ML.unidades, 2);      // pedidos 1 e 2; o cancelado (5 un) e o pendente ficam fora
    assert.equal(c.ML.pedidos.size, 2);
    assert.equal(c.AMZ.unidades, 3);     // A1 (1) + A2 (2); A3 cancelado fora
    assert.equal(c.AMZ.pedidos.size, 2);
    assert.equal(c.ML.unidades + c.AMZ.unidades, ESPERADO.unidades);
    assert.equal(c.ML.pedidos.size + c.AMZ.pedidos.size, ESPERADO.pedidos);
  });

  function periodo() {
    return { ini: new Date('2026-10-01T00:00:00.000-03:00'), fim: new Date('2026-10-31T23:59:59.999-03:00') };
  }
});

describe('contrato de codigo: nenhuma comparacao solta de venda sobrou nos somadores', () => {
  test('pedidoPago e pedidoForaDaVenda nao comparam status com string', () => {
    assert.doesNotMatch(extrairFuncao('pedidoPago'), /=== 'paid'/);
    assert.doesNotMatch(extrairFuncao('pedidoForaDaVenda'), /=== 'cancelled'/);
    assert.match(extrairFuncao('pedidoPago'), /contaComoVenda\(o\.status\)/);
  });
  test('Entregas acompanha envios: exclui so o cancelado, nao usa a regra de venda', () => {
    const f = extrairFuncao('getEntregasData');
    assert.match(f, /\.filter\(o => !pedidoCancelado\(o\)\)/);
    // So no comentario explicativo; nenhum uso como filtro.
    assert.doesNotMatch(f, /!pedidoForaDaVenda\(o\)|pedidoPago\(o\)/);
  });
});

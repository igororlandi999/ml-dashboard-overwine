/**
 * Leitura da Amazon nas telas existentes: status por canal (o Mercado Livre
 * continua com a comparação de sempre), FBA × Easy Ship × envio próprio,
 * estoque FBA separado do próprio, proxy do ML sem conta Amazon, e os textos
 * de atualização e financeiro que não prometem horário nem conciliação.
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
  const ini = html.indexOf(marca);
  assert.notEqual(ini, -1, 'funcao ' + nome + ' nao encontrada em index.html');
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
/** `const NOME = ...;` inclusive quando o valor ocupa várias linhas (objeto, Set). */
function extrairConstante(nome) {
  const ini = html.indexOf('const ' + nome + ' = ');
  assert.notEqual(ini, -1, 'constante ' + nome + ' nao encontrada');
  let nivel = 0;
  for (let j = ini; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[' || c === '(') nivel++;
    else if (c === '}' || c === ']' || c === ')') nivel--;
    else if (c === ';' && nivel === 0) return html.slice(ini, j + 1);
  }
  throw new Error('constante ' + nome + ' nao fecha');
}

function montar(contas = []) {
  const fonte = [
    'const CONTAS_DISPONIVEIS = arguments[0];',
    "const CONTA_LEGADA = 'overwine-ml';",
    'let SELECAO = arguments[1];',
    "function selecaoLegada() { return SELECAO.length === 1 && SELECAO[0] === CONTA_LEGADA; }",
    'function contaNome(id) { return id; }',
    extrairFuncao('escHtml'),
    extrairFuncao('contaComoVendaAmazon'),
    extrairConstante('STATUS_AMAZON_SELO_ATIVO'),
    extrairConstante('ROTULO_STATUS_AMAZON'),
    extrairFuncao('contaComoVenda'),
    extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'),
    extrairFuncao('pedidoForaDaVenda'),
    extrairFuncao('pedidoCancelado'),
    extrairFuncao('filtroStatusPedido'),
    extrairFuncao('badgeStatusAmazon'),
    extrairFuncao('ordStatusBadge'),
    extrairFuncao('odLogisticaInfo'),
    extrairFuncao('contaInfo'),
    extrairFuncao('contasParaProxy'),
    extrairFuncao('contaEhAmazon'),
    extrairFuncao('selecaoTemMercadoLivre'),
    extrairFuncao('selecaoTemAmazon'),
    extrairFuncao('isFullItem'),
    extrairFuncao('isFbaItem'),
    "function itemSKU(i) { return i.seller_custom_field || ('sem-sku-' + i.id); }",
    extrairFuncao('fullStockKey'),
    extrairFuncao('consolidarEstoqueGrupo'),
    extrairFuncao('contaDaEmpresaOverwine'),
    extrairFuncao('contasPermitidas'),
    extrairFuncao('estoqueDoGrupo'),
    extrairFuncao('textoAtualizacaoAmazon'),
    extrairFuncao('textoFinanceiroAmazon'),
    'return { contaComoVenda, pedidoPago, pedidoForaDaVenda, pedidoCancelado, filtroStatusPedido, ordStatusBadge, odLogisticaInfo, contasParaProxy, selecaoTemMercadoLivre, selecaoTemAmazon, consolidarEstoqueGrupo, estoqueDoGrupo, contasPermitidas, textoAtualizacaoAmazon, textoFinanceiroAmazon, usar: s => { SELECAO = s; } };',
  ].join('\n');
  return new Function(fonte)(contas, ['overwine-ml']);
}
const CONTAS = [
  { id: 'overwine-ml', empresa: 'alemmar', canal: 'ml', legada: true },
  { id: 'degustar-ml', empresa: 'degustar', canal: 'ml' },
  { id: 'alemmar-amazon', empresa: 'alemmar', canal: 'amazon' },
];

describe('status por canal', () => {
  test('Mercado Livre: regra unica de venda (FASE A1) — paid e partially_refunded contam; o resto nao', () => {
    const m = montar(CONTAS);
    const VENDA = new Set(['paid', 'partially_refunded']);
    for (const status of ['paid', 'cancelled', 'partially_refunded', 'pending', 'payment_required', 'xpto', null]) {
      const o = { status, canal: 'ml' };
      assert.equal(m.pedidoPago(o), VENDA.has(status), 'pago ' + status);
      assert.equal(m.pedidoForaDaVenda(o), !VENDA.has(status), 'fora ' + status);
      assert.equal(m.pedidoCancelado(o), status === 'cancelled');
      // Filtro "Pagos" da tabela e EXIBICAO: segue a igualdade estrita.
      assert.equal(m.filtroStatusPedido(o, 'paid'), status === 'paid');
      // Pedido ML sem campo `canal` (Overwine sozinha) segue a mesma regra.
      assert.equal(m.pedidoPago({ status }), VENDA.has(status));
      assert.equal(m.pedidoPago(o), m.contaComoVenda(status), 'pedidoPago == contaComoVenda ' + status);
    }
    assert.equal(m.contaComoVenda('partially_refunded'), true);
  });
  test('Amazon: tudo conta, menos cancelado — inclusive status que a tela não conhece', () => {
    const m = montar(CONTAS);
    const conta = { 'amazon:unshipped': true, 'amazon:partially_shipped': true, 'amazon:shipped': true, 'amazon:pending': true, 'amazon:pending_availability': true, 'amazon:cancelled': false, 'amazon:unfulfillable': true, 'amazon:desconhecido': true, 'amazon:novo_status_futuro': true };
    for (const [status, venda] of Object.entries(conta)) {
      const o = { status, canal: 'amazon' };
      assert.equal(m.pedidoPago(o), venda, status);
      assert.equal(m.pedidoForaDaVenda(o), !venda, status);
    }
    assert.equal(m.pedidoCancelado({ status: 'amazon:cancelled', canal: 'amazon' }), true);
    assert.equal(m.pedidoCancelado({ status: 'amazon:pending', canal: 'amazon' }), false);
    assert.equal(m.filtroStatusPedido({ status: 'amazon:shipped', canal: 'amazon' }, 'paid'), true);
    // Exibição inalterada: pendente com rótulo e selo de pendente; status desconhecido com o texto original.
    assert.match(m.ordStatusBadge('amazon:pending'), /badge paused[^>]*>Pendente</);
    assert.match(m.ordStatusBadge('amazon:novo_status_futuro'), /badge paused[^>]*>novo_status_futuro</);
    assert.match(m.ordStatusBadge('amazon:cancelled'), /badge closed[^>]*>Cancelado</);
    assert.match(m.ordStatusBadge('amazon:shipped'), /badge active/);
  });
  test('nenhuma tela compara status cru, exceto a lista de cancelados que vem do proxy do ML', () => {
    const cru = html.split('\n').filter(l => /o\.status (===|!==) '(paid|cancelled)'/.test(l) && !/function pedido/.test(l));
    assert.deepEqual(cru.map(l => l.trim()), ["const lista = allRes.filter(o => o.status === 'cancelled');"]);
  });
});

describe('KPIs de pedidos com a Amazon: pendente entra, só cancelado fica fora', () => {
  // 21/10/2026 12:00 em Brasília. Hoje = 21/10; 7 dias = 15/10 a 21/10; mês = outubro.
  const AGORA = Date.parse('2026-10-21T15:00:00.000Z');
  class DataFixa extends Date {
    constructor(...a) { super(...(a.length ? a : [AGORA])); }
    static now() { return AGORA; }
  }
  const amz = (id, quando, status, valor) => ({ id, canal: 'amazon', status: 'amazon:' + status, date_created: quando, paid_amount: valor });
  const PEDIDOS_AMZ = [
    amz('A', '2026-10-21T13:00:00.000Z', 'pending', 100),
    amz('B', '2026-10-21T14:00:00.000Z', 'shipped', 250),
    amz('C', '2026-10-21T14:30:00.000Z', 'cancelled', 60),
    amz('D', '2026-10-17T15:00:00.000Z', 'pending', 40),
    amz('E', '2026-10-05T15:00:00.000Z', 'unshipped', 30),
    amz('H', '2026-10-10T15:00:00.000Z', 'novo_status_futuro', 15),
    amz('F', '2026-09-25T15:00:00.000Z', 'pending', 70),
  ];
  function kpis(pedidos) {
    const els = {};
    const documento = { getElementById: id => (els[id] = els[id] || { textContent: '' }) };
    const fonte = [
      'const Date = arguments[0], document = arguments[1], allOrders = arguments[2];',
      extrairFuncao('contaComoVendaAmazon'),
      extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'), extrairFuncao('pedidoPago'),
      extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
      extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'),
      extrairFuncao('dentroDoPeriodo'), extrairFuncao('hojeBRT'),
      extrairFuncao('renderPedidosKPIsLocal'),
      'renderPedidosKPIsLocal();',
    ].join('\n');
    new Function(fonte)(DataFixa, documento, pedidos);
    const n = id => Number(String(els[id].textContent).replace(/[^0-9]/g, ''));
    return { hoje: [n('ord-hoje-val'), n('ord-hoje-cnt')], sem: [n('ord-sem-val'), n('ord-sem-cnt')], mes: [n('ord-mes-val'), n('ord-mes-cnt')], ticket: n('ord-ticket'), cancel: n('ord-cancel') };
  }

  test('hoje, últimos 7 dias, mês atual e ticket: pendente, enviado, a enviar e desconhecido entram; cancelado não', () => {
    const k = kpis(PEDIDOS_AMZ);
    assert.deepEqual(k.hoje, [350, 2]);        // A pendente + B enviado; C cancelado fora
    assert.deepEqual(k.sem, [390, 3]);         // + D pendente
    assert.deepEqual(k.mes, [435, 5]);         // + E a enviar + H status desconhecido
    assert.equal(k.ticket, 84);                // (100+250+40+30+15+70) / 6 = 84,17 (exibido sem centavos)
    assert.equal(k.cancel, 1);
  });

  test('Mercado Livre: KPIs idênticos aos da regra antiga (só paid entra)', () => {
    const ml = (id, quando, status, valor) => ({ id, status, date_created: quando, paid_amount: valor });
    const k = kpis([
      ml(1, '2026-10-21T13:00:00.000Z', 'paid', 100),
      ml(2, '2026-10-21T13:00:00.000Z', 'pending', 500),
      ml(3, '2026-10-21T13:00:00.000Z', 'cancelled', 0),
      ml(4, '2026-10-17T13:00:00.000Z', 'payment_required', 300),
    ]);
    assert.deepEqual([k.hoje, k.sem, k.mes, k.ticket, k.cancel], [[100, 1], [100, 1], [100, 1], 100, 1]);
  });

  test('o resumo de pedidos do chat usa as mesmas regras (sem comparar status cru)', () => {
    const f = extrairFuncao('owChatCalcPedidos');
    assert.match(f, /if \(pedidoCancelado\(o\)\)/);
    assert.match(f, /if \(!pedidoPago\(o\)\) return;/);
    assert.doesNotMatch(f, /st !== 'paid'/);
  });
});

describe('logística e estoque', () => {
  test('FBA, Easy Ship e envio próprio com rótulos próprios; nunca "FULL"', () => {
    const m = montar(CONTAS);
    assert.equal(m.odLogisticaInfo('amazon_fba').tag, 'FBA');
    assert.equal(m.odLogisticaInfo('amazon_easy_ship').tag, 'EASY SHIP');
    assert.equal(m.odLogisticaInfo('amazon_envio_proprio').tag, 'PROPRIO');
    assert.equal(m.odLogisticaInfo('fulfillment').tag, 'FULL');
  });
  test('Amazon: FBA fora do "próprio"; o total do produto soma próprio + FBA (saldos distintos)', () => {
    const m = montar(CONTAS);
    const proprio = { id: '21003', canal: 'amazon', available_quantity: 12, shipping: { logistic_type: 'amazon_proprio' }, tags: null };
    const fba = { id: '21003#fba', canal: 'amazon', available_quantity: 35, shipping: { logistic_type: 'amazon_fba' }, tags: null };
    const c = m.consolidarEstoqueGrupo([proprio, fba]);
    assert.deepEqual([c.proprio, c.full, c.fba], [12, 0, 35]);
    assert.deepEqual(m.estoqueDoGrupo([proprio, fba]), { valor: 47, confirmado: true, porAnuncio: null });
  });
  test('Mercado Livre: consolidarEstoqueGrupo igual ao de antes (fba = 0)', () => {
    const m = montar(CONTAS);
    const full = { id: 'MLB1', available_quantity: 10, shipping: { logistic_type: 'fulfillment' }, inventory_id: 'INV1', tags: [] };
    const prop = { id: 'MLB2', available_quantity: 7, shipping: { logistic_type: 'xd_drop_off' }, tags: [] };
    const c = m.consolidarEstoqueGrupo([full, prop]);
    assert.deepEqual([c.proprio, c.full, c.fba], [7, 10, 0]);
  });
});

describe('seleção e proxy', () => {
  test('o proxy do ML nunca recebe a conta Amazon; abas só-ML somem sem conta ML', () => {
    const m = montar(CONTAS);
    m.usar(['overwine-ml', 'alemmar-amazon']);
    assert.deepEqual(m.contasParaProxy(), ['overwine-ml']);
    assert.equal(m.selecaoTemMercadoLivre(), true);
    assert.equal(m.selecaoTemAmazon(), true);
    m.usar(['alemmar-amazon']);
    assert.deepEqual(m.contasParaProxy(), []);
    assert.equal(m.selecaoTemMercadoLivre(), false);
    m.usar(['overwine-ml']);
    assert.deepEqual(m.contasParaProxy(), [null]);
    assert.equal(m.selecaoTemAmazon(), false);
  });
});

describe('textos de atualização e financeiro', () => {
  test('atualização: sem aba aberta não promete horário', () => {
    const m = montar(CONTAS);
    const t = m.textoAtualizacaoAmazon({ ultimoPasso: { ok: true }, proximaConsultaPedidosEm: '2026-10-01T15:03:00Z', pedidosLidosAte: '2026-10-01T14:58:00Z', financeiroLidoAte: null });
    assert.match(t.curto, /próxima consulta de pedidos/);
    assert.match(t.longo, /sem horário garantido/);
    assert.match(m.textoAtualizacaoAmazon({ ultimoPasso: { ok: false } }).curto, /falhou/);
    assert.deepEqual(m.textoAtualizacaoAmazon(null), { curto: '', longo: '' });
  });
  test('financeiro: lançado ≠ faturamento, nunca "conciliado"; não lido = indisponível', () => {
    const m = montar(CONTAS);
    const a = { lidoAte: '2026-10-01T10:00:00Z', pedidos: { vendas: 3, comTransacoes: 1, semTransacoesAteLeitura: 2, foraDaLeitura: 0 }, faturamentoComTransacoes: 99.9, lancadoDessasVendas: 54.91, retidas: 0, debitos: { pedidos: 1, valor: -30 }, lancamentosSemPedido: { quantidade: 1, valor: -19.9 }, conciliado: false };
    const t = m.textoFinanceiroAmazon({ 'alemmar-amazon': { metodo: 'transacoes_amazon', amazon: a }, 'overwine-ml': { metodo: 'estimado_taxas_da_conta' } });
    assert.match(t, /não conciliado/);
    assert.match(t, /54,91/);
    assert.match(t, /faturamento não foi reduzido/);
    assert.match(t, /não são venda/);
    const nunca = m.textoFinanceiroAmazon({ 'alemmar-amazon': { amazon: { ...a, lidoAte: null } } });
    assert.match(nunca, /indisponíveis/);
    assert.equal(m.textoFinanceiroAmazon({ 'overwine-ml': { metodo: 'estimado_taxas_da_conta' } }), '');
  });
});

describe('regras de negócio da Amazon (revisão 10/2026)', () => {
  test('Degustar nunca tem Amazon: conta Amazon de outra empresa é descartada do registro', () => {
    const m = montar(CONTAS);
    const registro = [...CONTAS, { id: 'degustar-amazon', empresa: 'degustar', canal: 'amazon' }, { id: 'degustar-shopee', empresa: 'degustar', canal: 'shopee' }];
    const ids = m.contasPermitidas(registro).map(c => c.id);
    assert.ok(!ids.includes('degustar-amazon'));
    assert.ok(ids.includes('alemmar-amazon') && ids.includes('degustar-ml') && ids.includes('overwine-ml'));
    assert.ok(ids.includes('degustar-shopee'), 'só a Amazon é restrita à Overwine');
    // Sem a conta legada no registro, nenhuma Amazon passa (não há como saber a empresa da Overwine).
    assert.deepEqual(m.contasPermitidas([{ id: 'alemmar-amazon', empresa: 'alemmar', canal: 'amazon' }]), []);
  });
  test('Overwine ML + Amazon (mesma empresa): próprio compartilhado contado UMA vez, Full e FBA separados', () => {
    const m = montar(CONTAS);
    const mlProp = { id: 'MLB1', conta: 'overwine-ml', available_quantity: 50, inventory_id: 'INVP', shipping: { logistic_type: 'xd_drop_off' }, tags: [] };
    const mlFull = { id: 'MLB2', conta: 'overwine-ml', available_quantity: 10, inventory_id: 'INVF', shipping: { logistic_type: 'fulfillment' }, tags: [] };
    const amzProp = { id: 'SKU1', conta: 'alemmar-amazon', canal: 'amazon', available_quantity: 50, inventory_id: null, shipping: { logistic_type: 'amazon_proprio' }, tags: null };
    const amzFba = { id: 'SKU1#fba', conta: 'alemmar-amazon', canal: 'amazon', available_quantity: 20, inventory_id: 'FNSKU1', shipping: { logistic_type: 'amazon_fba' }, tags: null };
    const c = m.consolidarEstoqueGrupo([mlProp, mlFull, amzProp, amzFba]);
    assert.deepEqual([c.proprio, c.full, c.fba], [50, 10, 20]);
    assert.deepEqual(m.estoqueDoGrupo([mlProp, mlFull, amzProp, amzFba]), { valor: 80, confirmado: true, porAnuncio: null });
    // ML próprio sem inventory_id e Amazon próprio: o mesmo saldo, usa o maior (nunca soma).
    const mlSemInv = { ...mlProp, inventory_id: null, available_quantity: 48 };
    assert.equal(m.consolidarEstoqueGrupo([mlSemInv, amzProp]).proprio, 50);
  });
  test('Degustar ML junto da Amazon da Overwine não vira estoque compartilhado', () => {
    const m = montar(CONTAS);
    const deg = { id: 'MLB9', conta: 'degustar-ml', available_quantity: 7, shipping: { logistic_type: 'xd_drop_off' }, tags: [] };
    const amz = { id: 'SKU9', conta: 'alemmar-amazon', canal: 'amazon', available_quantity: 7, inventory_id: null, shipping: { logistic_type: 'amazon_proprio' }, tags: null };
    const r = m.estoqueDoGrupo([deg, amz]);
    assert.equal(r.confirmado, false, 'empresas diferentes: sem vínculo, nenhum total afirmado');
  });
  test('visitas e conversão: a Amazon não informa visitas, nada vira zero', () => {
    const i = html.indexOf("const _amzVis = selecaoTemAmazon();");
    assert.notEqual(i, -1);
    const bloco = html.slice(i, i + 1600);
    assert.match(bloco, /kpi-visitas'\)\.innerHTML = htmlIndisponivel/);
    assert.match(bloco, /kpi-conversao'\)\.innerHTML = htmlIndisponivel/);
  });
  test('Gestão de Estoque: SKU da Amazon sem estoque próprio informado fica fora (nunca 0 = ruptura falsa)', () => {
    const f = extrairFuncao('estGetSKUData');
    assert.match(f, /estoqueInformado === false/);
    assert.match(f, /filter\(g => !_semEstoqueInformado\(g\)\)/);
  });

  test('seletor: com Degustar escolhida, Amazon fica desabilitada e o marketplace cai no ML', () => {
    const ok = [
      { id: 'overwine-ml', empresa: 'alemmar', canal: 'ml' },
      { id: 'alemmar-amazon', empresa: 'alemmar', canal: 'amazon' },
      { id: 'degustar-ml', empresa: 'degustar', canal: 'ml' },
    ];
    const opt = (value, futuro) => ({ value, disabled: !!futuro, dataset: futuro ? { futuro: '1' } : {} });
    const selC = { options: [opt('ml'), opt('amazon'), opt('*'), opt('shopee', true)], selectedIndex: 1,
      set value(v) { this.selectedIndex = this.options.findIndex(o => o.value === v); },
      get value() { return this.options[this.selectedIndex].value; } };
    const fn = new Function('_contasSelecionaveis', extrairFuncao('_canaisDaEmpresa') + '; return _canaisDaEmpresa;')(() => ok);
    fn({ value: 'degustar' }, selC);
    assert.deepEqual(selC.options.map(o => o.disabled), [false, true, false, true]);
    assert.equal(selC.value, 'ml');
    fn({ value: 'alemmar' }, selC);
    assert.deepEqual(selC.options.map(o => o.disabled), [false, false, false, true]);
  });

  test('detalhe do anúncio Amazon: sem frete/estoque inventado e link para a Amazon', () => {
    const f = extrairFuncao('openDetail');
    assert.match(f, /const _amz = item\.canal === 'amazon'/);
    assert.match(f, /estoqueInformado === false\) \? 'n\\u00e3o informado pela Amazon'/);
    assert.match(f, /_amz \? 'n\\u00e3o informado' : \(item\.shipping\?\.free_shipping/);
    assert.match(f, /_amz \? 'Ver na Amazon' : 'Ver no ML'/);
  });

  test('aba só-ML aberta volta para Geral quando a seleção não tem ML', () => {
    const f = extrairFuncao('aplicarAbasPorCanal');
    assert.match(f, /if \(!temML && typeof switchTab === 'function'/);
    assert.match(f, /switchTab\('visaogeral'\)/);
  });
});

describe('rótulos por canal: nome de tela separado da chave de agrupamento', () => {
  const REG = [
    { id: 'overwine-ml', empresa: 'alemmar', empresaRotulo: 'Além Mar (Overwine)', canal: 'ml', canalRotulo: 'Mercado Livre' },
    { id: 'degustar-ml', empresa: 'degustar', empresaRotulo: 'Degustar', canal: 'ml', canalRotulo: 'Mercado Livre' },
    { id: 'alemmar-amazon', empresa: 'alemmar', empresaRotulo: 'Além Mar (Overwine)', canal: 'amazon', canalRotulo: 'Amazon' },
  ];
  function montarRotulos(selecao) {
    const fonte = [
      'const CONTAS_DISPONIVEIS = arguments[0];',
      "const CONTA_LEGADA = 'overwine-ml';",
      'let SELECAO = arguments[1];',
      'let allItems = [];',
      extrairFuncao('selecaoConsolidada'),
      extrairFuncao('contaInfo'),
      extrairFuncao('empresaNome'),
      extrairFuncao('empresaDaConta'),
      extrairFuncao('canalCurto'),
      extrairFuncao('contaNome'),
      'function _skuDoVendedor(i) { return i.seller_custom_field || null; }',
      'function _skuPorCatalogo() { return new Map(); }',
      extrairFuncao('itemSKU'),
      extrairFuncao('textoCatalogoDesatualizado'),
      extrairFuncao('escHtml'),
      extrairFuncao('textoFinanceiroAmazon'),
      extrairFuncao('textoAtualizacaoAmazon'),
      'return { contaNome, empresaDaConta, itemSKU, textoCatalogoDesatualizado, textoFinanceiroAmazon, textoAtualizacaoAmazon };',
    ].join('\n');
    return new Function(fonte)(REG, selecao);
  }

  test('nome de tela: Amazon sempre com canal; ML ganha "ML" só quando a seleção mistura canais da mesma empresa', () => {
    assert.equal(montarRotulos(['overwine-ml']).contaNome('overwine-ml'), 'Overwine');
    assert.equal(montarRotulos(['alemmar-amazon']).contaNome('alemmar-amazon'), 'Overwine Amazon');
    const mista = montarRotulos(['overwine-ml', 'alemmar-amazon']);
    assert.deepEqual(['overwine-ml', 'alemmar-amazon'].map(mista.contaNome), ['Overwine ML', 'Overwine Amazon']);
    const comDegustar = montarRotulos(['overwine-ml', 'degustar-ml']);
    assert.deepEqual(['overwine-ml', 'degustar-ml'].map(comDegustar.contaNome), ['Overwine', 'Degustar']);
  });

  test('chave de SKU: mesma empresa = mesma chave, qualquer que seja o nome de tela', () => {
    const m = montarRotulos(['overwine-ml', 'alemmar-amazon', 'degustar-ml']);
    const ml = m.itemSKU({ seller_custom_field: '21101', conta: 'overwine-ml' });
    const amz = m.itemSKU({ seller_custom_field: '21101', conta: 'alemmar-amazon' });
    const deg = m.itemSKU({ seller_custom_field: '21101', conta: 'degustar-ml' });
    assert.equal(ml, amz, 'ML e Amazon da Overwine continuam no mesmo grupo');
    assert.equal(ml, '21101 · Overwine');
    assert.notEqual(ml, deg, 'Degustar nunca agrupa com a Overwine');
    assert.notEqual(m.contaNome('overwine-ml'), m.contaNome('alemmar-amazon'), 'mas o nome de tela diferencia o canal');
    assert.doesNotMatch(extrairFuncao('itemSKU'), /contaNome\(/);
  });

  test('textos de financeiro e atualização dizem "Overwine Amazon", não "Overwine"', () => {
    const m = montarRotulos(['overwine-ml', 'alemmar-amazon']);
    const fin = m.textoFinanceiroAmazon({ 'alemmar-amazon': { amazon: { lidoAte: null } } });
    assert.match(fin, /^<b>Overwine Amazon: financeiro lan/);
    const atu = m.textoAtualizacaoAmazon({ 'alemmar-amazon': { ultimoPasso: { ok: true }, proximaConsultaPedidosEm: null } });
    assert.match(atu.curto, /^Overwine Amazon: /);
  });

  test('catálogo desatualizado diz de qual canal; no consolidado não chuta', () => {
    assert.equal(montarRotulos(['overwine-ml']).textoCatalogoDesatualizado(), 'Catalogo Mercado Livre desatualizado');
    assert.equal(montarRotulos(['alemmar-amazon']).textoCatalogoDesatualizado(), 'Catalogo Amazon desatualizado');
    assert.match(montarRotulos(['overwine-ml', 'alemmar-amazon']).textoCatalogoDesatualizado(), /ao menos uma conta/);
  });

  test('KPIs: "ML" só com Mercado Livre, "Amazon" só com Amazon, sem sufixo na mistura', () => {
    const els = {};
    const documento = { getElementById: id => (els[id] = els[id] || { textContent: id === 'kpi-liq-pct' ? 'estimado \u00b7 tarifas m\u00e9dias' : '' }) };
    const rodar = (ml, amz, financeiro = false) => {
      Object.keys(els).forEach(k => delete els[k]);
      new Function('document', 'selecaoTemMercadoLivre', 'selecaoTemAmazon', 'selecaoTemFinanceiro', extrairFuncao('aplicarRotulosPorCanal') + '; aplicarRotulosPorCanal();')(documento, () => ml, () => amz, () => financeiro);
      return [els['kpi-liq-rotulo'].textContent, els['kpi-tarifa-ml-rotulo'].textContent, els['mg-th-liq'].textContent, els['kpi-liq-pct'].textContent];
    };
    // Sem perfil proprio: liquido apurado (real), rotulo por canal, sem "Estimada".
    assert.deepEqual(rodar(true, false), ['Receita Liquida ML', 'Tarifas ML', 'Liq. ML', 'apos tarifas + envio']);
    assert.deepEqual(rodar(false, true), ['Receita Liquida Amazon', 'Tarifas Amazon', 'Liq. Amazon', 'apos tarifas + envio']);
    assert.deepEqual(rodar(true, true), ['Receita Liquida', 'Tarifas', 'Liq.', 'apos tarifas + envio']);
    // FASE A3 — Overwine (perfil proprio): a Home diz que e estimativa; o subtitulo fica o do HTML.
    assert.deepEqual(rodar(true, false, true), ['Receita L\u00edquida Estimada', 'Tarifas ML', 'Liq. ML', 'estimado \u00b7 tarifas m\u00e9dias']);
    // A Margem nunca recebe o rotulo da Home: e outra grandeza (/margin).
    for (const [ml, amz, fin] of [[true, false, true], [true, false, false], [false, true, false], [true, true, false]]) {
      rodar(ml, amz, fin);
      assert.equal(els['mg-liq-rotulo'].textContent, 'Receita ap\u00f3s Tarifas e Frete');
      assert.notEqual(els['mg-liq-rotulo'].textContent, els['kpi-liq-rotulo'].textContent);
    }
    assert.match(extrairFuncao('aplicarAbasPorCanal'), /aplicarRotulosPorCanal\(\)/);
  });
});

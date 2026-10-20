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
    extrairConstante('STATUS_VENDA_AMAZON'),
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
  test('Mercado Livre: exatamente a comparação antiga, para todo status', () => {
    const m = montar(CONTAS);
    for (const status of ['paid', 'cancelled', 'partially_refunded', 'pending', 'payment_required', 'xpto', null]) {
      const o = { status, canal: 'ml' };
      assert.equal(m.pedidoPago(o), status === 'paid', 'pago ' + status);
      assert.equal(m.pedidoForaDaVenda(o), status === 'cancelled', 'fora ' + status);
      assert.equal(m.pedidoCancelado(o), status === 'cancelled');
      assert.equal(m.filtroStatusPedido(o, 'paid'), status === 'paid');
      // Pedido ML sem campo `canal` (Overwine sozinha) também segue a regra antiga.
      assert.equal(m.pedidoPago({ status }), status === 'paid');
    }
    assert.equal(m.contaComoVenda('partially_refunded'), true);
  });
  test('Amazon: só aprovados contam; pendente, pré-venda, cancelado e não atendível ficam fora', () => {
    const m = montar(CONTAS);
    const conta = { 'amazon:unshipped': true, 'amazon:partially_shipped': true, 'amazon:shipped': true, 'amazon:pending': false, 'amazon:pending_availability': false, 'amazon:cancelled': false, 'amazon:unfulfillable': false, 'amazon:desconhecido': false };
    for (const [status, venda] of Object.entries(conta)) {
      const o = { status, canal: 'amazon' };
      assert.equal(m.pedidoPago(o), venda, status);
      assert.equal(m.pedidoForaDaVenda(o), !venda, status);
    }
    assert.equal(m.pedidoCancelado({ status: 'amazon:cancelled', canal: 'amazon' }), true);
    assert.equal(m.pedidoCancelado({ status: 'amazon:pending', canal: 'amazon' }), false);
    assert.equal(m.filtroStatusPedido({ status: 'amazon:shipped', canal: 'amazon' }, 'paid'), true);
    assert.match(m.ordStatusBadge('amazon:pending'), /Pendente/);
    assert.match(m.ordStatusBadge('amazon:shipped'), /badge active/);
  });
  test('nenhuma tela compara status cru, exceto a lista de cancelados que vem do proxy do ML', () => {
    const cru = html.split('\n').filter(l => /o\.status (===|!==) '(paid|cancelled)'/.test(l) && !/function pedido/.test(l));
    assert.deepEqual(cru.map(l => l.trim()), ["const lista = allRes.filter(o => o.status === 'cancelled');"]);
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

/**
 * Filtro global de periodo — presets Hoje e Ontem.
 *
 * Travado aqui:
 *  - Hoje e Ontem sao dias civis de Brasilia (00:00 a 23:59:59.999 BRT);
 *  - pedidos com timestamp UTC perto da meia-noite caem no dia certo;
 *  - na virada da meia-noite o intervalo acompanha o novo dia, sozinho;
 *  - as duas opcoes vem antes de "Mes atual"; o padrao continua Mes atual;
 *  - Pedidos e Consolidado contam o mesmo no mesmo dia; dia vazio da zero.
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

/** Sandbox com o filtro global REAL; `relogio.hoje` simula o dia em Brasilia. */
function montar({ hoje, itens = [], pedidos = [] } = {}) {
  const relogio = { hoje, aplicacoes: 0 };
  const opcoes = [];
  const sel = { options: opcoes, value: '', set innerHTML(h) { opcoes.length = 0; for (const m of h.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)) opcoes.push({ value: m[1], text: m[2] }); } };
  const doc = { getElementById: id => (id === 'gdr-preset' ? sel : null), querySelectorAll: () => [] };
  const fonte = [
    'let _gdrAplicando = false;',
    'function brtStartOfDay(ymd) { if (!ymd) return null; return new Date(ymd + "T00:00:00.000-03:00"); }',
    'function brtEndOfDay(ymd) { if (!ymd) return null; return new Date(ymd + "T23:59:59.999-03:00"); }',
    'function ymdBRT(date) { const d = (date instanceof Date) ? date : new Date(date); return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); }',
    'function hojeBRT() { return _relogio.hoje; }',
    'function gdrAplicar() { _relogio.aplicacoes++; }',
    extrairConstante('MESES_GDR'), extrairConstante('globalDateRange'), extrairConstante('GDR_PRESETS_DIA'),
    extrairFuncao('gdrUltimoDia'), extrairFuncao('gdrYmd'), extrairFuncao('gdrDiasEntre'),
    extrairFuncao('gdrCalcularRange'), extrairFuncao('gdrRotulo'), extrairFuncao('gdrPrecisaVirar'),
    extrairFuncao('gdrGet'), extrairFuncao('gdrAtualizarRotulos'), extrairFuncao('gdrDefinir'),
    'let _gdrViradaTimer = null;', extrairFuncao('gdrVirarDia'), extrairFuncao('gdrMontarSelect'),
    extrairFuncao('dentroDoPeriodo'),
    extrairFuncao('contaComoVenda'), extrairFuncao('contaComoVendaAmazon'), extrairFuncao('pedidoAmazon'),
    extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('filtroStatusPedido'), extrairFuncao('pedidoCancelado'),
    'function itemSKU(i) { return i.sku; }',
    'function estoqueDoGrupo(items) { return { confirmado: true, valor: 0, porAnuncio: [] }; }',
    'let allItems = _itens; let allOrders = _pedidos; let ordFilter = "paid";',
    extrairFuncao('getFilteredOrders'),
    extrairFuncao('consVendasDoPeriodo'), extrairFuncao('buildConsolidado'),
    'return { gdrGet, gdrDefinir, gdrCalcularRange, gdrRotulo, gdrVirarDia, gdrMontarSelect, getFilteredOrders, buildConsolidado, estado: () => globalDateRange };',
  ].join('\n');
  const m = new Function('_relogio', '_itens', '_pedidos', 'document', fonte)(relogio, itens, pedidos, doc);
  return { ...m, relogio, sel };
}

describe('intervalos em horario de Brasilia', () => {
  test('Hoje = o dia corrente; Ontem = o dia civil anterior completo', () => {
    const m = montar({ hoje: '2026-10-22' });
    m.gdrDefinir('hoje');
    let g = m.gdrGet();
    assert.deepEqual([g.from, g.to, g.toEfetivo, g.dias, g.diasCalendario], ['2026-10-22', '2026-10-22', '2026-10-22', 1, 1]);
    assert.equal(g.fromDate.toISOString(), '2026-10-22T03:00:00.000Z'); // 00:00 BRT
    assert.equal(g.toDate.toISOString(), '2026-10-23T02:59:59.999Z');   // ultimo ms do dia BRT
    m.gdrDefinir('ontem');
    g = m.gdrGet();
    assert.deepEqual([g.from, g.to, g.dias], ['2026-10-21', '2026-10-21', 1]);
    assert.equal(g.fromDate.toISOString(), '2026-10-21T03:00:00.000Z');
    assert.equal(g.toDate.toISOString(), '2026-10-22T02:59:59.999Z');
  });

  test('Ontem atravessa mes, ano e fevereiro bissexto', () => {
    const r = (h) => montar({ hoje: h }).gdrCalcularRange('ontem', h);
    assert.deepEqual(r('2026-11-01'), { from: '2026-10-31', to: '2026-10-31' });
    assert.deepEqual(r('2027-01-01'), { from: '2026-12-31', to: '2026-12-31' });
    assert.deepEqual(r('2028-03-01'), { from: '2028-02-29', to: '2028-02-29' });
  });

  test('rotulos: "Hoje (22/10/26)" e "Ontem (21/10/26)"', () => {
    const m = montar({ hoje: '2026-10-22' });
    assert.equal(m.gdrRotulo('hoje', '2026-10-22', '2026-10-22'), 'Hoje (22/10/26)');
    assert.equal(m.gdrRotulo('ontem', '2026-10-21', '2026-10-21'), 'Ontem (21/10/26)');
  });

  test('fim inclusivo no ultimo milissegundo equivale a fim exclusivo na meia-noite seguinte', () => {
    const m = montar({ hoje: '2026-10-22' });
    m.gdrDefinir('hoje');
    const g = m.gdrGet();
    // O ML entrega no maximo milissegundos: nada cabe entre .999 e a meia-noite seguinte.
    const fimExclusivo = new Date('2026-10-23T00:00:00.000-03:00').getTime();
    assert.equal(g.toDate.getTime() + 1, fimExclusivo);
  });
});

describe('pedidos com timestamp UTC perto da meia-noite', () => {
  const ITENS = [{ id: 'MLB1', sku: 'A', title: 'Vinho A', status: 'active', price: 100 }];
  const ped = (id, date_created, status = 'paid') => ({ id, date_created, status, order_items: [{ item: { id: 'MLB1' }, quantity: 1, unit_price: 100 }] });
  const PEDIDOS = [
    ped(1, '2026-10-22T02:59:59.999Z'),      // 21/10 23:59:59.999 BRT -> ontem
    ped(2, '2026-10-22T03:00:00.000Z'),      // 22/10 00:00 BRT        -> hoje
    ped(3, '2026-10-22T00:30:00.000Z'),      // "22/10" em UTC, mas 21/10 21:30 BRT -> ontem
    ped(4, '2026-10-22T10:00:00.000-04:00'), // fuso -04:00 do ML: 22/10 11:00 BRT -> hoje
    ped(5, '2026-10-21T02:59:00.000Z'),      // 20/10 23:59 BRT -> nem hoje nem ontem
    ped(6, '2026-10-22T12:00:00.000-03:00', 'cancelled'),
  ];
  const ids = l => l.map(o => o.id).sort();

  test('Hoje pega 00:00 BRT em diante; Ontem pega ate 23:59:59.999 BRT', () => {
    const m = montar({ hoje: '2026-10-22', itens: ITENS, pedidos: PEDIDOS });
    m.gdrDefinir('hoje');
    assert.deepEqual(ids(m.getFilteredOrders()), [2, 4]);
    m.gdrDefinir('ontem');
    assert.deepEqual(ids(m.getFilteredOrders()), [1, 3]);
  });

  test('Pedidos e Consolidado contam o mesmo no mesmo dia', () => {
    const m = montar({ hoje: '2026-10-22', itens: ITENS, pedidos: PEDIDOS });
    for (const p of ['hoje', 'ontem', 'mes_atual']) {
      m.gdrDefinir(p);
      const c = m.buildConsolidado()[0];
      assert.equal(c.pedidosCnt, m.getFilteredOrders().length, p);
    }
  });

  test('troca Hoje -> Ontem -> Mes atual -> Hoje: cada troca recalcula, sem resto da anterior', () => {
    const m = montar({ hoje: '2026-10-22', itens: ITENS, pedidos: PEDIDOS });
    const conta = p => { m.gdrDefinir(p); return m.buildConsolidado()[0].pedidosCnt; };
    assert.deepEqual([conta('hoje'), conta('ontem'), conta('mes_atual'), conta('hoje')], [2, 2, 5, 2]);
  });

  test('dia sem pedidos: zero pedidos, zero unidades, sem preco medio vendido', () => {
    const m = montar({ hoje: '2026-10-25', itens: ITENS, pedidos: PEDIDOS });
    m.gdrDefinir('hoje');
    assert.equal(m.getFilteredOrders().length, 0);
    const c = m.buildConsolidado()[0];
    assert.deepEqual([c.pedidosCnt, c.vendasTotal, c.precoMedioVendido], [0, 0, null]);
  });
});

describe('virada da meia-noite', () => {
  test('Hoje selecionado: depois da meia-noite o intervalo ja e o do novo dia', () => {
    const m = montar({ hoje: '2026-10-22' });
    m.gdrDefinir('hoje');
    m.relogio.hoje = '2026-10-23';
    const g = m.gdrGet();
    assert.deepEqual([g.from, g.to, g.label], ['2026-10-23', '2026-10-23', 'Hoje (23/10/26)']);
  });

  test('Ontem selecionado: vira junto (passa a ser o dia 22)', () => {
    const m = montar({ hoje: '2026-10-22' });
    m.gdrDefinir('ontem');
    m.relogio.hoje = '2026-10-23';
    assert.equal(m.gdrGet().from, '2026-10-22');
  });

  test('o relogio recarrega os dados so com Hoje/Ontem e so quando o dia mudou', () => {
    const m = montar({ hoje: '2026-10-22' });
    m.gdrDefinir('hoje');
    m.gdrVirarDia();
    assert.equal(m.relogio.aplicacoes, 0, 'mesmo dia: nada');
    m.relogio.hoje = '2026-10-23';
    m.gdrVirarDia();
    assert.equal(m.relogio.aplicacoes, 1, 'dia novo: recarrega uma vez');
    m.gdrVirarDia();
    assert.equal(m.relogio.aplicacoes, 1, 'nao repete');
    assert.equal(m.estado().from, '2026-10-23');
  });

  test('Mes atual, personalizado e meses fixos nao sao tocados pela virada', () => {
    const m = montar({ hoje: '2026-10-22' });
    m.gdrDefinir('custom', '2026-10-01', '2026-10-10');
    m.relogio.hoje = '2026-10-23';
    m.gdrVirarDia();
    assert.equal(m.relogio.aplicacoes, 0);
    assert.deepEqual([m.gdrGet().from, m.gdrGet().to], ['2026-10-01', '2026-10-10']);
  });
});

describe('seletor', () => {
  test('Hoje e Ontem vem antes de Mes atual; o resto continua igual e na mesma ordem', () => {
    const m = montar({ hoje: '2026-10-22' });
    m.gdrMontarSelect();
    const v = m.sel.options.map(o => o.value);
    assert.deepEqual(v.slice(0, 3), ['hoje', 'ontem', 'mes_atual']);
    assert.deepEqual(m.sel.options.slice(0, 2).map(o => o.text), ['Hoje', 'Ontem']);
    assert.deepEqual(v.slice(3, 15), ['mes:2026-09', 'mes:2026-08', 'mes:2026-07', 'mes:2026-06', 'mes:2026-05', 'mes:2026-04',
      'mes:2026-03', 'mes:2026-02', 'mes:2026-01', 'mes:2025-12', 'mes:2025-11', 'mes:2025-10']);
    assert.deepEqual(v.slice(15), ['ultimos:3', 'ultimos:6', 'ultimos:12', 'ano:2026', 'ano:2025', 'custom']);
  });

  test('o padrao continua Mes atual e o relogio da virada e unico', () => {
    const ini = extrairFuncao('gdrInit');
    assert.match(ini, /gdrDefinir\('mes_atual'\)/);
    assert.match(ini, /if \(!_gdrViradaTimer\) _gdrViradaTimer = setInterval\(gdrVirarDia, 60000\)/);
  });

  test('a virada usa o mesmo caminho da troca de periodo (gdrAplicar), sem logica paralela', () => {
    assert.match(extrairFuncao('gdrVirarDia'), /gdrDefinir\(globalDateRange\.preset\);\s*gdrAplicar\(\);/);
  });
});

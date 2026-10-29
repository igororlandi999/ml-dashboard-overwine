/**
 * FASE A8 — periodo e rotulos coerentes.
 *
 * Travado aqui:
 *  - Hoje, Ontem, "Ultimos 7 dias" (card da aba Pedidos) e personalizado dao as
 *    datas BRT certas;
 *  - visitas: a API so cobre 150 dias ate hoje; periodo truncado e declarado no
 *    rotulo e periodo inteiro fora da janela fica indisponivel (nunca 0);
 *  - janelas proprias ficam explicitas: reputacao 60d, velocidade 30d, ticket
 *    historico, mais vendidos do historico do anuncio;
 *  - publicidade e cancelamentos seguem o periodo global; nenhuma formula muda.
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

function datas(hojeYmd) {
  return new Function('_hoje', [
    extrairFuncao('ymdBRT'), extrairFuncao('gdrUltimoDia'), extrairFuncao('gdrYmd'), extrairFuncao('gdrDiasEntre'),
    extrairFuncao('gdrCalcularRange'),
    'function hojeBRT() { return _hoje; }',
    'const VISITAS_JANELA_API_DIAS = 150;', extrairFuncao('janelaVisitas'),
    'return { range: (p, de, ate) => gdrCalcularRange(p, _hoje, de, ate), janelaVisitas, ymdBRT, dias: gdrDiasEntre };',
  ].join('\n'))(hojeYmd);
}

describe('periodo global: datas BRT', () => {
  test('1. Hoje: o dia civil de Brasilia, mesmo quando em UTC ja e amanha', () => {
    const d = datas('2026-10-29');
    // 29/10 23:30 BRT = 30/10 02:30 UTC
    assert.equal(d.ymdBRT(new Date('2026-10-30T02:30:00Z')), '2026-10-29');
    assert.deepEqual(d.range('hoje'), { from: '2026-10-29', to: '2026-10-29' });
  });

  test('2. Ontem: dia anterior, inclusive na virada de mes e de ano', () => {
    assert.deepEqual(datas('2026-10-29').range('ontem'), { from: '2026-10-28', to: '2026-10-28' });
    assert.deepEqual(datas('2026-11-01').range('ontem'), { from: '2026-10-31', to: '2026-10-31' });
    assert.deepEqual(datas('2027-01-01').range('ontem'), { from: '2026-12-31', to: '2026-12-31' });
  });

  test('3. "Ultimos 7 dias" (aba Pedidos): hoje + 6 dias anteriores, em BRT', () => {
    const AGORA = Date.parse('2026-10-21T15:00:00.000Z');   // 21/10 12:00 BRT
    class DataFixa extends Date { constructor(...a) { super(...(a.length ? a : [AGORA])); } static now() { return AGORA; } }
    const els = {};
    const doc = { getElementById: id => (els[id] = els[id] || { textContent: '' }) };
    const ped = (id, quando) => ({ id, status: 'paid', date_created: quando, paid_amount: 10 });
    const pedidos = [
      ped(1, '2026-10-21T13:00:00.000Z'),   // hoje
      ped(2, '2026-10-15T03:30:00.000Z'),   // 15/10 00:30 BRT — 1o dia da janela
      ped(3, '2026-10-15T02:30:00.000Z'),   // 14/10 23:30 BRT — fora
    ];
    new Function([
      'const Date = arguments[0], document = arguments[1], allOrders = arguments[2];',
      extrairFuncao('contaComoVendaAmazon'), extrairFuncao('contaComoVenda'), extrairFuncao('pedidoAmazon'),
      extrairFuncao('pedidoPago'), extrairFuncao('pedidoForaDaVenda'), extrairFuncao('pedidoCancelado'),
      extrairFuncao('brtStartOfDay'), extrairFuncao('brtEndOfDay'), extrairFuncao('ymdBRT'),
      extrairFuncao('dentroDoPeriodo'), extrairFuncao('hojeBRT'), extrairFuncao('renderPedidosKPIsLocal'),
      'renderPedidosKPIsLocal();',
    ].join('\n'))(DataFixa, doc, pedidos);
    assert.equal(els['ord-sem-cnt'].textContent, 2);
    assert.equal(els['ord-hoje-cnt'].textContent, 1);
  });

  test('4. personalizado mantem as datas; invertido cai no padrao', () => {
    const d = datas('2026-10-29');
    assert.deepEqual(d.range('custom', '2026-08-10', '2026-08-20'), { from: '2026-08-10', to: '2026-08-20' });
    assert.deepEqual(d.range('custom', '2026-08-20', '2026-08-10'), { from: '2026-10-01', to: '2026-10-31' });
  });
});

describe('5. metrica global sem janela fixa escondida: visitas (limite de 150 dias da API)', () => {
  const d = datas('2026-10-29');

  test('periodo dentro dos 150 dias: completa', () => {
    assert.equal(d.janelaVisitas('2026-10-01', '2026-10-29'), 'completa');
    assert.equal(d.janelaVisitas('2026-06-02', '2026-10-29'), 'completa');   // 150 dias exatos
  });

  test('inicio antes da janela: truncada (declarada no rotulo)', () => {
    assert.equal(d.dias('2026-06-01', '2026-10-29'), 151);
    assert.equal(d.janelaVisitas('2026-06-01', '2026-10-29'), 'truncada');
    assert.equal(d.janelaVisitas('2026-01-01', '2026-10-29'), 'truncada');
  });

  test('periodo inteiro fora da janela: fora (visitas e conversao indisponiveis, nunca 0)', () => {
    assert.equal(d.janelaVisitas('2026-01-01', '2026-03-31'), 'fora');
    const k = extrairFuncao('renderKPIsPeriodo');
    assert.match(k, /const _janVis = janelaVisitas\(_gVis\.from, _gVis\.toEfetivo\);/);
    assert.match(k, /_janVis === 'fora'\) document\.getElementById\('kpi-visitas'\)\.innerHTML = htmlIndisponivel\(_motJanela\)/);
    assert.match(k, /_janVis === 'fora'\) document\.getElementById\('kpi-conversao'\)\.innerHTML = htmlIndisponivel/);
    assert.match(k, /_janVis === 'truncada' \? '\\u00faltimos 150 dias do per\\u00edodo \(limite da API\)'/);
  });

  test('o calculo de visitas pede a mesma janela que o rotulo declara', () => {
    assert.match(extrairFuncao('loadPeriodoData'), /Math\.min\(VISITAS_JANELA_API_DIAS, Math\.max\(1, gdrDiasEntre\(fromYmd, hojeBRT\(\)\)\)\)/);
  });
});

describe('janelas proprias explicitas', () => {
  test('6. reputacao: as tres taxas e as vendas dizem 60d e "reputacao ML"', () => {
    const r = extrairFuncao('renderCardReputacao');
    assert.match(r, /metric\('Cancelamentos \(reputa\\u00e7\\u00e3o ML, 60d\)', mCancel\)/);
    assert.match(r, /metric\('Atrasos \(reputa\\u00e7\\u00e3o ML, 60d\)', mDelay\)/);
    assert.match(r, /metric\('Reclama\\u00e7\\u00f5es \(reputa\\u00e7\\u00e3o ML, 60d\)', mClaims\)/);
    assert.match(r, /Vendas concluidas \(60d\)/);
    assert.match(r, /Base: vendas concluidas e faturamento dos ultimos \$\{PERIODO_DIAS\} dias/);
  });

  test('7. velocidade de 30 dias identificada na Gestao de Estoque', () => {
    assert.match(html, /<th style="text-align:center">Vel\. 30d<\/th>/);
    assert.match(extrairFuncao('renderEstoque'), /velocidade: vendas dos \\u00faltimos 30 dias \(n\\u00e3o segue o per\\u00edodo\)/);
    assert.match(extrairFuncao('estGetSKUData'), /const vel = \+\(g\.vendas30 \/ 30\)\.toFixed\(2\);/);
  });

  test('8. nenhum "no periodo"/rotulo de periodo em metrica historica', () => {
    assert.match(html, /id="ord-ticket">-<\/div>\s*<div class="kpi-delta neutral">vendas do histórico<\/div>/);
    assert.match(html, /Mais Vendidos<\/div>\s*<div class="card-meta">qtd vendida \(histórico do anúncio\)<\/div>/);
    assert.match(extrairFuncao('renderTopVendasSidebar'), /sold_quantity/);
    assert.match(html, /Vendas Totais<\/div>\s*<div class="kpi-value" id="kpi-sold">-<\/div>\s*<div class="kpi-delta neutral">historico<\/div>/);
    assert.match(html, /Faturamento Mensal<\/div>\s*<div class="card-meta">historico via pedidos<\/div>/);
    assert.match(html, /Visitas por Dia<\/div>\s*<div class="card-meta">ultimos 30 dias<\/div>/);
    assert.match(extrairFuncao('loadVisitas'), /last=30&unit=day|visitasDaSelecao\(30\)/);
  });
});

describe('periodo global preservado', () => {
  test('9. publicidade: custo do periodo exato (A4)', () => {
    assert.match(extrairFuncao('renderKPIsPeriodo'), /const _pub = publicidadeDoPeriodo\(_gPub\.from, _gPub\.toEfetivo\);/);
    assert.match(extrairFuncao('rotuloFontePublicidade'), /parcial hoje/);
    assert.ok(!/extrapol|estimad|\/dia/i.test(extrairFuncao('rotuloFontePublicidade') + extrairFuncao('textoPublicidadeIndisponivel')));
  });

  test('10. cancelamentos: periodo global (A5)', () => {
    assert.match(extrairFuncao('renderCancelamentos'), /cancelamentoOperacional\(g\.from, g\.toEfetivo, \{ canal: 'ml' \}\)/);
    assert.match(extrairFuncao('renderPedidosKPIs'), /cancelamentoOperacional\(_gCanc\.from, _gCanc\.toEfetivo\)/);
  });

  test('11. formulas intactas: receita, margem, estoque, giro, publicidade', () => {
    assert.match(extrairFuncao('renderMargem'), /const totMargem = T\.margem - totPub;/);
    assert.match(extrairFuncao('grBuildData'), /const mediaReal = semanasDecorridas > 0 \? v\.totalQty \/ semanasDecorridas : 0;/);
    assert.match(extrairFuncao('estGetSKUData'), /dias = vel > 0 \? Math\.round\(est \/ vel\) : 9999;/);
    assert.match(extrairFuncao('calcLiquidoPeriodo'), /metricsDoPeriodo/);
    assert.match(extrairFuncao('publicidadeDoPeriodo'), /a\.de === fromYmd && a\.ate === toYmd/);
  });
});

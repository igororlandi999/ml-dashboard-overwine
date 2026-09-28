/**
 * Filtro GLOBAL de periodo (globalDateRange).
 *
 * Duas coisas travadas aqui:
 *  1. NAO existe mais filtro de data local em aba nenhuma: o unico par de
 *     <input type="date"> do arquivo e o "Personalizado" do filtro global, e
 *     Mes/Ano da Previsao sumiram. Ler o fonte e o jeito de garantir que
 *     ninguem re-introduz um seletor por aba.
 *  2. As funcoes puras do filtro (presets, rotulo, meses no intervalo) e a
 *     previsao generalizada (pvCalc sobre um intervalo qualquer) fazem a conta
 *     certa — executadas, com relogio e pedidos falsos.
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
  const ini = html.slice(achado - 6, achado) === 'async ' ? achado - 6 : achado;
  const i = html.indexOf('{', ini);
  let nivel = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    else if (html[j] === '}') { nivel--; if (nivel === 0) return html.slice(ini, j + 1); }
  }
  throw new Error('funcao ' + nome + ' nao fecha');
}
function extrairConstante(nome) {
  const m = html.match(new RegExp('const ' + nome + ' = ([^;]+);'));
  assert.ok(m, 'constante ' + nome + ' nao encontrada');
  return m[0];
}

/** Sandbox com as funcoes puras do filtro global e os helpers de data. */
function montarGdr({ hoje = '2026-09-28', preset = 'mes_atual', customDe, customAte, allOrders = [] } = {}) {
  const fonte = [
    'let currentPeriodoDias = 7;',
    'let allOrders = _allOrders;',
    'function brtStartOfDay(ymd) { if (!ymd) return null; return new Date(ymd + "T00:00:00.000-03:00"); }',
    'function brtEndOfDay(ymd) { if (!ymd) return null; return new Date(ymd + "T23:59:59.999-03:00"); }',
    'function ymdBRT(date) { const d = (date instanceof Date) ? date : new Date(date); return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); }',
    'function hojeBRT() { return _hoje; }',
    extrairConstante('MESES_GDR'),
    extrairConstante('globalDateRange'),
    extrairFuncao('gdrUltimoDia'),
    extrairFuncao('gdrYmd'),
    extrairFuncao('gdrDiasEntre'),
    extrairFuncao('gdrCalcularRange'),
    extrairFuncao('gdrRotulo'),
    extrairFuncao('gdrMesesNoIntervalo'),
    extrairFuncao('gdrGet'),
    extrairFuncao('gdrAtualizarRotulos'),
    extrairFuncao('gdrDefinir'),
    extrairFuncao('pvGroupByDay'),
    extrairFuncao('pvCalc'),
    'gdrDefinir(_preset, _de, _ate);',
    'return { gdrGet, gdrCalcularRange, gdrRotulo, gdrMesesNoIntervalo, gdrDefinir, pvCalc, estado: () => globalDateRange, dias: () => currentPeriodoDias };',
  ].join('\n');
  const doc = { getElementById: () => null, querySelectorAll: () => [] };
  return new Function('_hoje', '_preset', '_de', '_ate', '_allOrders', 'document', fonte)(hoje, preset, customDe, customAte, allOrders, doc);
}

describe('regra principal — nenhum filtro de data local sobrou', () => {
  test('o unico par de <input type="date"> e o Personalizado do filtro global', () => {
    const inputs = [...html.matchAll(/<input[^>]*type="date"[^>]*>/g)].map(m => m[0]);
    assert.equal(inputs.length, 2, inputs.join('\n'));
    assert.ok(inputs.every(i => /id="gdr-(de|ate)"/.test(i)));
  });

  test('ids dos filtros locais antigos nao existem mais', () => {
    for (const id of ['periodo-de', 'periodo-ate', 'ord-data-de', 'ord-data-ate', 'tp-data-de', 'tp-data-ate',
      'mg-date-de', 'mg-date-ate', 'mg-btn-7', 'mg-custom-range', 'ap-data-de', 'ap-data-ate', 'gr-inicio', 'gr-fim', 'pv-mes', 'pv-ano']) {
      assert.ok(!html.includes('id="' + id + '"'), id + ' ainda existe');
    }
  });

  test('funcoes dos filtros locais foram removidas, nao escondidas', () => {
    for (const fn of ['aplicarPeriodoCustom', 'applyOrdDateFilter', 'clearOrdDateFilter', 'clearTpDateFilter',
      'setMgPeriodo', 'toggleMgCustom', 'applyMgCustom', 'apLimparPeriodo']) {
      assert.ok(!html.includes('function ' + fn + '('), fn + ' ainda existe');
    }
  });

  test('Previsao de Vendas: so a Meta mensal continua editavel', () => {
    assert.ok(html.includes('id="pv-meta"'));
    assert.ok(!/id="pv-mes"|id="pv-ano"/.test(html));
    assert.ok(!extrairFuncao('renderPrevisao').includes('pv-mes'));
  });

  test('o filtro global vive na barra de secoes', () => {
    const nav = html.slice(html.indexOf('<nav class="section-nav"'), html.indexOf('</nav>'));
    assert.ok(nav.includes('id="gdr-preset"'));
    assert.ok(nav.includes("switchSection('financeiro')"), 'na mesma linha das secoes');
  });

  test('cada aba adaptada le gdrGet(), a fonte unica', () => {
    for (const fn of ['getFilteredOrders', 'renderTipoPedido', 'getMgDateRange', 'apColetarVendas', 'pvCalc', 'grBuildData', 'loadAll', 'carregarSecundariosEmSegundoPlano', 'calcLiquidoPeriodo']) {
      assert.ok(extrairFuncao(fn).includes('gdrGet()'), fn + ' nao consulta gdrGet()');
    }
  });

  test('trocar o periodo re-renderiza a aba ativa, e so ela', () => {
    const f = extrairFuncao('gdrRerenderAbaAtiva');
    for (const aba of ['pedidos', 'tipopedido', 'margem', 'analisepreco', 'previsao', 'giro']) assert.ok(f.includes("'" + aba + "'"), aba);
    assert.ok(extrairFuncao('gdrAplicar').includes('aplicarPeriodoGlobal()'));
    assert.ok(extrairFuncao('gdrAplicar').includes('gdrRerenderAbaAtiva()'));
  });

  test('o padrao ao abrir e MES ATUAL, definido antes da carga', () => {
    assert.match(extrairFuncao('gdrInit'), /gdrDefinir\('mes_atual'\)/);
    assert.ok(html.includes('gdrInit();'));
  });
});

describe('presets — a conta de cada periodo', () => {
  test('mes atual: do dia 1 ao ultimo dia do mes', () => {
    const g = montarGdr({ hoje: '2026-09-28' }).gdrGet();
    assert.equal(g.from, '2026-09-01');
    assert.equal(g.to, '2026-09-30');
    assert.equal(g.toEfetivo, '2026-09-28', 'para API, nunca passa de hoje');
    assert.equal(g.dias, 28);
    assert.equal(g.diasCalendario, 30);
    assert.equal(g.label, 'Setembro 2026');
  });

  test('outro mes: fevereiro bissexto', () => {
    const g = montarGdr({ hoje: '2026-09-28', preset: 'mes:2024-02' }).gdrGet();
    assert.equal(g.from, '2024-02-01');
    assert.equal(g.to, '2024-02-29');
    assert.equal(g.toEfetivo, '2024-02-29');
    assert.equal(g.label, 'Fevereiro 2024');
  });

  test('ultimos 3 meses: do dia 1 de dois meses atras ate hoje, virando o ano', () => {
    const g = montarGdr({ hoje: '2026-01-15', preset: 'ultimos:3' }).gdrGet();
    assert.equal(g.from, '2025-11-01');
    assert.equal(g.to, '2026-01-15');
    assert.equal(g.label, 'Últimos 3 meses');
  });

  test('ano inteiro', () => {
    const g = montarGdr({ hoje: '2026-09-28', preset: 'ano:2026' }).gdrGet();
    assert.equal(g.from, '2026-01-01');
    assert.equal(g.to, '2026-12-31');
    assert.equal(g.toEfetivo, '2026-09-28');
    assert.equal(g.label, 'Ano 2026');
  });

  test('personalizado valido e invalido', () => {
    const ok = montarGdr({ preset: 'custom', customDe: '2026-08-10', customAte: '2026-08-20' }).gdrGet();
    assert.equal(ok.from, '2026-08-10'); assert.equal(ok.to, '2026-08-20');
    assert.equal(ok.label, '10/08/26 a 20/08/26');
    const ruim = montarGdr({ preset: 'custom', customDe: '2026-08-20', customAte: '2026-08-10' });
    assert.equal(ruim.estado().preset, 'mes_atual', 'intervalo invertido cai no padrao');
  });

  test('currentPeriodoDias acompanha o periodo (dias decorridos)', () => {
    const a = montarGdr({ hoje: '2026-09-28', preset: 'mes_atual' });
    assert.equal(a.dias(), 28);
    a.gdrDefinir('ultimos:3');
    assert.equal(a.dias(), 31 + 31 + 28); // jul + ago + 28 dias de set
  });

  test('meses no intervalo: mes inteiro = 1 exato, ano = 12, fracao proporcional', () => {
    const g = montarGdr();
    assert.equal(g.gdrMesesNoIntervalo('2026-09-01', '2026-09-30'), 1);
    assert.equal(g.gdrMesesNoIntervalo('2026-01-01', '2026-12-31'), 12);
    assert.ok(Math.abs(g.gdrMesesNoIntervalo('2026-09-01', '2026-09-15') - 0.5) < 1e-9);
    assert.ok(Math.abs(g.gdrMesesNoIntervalo('2026-07-01', '2026-09-28') - (2 + 28 / 30)) < 1e-9);
  });
});

describe('Previsao de Vendas sobre o periodo global', () => {
  const pedido = (ymd, valor) => ({ status: 'paid', date_created: ymd + 'T12:00:00.000-03:00', paid_amount: valor });

  test('mes atual: identico ao antigo Mes/Ano — meta mensal inteira, dias do mes, dia de hoje', () => {
    const g = montarGdr({ hoje: '2026-09-10', allOrders: [pedido('2026-09-01', 1000), pedido('2026-09-10', 500), pedido('2026-08-31', 999)] });
    const c = g.pvCalc(30000);
    assert.equal(c.diasDoMes, 30);
    assert.equal(c.diaAtual, 10);
    assert.equal(c.metaPeriodo, 30000);
    assert.equal(c.metaDiariaIdeal, 1000);
    assert.equal(c.vendidoAcumulado, 1500, 'agosto fica de fora');
    assert.equal(c.mediaDiariaAtual, 150);
    assert.equal(c.projecaoFinal, 4500);
    assert.equal(c.datas[1], '2026-09-01');
    assert.equal(c.datas[10], '2026-09-10');
  });

  test('ano inteiro: meta x12, 365 dias, dias decorridos ate hoje', () => {
    const g = montarGdr({ hoje: '2026-09-28', preset: 'ano:2026', allOrders: [pedido('2026-01-05', 100), pedido('2026-09-28', 200)] });
    const c = g.pvCalc(10000);
    assert.equal(c.metaPeriodo, 120000);
    assert.equal(c.diasDoMes, 365);
    assert.equal(c.diaAtual, 271);
    assert.equal(c.vendidoAcumulado, 300);
    assert.equal(c.porDia[5], 100);
    assert.equal(c.porDia[271], 200);
  });

  test('ultimos 3 meses: meta proporcional aos meses e fracao do mes corrente', () => {
    const g = montarGdr({ hoje: '2026-09-28', preset: 'ultimos:3', allOrders: [] });
    const c = g.pvCalc(30000);
    assert.ok(Math.abs(c.mesesNoIntervalo - (2 + 28 / 30)) < 1e-9);
    assert.ok(Math.abs(c.metaPeriodo - 30000 * (2 + 28 / 30)) < 1e-6);
    assert.equal(c.diasDoMes, 31 + 31 + 28);
    assert.equal(c.diaAtual, c.diasDoMes, 'termina hoje: tudo decorrido');
  });

  test('mes passado inteiro decorrido; mes futuro nada decorrido', () => {
    const passado = montarGdr({ hoje: '2026-09-28', preset: 'mes:2026-08' }).pvCalc(1000);
    assert.equal(passado.diaAtual, 31); assert.equal(passado.diasRestantes, 0); assert.equal(passado.ehFuturo, false);
    const futuro = montarGdr({ hoje: '2026-09-28', preset: 'mes:2026-10' }).pvCalc(1000);
    assert.equal(futuro.diaAtual, 0); assert.equal(futuro.ehFuturo, true);
  });
});

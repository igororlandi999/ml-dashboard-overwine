/**
 * Aba Expedicao — regras puras (pacote, grupo do dia, contagem incompleta).
 *
 * Travado aqui:
 *  - pacote = id do envio: pedidos do mesmo carrinho contam UMA vez;
 *  - Full, Amazon e cancelado ficam fora; o mesmo envio em duas contas nao se mistura;
 *  - liberacao (programado), prazo de postagem e despacho real nunca se misturam;
 *  - dia em horario de Brasilia;
 *  - nunca "0 a enviar" quando ha pendente sem prazo ou sem resposta.
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

const m = new Function([
  'function ymdBRT(date) { const d = (date instanceof Date) ? date : new Date(date); return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); }',
  extrairFuncao('pedidoAmazon'),
  extrairFuncao('pedidoCancelado'),
  extrairFuncao('expMontarPacotes'),
  extrairFuncao('expGrupo'),
  extrairFuncao('expResumo'),
  extrairFuncao('expValorCard'),
  extrairFuncao('expDiaCurto'),
  extrairFuncao('expPrazoTexto'),
  extrairFuncao('expDistancia'),
  extrairFuncao('expOrdenarFila'),
  extrairFuncao('expMontarLotes'),
  extrairFuncao('expDividirProgramados'),
  extrairFuncao('expFonteDespacho'),
  'return { expMontarPacotes, expGrupo, expResumo, expValorCard, expDiaCurto, expPrazoTexto, expDistancia, expOrdenarFila, expMontarLotes, expDividirProgramados, expFonteDespacho };',
].join('\n'))();

const HOJE = '2026-10-21';
const ped = (id, sid, extra = {}) => ({
  id, status: 'paid', date_created: '2026-10-20T10:00:00.000-03:00', shipping: { id: sid, logistic_type: null },
  order_items: [{ quantity: 1, item: { id: 'MLB1', title: 'Arcos do Convento 750ml', variation_id: null } }], ...extra,
});

describe('pacotes', () => {
  test('pedidos do mesmo envio viram UM pacote, com itens somados', () => {
    const p = m.expMontarPacotes([
      ped(1, 900), ped(2, 900, { order_items: [{ quantity: 2, item: { id: 'MLB1', title: 'Arcos do Convento 750ml' } }] }), ped(3, 901),
    ], {}, '2026-09-21', 'overwine-ml');
    assert.deepEqual(Object.keys(p).sort(), ['overwine-ml|900', 'overwine-ml|901']);
    assert.deepEqual(p['overwine-ml|900'].pedidos, ['1', '2']);
    assert.equal(Object.values(p['overwine-ml|900'].itens)[0].qtd, 3);
  });

  test('Full (mapa ou pedido), Amazon, cancelado, sem envio e fora da janela ficam fora', () => {
    const p = m.expMontarPacotes([
      ped(1, 900),
      ped(2, 901),                                                       // Full pelo mapa
      ped(3, 902, { shipping: { id: 902, logistic_type: 'fulfillment' } }), // Full no pedido
      { id: 'A1', canal: 'amazon', status: 'amazon:unshipped', date_created: '2026-10-20T10:00:00Z' },
      ped(4, 903, { status: 'cancelled' }),
      ped(5, null, { shipping: null }),
      ped(6, 904, { date_created: '2026-08-01T10:00:00.000-03:00' }),
    ], { '901': 'fulfillment' }, '2026-09-21', 'overwine-ml');
    assert.deepEqual(Object.keys(p), ['overwine-ml|900']);
  });

  test('pedido antigo (60 dias) ainda aberto entra na janela de 90 dias; e fica visivel como vencido/atrasado em qualquer dia', () => {
    const p = m.expMontarPacotes([ped(1, 950, { date_created: '2026-08-22T10:00:00.000-03:00' })], {}, '2026-07-23', 'overwine-ml');
    assert.ok(p['overwine-ml|950']);
    const vencido = { situacao: 'pendente', prazoPostagem: '2026-08-25', atrasoML: 'nao_indicado' };
    const confirmado = { situacao: 'pendente', prazoPostagem: '2026-08-25', atrasoML: 'confirmado' };
    for (const dia of [HOJE, '2026-10-22']) {
      assert.equal(m.expGrupo(vencido, dia, HOJE), 'prazo_vencido');
      assert.equal(m.expGrupo(confirmado, dia, HOJE), 'atrasado');
      assert.equal(m.expGrupo({ situacao: 'programado', liberacaoEm: '2026-08-30' }, dia, HOJE), 'programado');
    }
  });

  test('logistica desconhecida no mapa entra para consulta (o backend diz se e Full)', () => {
    const p = m.expMontarPacotes([ped(1, 905)], { '999': 'fulfillment' }, '2026-09-21', 'overwine-ml');
    assert.ok(p['overwine-ml|905']);
  });

  test('o mesmo numero de envio em duas contas nao se mistura', () => {
    const p = m.expMontarPacotes([ped(1, 900, { conta: 'overwine-ml' }), ped(2, 900, { conta: 'degustar-ml' })], {}, '2026-09-21', 'overwine-ml');
    assert.deepEqual(Object.keys(p).sort(), ['degustar-ml|900', 'overwine-ml|900']);
  });
});

describe('grupo do dia — tres datas separadas', () => {
  const e = (o) => ({ situacao: 'pendente', prazoPostagem: null, liberacaoEm: null, despachadoEm: null, ...o });

  test('pendente: prazo == dia → a enviar; < hoje → PRAZO VENCIDO (nao atraso); sem prazo → sem_prazo', () => {
    assert.equal(m.expGrupo(e({ prazoPostagem: HOJE }), HOJE, HOJE), 'a_enviar');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-22' }), '2026-10-22', HOJE), 'a_enviar');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-22' }), HOJE, HOJE), 'pendente_outro_dia');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-20' }), HOJE, HOJE), 'prazo_vencido');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-20', atrasoML: 'nao_indicado' }), '2026-10-25', HOJE), 'prazo_vencido');
    assert.equal(m.expGrupo(e({}), HOJE, HOJE), 'sem_prazo');
  });

  test('atrasado SO quando o Mercado Livre confirma (/delays); caso real dos 4 pedidos com SLA 20/10 12:30', () => {
    const vencido = (atrasoML) => e({ prazoPostagem: '2026-10-20', prazoLimiteEm: '2026-10-20T12:30:00.000-03:00', slaStatus: 'on_time', atrasoML });
    assert.equal(m.expGrupo(vencido('nao_indicado'), HOJE, HOJE), 'prazo_vencido');
    assert.equal(m.expGrupo(vencido(null), HOJE, HOJE), 'prazo_vencido');
    assert.equal(m.expGrupo(vencido('confirmado'), HOJE, HOJE), 'atrasado');
    assert.equal(m.expGrupo(vencido('confirmado'), '2026-10-25', HOJE), 'atrasado');
  });

  test('programado: a liberacao NUNCA vira prazo nem atraso', () => {
    const p = e({ situacao: 'programado', liberacaoEm: '2026-10-20' }); // liberacao no passado
    for (const dia of ['2026-10-20', HOJE, '2026-10-23']) assert.equal(m.expGrupo(p, dia, HOJE), 'programado');
  });

  test('despachado: dia do despacho REAL em Brasilia, nao em UTC', () => {
    // 01:30 UTC de 21/10 = 22:30 de 20/10 em Brasilia
    const d = e({ situacao: 'despachado', despachadoEm: '2026-10-21T01:30:00.000Z', prazoPostagem: '2026-10-21' });
    assert.equal(m.expGrupo(d, '2026-10-20', HOJE), 'despachado');
    assert.equal(m.expGrupo(d, HOJE, HOJE), 'despachado_outro_dia');
    assert.equal(m.expGrupo(e({ situacao: 'despachado' }), HOJE, HOJE), 'bipado_sem_horario');
  });

  test('Full/cancelado fora; sem resposta = consultando; outro/indisponivel = nao classificado', () => {
    assert.equal(m.expGrupo(e({ situacao: 'full' }), HOJE, HOJE), 'fora');
    assert.equal(m.expGrupo(e({ situacao: 'cancelado' }), HOJE, HOJE), 'fora');
    assert.equal(m.expGrupo(undefined, HOJE, HOJE), 'consultando');
    assert.equal(m.expGrupo(e({ situacao: 'aguardando' }), HOJE, HOJE), 'consultando');
    assert.equal(m.expGrupo(e({ situacao: 'outro' }), HOJE, HOJE), 'nao_classificado');
    assert.equal(m.expGrupo(e({ situacao: 'indisponivel' }), HOJE, HOJE), 'nao_classificado');
  });
});

describe('contagem — ausente nao e zero', () => {
  const pac = (...ks) => Object.fromEntries(ks.map(k => [k, { chave: k }]));

  test('zero a enviar com pendente sem prazo: incompleto, card mostra "?"', () => {
    const r = m.expResumo(pac('a', 'b'), { a: { situacao: 'pendente', prazoPostagem: null }, b: { situacao: 'programado', liberacaoEm: '2026-10-23' } }, HOJE, HOJE);
    assert.equal(r.a_enviar, 0);
    assert.equal(r.sem_prazo, 1);
    assert.equal(r.programado, 1);
    assert.equal(r.aEnviarIncompleto, true);
    assert.equal(m.expValorCard(r.a_enviar, r.aEnviarIncompleto), '?');
  });

  test('envio sem resposta tambem deixa o dia incompleto; com algum confirmado mostra "≥ n"', () => {
    const r = m.expResumo(pac('a', 'b'), { a: { situacao: 'pendente', prazoPostagem: HOJE } }, HOJE, HOJE);
    assert.equal(r.a_enviar, 1);
    assert.equal(r.consultando, 1);
    assert.equal(m.expValorCard(r.a_enviar, r.aEnviarIncompleto), '≥ 1');
  });

  test('tudo respondido e com prazo: numero exato, inclusive zero', () => {
    const r = m.expResumo(pac('a'), { a: { situacao: 'pendente', prazoPostagem: '2026-10-24' } }, HOJE, HOJE);
    assert.equal(r.aEnviarIncompleto, false);
    assert.equal(m.expValorCard(r.a_enviar, r.aEnviarIncompleto), '0');
  });

  test('pacote com 3 pedidos conta 1; atrasados e despachados separados', () => {
    const r = m.expResumo(pac('a', 'b', 'c'), {
      a: { situacao: 'pendente', prazoPostagem: '2026-10-19' },
      b: { situacao: 'despachado', despachadoEm: '2026-10-21T15:00:00.000-03:00' },
      c: { situacao: 'pendente', prazoPostagem: HOJE },
    }, HOJE, HOJE);
    assert.deepEqual([r.atrasado, r.prazo_vencido, r.despachado, r.a_enviar, r.total], [0, 1, 1, 1, 2]);
    // O ML nao respondeu sobre o vencido: o numero de atrasos confirmados nao pode ser afirmado.
    assert.equal(r.atrasadoIncompleto, true);
    assert.equal(m.expValorCard(r.atrasado, r.atrasadoIncompleto), '?');
  });

  test('bipado sem horario e sem limite: nunca contado como bipado no dia, e o dia fica incompleto', () => {
    const env = { a: { situacao: 'despachado', status: 'delivered', despachadoEm: null, despachoFonte: 'evento_posterior', bipagemAte: null } };
    for (const dia of ['2026-10-20', HOJE]) {
      const r = m.expResumo(pac('a'), env, dia, HOJE);
      assert.deepEqual([r.despachado, r.atrasado, r.a_enviar, r.prazo_vencido, r.bipado_sem_horario], [0, 0, 0, 0, 1], dia);
      assert.equal(r.despachadoIncompleto, true);
      assert.equal(m.expValorCard(r.despachado, r.despachadoIncompleto), '?');
    }
  });

  test('bipado sem horario com limite: aparece (sem contar) so no dia do registro posterior; antes/depois nao', () => {
    const env = { a: { situacao: 'despachado', despachadoEm: null, despachoFonte: 'evento_posterior', bipagemAte: '2026-10-21T09:00:00.000-04:00' } };
    const r21 = m.expResumo(pac('a'), env, '2026-10-21', HOJE);
    assert.deepEqual([r21.despachado, r21.bipado_sem_horario, r21.despachadoIncompleto], [0, 1, true]);
    const r20 = m.expResumo(pac('a'), env, '2026-10-20', HOJE);
    assert.deepEqual([r20.despachado, r20.bipado_sem_horario, r20.prazo_vencido, r20.despachadoIncompleto], [0, 0, 0, false]);
  });

  test('dia passado: nada "a enviar" (pendencias sao atrasos), sem falso incompleto em A enviar', () => {
    const r = m.expResumo(pac('a'), { a: { situacao: 'pendente', prazoPostagem: '2026-10-19' } }, '2026-10-19', HOJE);
    assert.equal(r.a_enviar, 0);
    assert.equal(r.prazo_vencido, 1);
    assert.equal(r.atrasado, 0);
    assert.equal(r.aEnviarIncompleto, false);
  });

  test('prazo exibido com o horario-limite do SLA em Brasilia; sem horario, so a data', () => {
    assert.match(m.expPrazoTexto({ prazoPostagem: '2026-10-21', prazoLimiteEm: '2026-10-21T23:59:59.000-03:00' }), /21\/10.*23:59/);
    // 02:59 UTC de 22/10 = 23:59 de 21/10 em Brasilia
    assert.match(m.expPrazoTexto({ prazoPostagem: '2026-10-21', prazoLimiteEm: '2026-10-22T02:59:00.000Z' }), /21\/10.*23:59/);
    assert.equal(m.expPrazoTexto({ prazoPostagem: '2026-10-21', prazoLimiteEm: null }), '21/10');
  });

  test('dia civil do prazo exibido sem fuso', () => {
    assert.equal(m.expDiaCurto('2026-10-23'), '23/10');
    assert.equal(m.expDiaCurto(null), '-');
  });
});

describe('fila priorizada', () => {
  test('os pedidos mais proximos do dia em vista vao primeiro; finais ficam fora da fila', () => {
    const p = (chave, data) => ({ chave, compraMaisAntiga: data });
    const pacotes = {
      velho: p('velho', '2026-09-25T10:00:00.000-03:00'),
      ontem: p('ontem', '2026-10-20T18:00:00.000-03:00'),
      hoje: p('hoje', '2026-10-21T08:00:00.000-03:00'),
      final: p('final', '2026-10-21T09:00:00.000-03:00'),
    };
    const envios = { final: { situacao: 'despachado', despachadoEm: '2026-10-21T10:00:00.000-03:00' } };
    const ehFinal = (x) => !!x && x.situacao === 'despachado' && !!x.despachadoEm;
    assert.deepEqual(m.expOrdenarFila(pacotes, envios, HOJE, ehFinal).map(x => x.chave), ['hoje', 'ontem', 'velho']);
    // Para um dia passado, os pedidos daquele dia vem antes dos de hoje.
    assert.deepEqual(m.expOrdenarFila(pacotes, envios, '2026-09-25', ehFinal).map(x => x.chave), ['velho', 'ontem', 'hoje']);
  });

  test('lotes de ate 50 por conta, na ordem da fila, sem misturar contas', () => {
    const fila = [];
    for (let i = 0; i < 53; i++) fila.push({ conta: 'overwine-ml', envio: String(1000 + i) });
    fila.splice(10, 0, { conta: 'degustar-ml', envio: '9000' });
    const lotes = m.expMontarLotes(fila, 50);
    assert.deepEqual(lotes.map(l => [l.conta, l.ids.length]), [['overwine-ml', 50], ['degustar-ml', 1], ['overwine-ml', 3]]);
    assert.equal(lotes[0].ids[0], '1000');
  });
});

describe('despacho = postagem na agencia (dropped_off), dias 19 a 23/10', () => {
  // Saida do backend para os envios reais: despachadoEm = dropped_off em -04:00.
  const desp = (iso, fonte = 'agencia', substatus = 'in_packing_list') =>
    ({ situacao: 'despachado', status: 'ready_to_ship', substatus, despachadoEm: iso, despachoFonte: fonte, prazoPostagem: null, liberacaoEm: null });
  const reais = {
    '48276931841': desp('2026-10-21T11:13:53.000-04:00'),
    '48288871607': desp('2026-10-20T11:18:10.000-04:00', 'agencia', 'in_hub'),
    '48282048911': desp('2026-10-20T11:18:12.000-04:00', 'agencia', null),
    '48281437716': desp('2026-10-20T11:18:14.000-04:00', 'agencia', 'picked_up'),
    '48279810057': desp('2026-10-20T11:18:16.000-04:00', 'agencia', null),
    '48265507555': desp('2026-10-19T11:20:05.000-04:00', 'agencia', 'in_hub'),
    '48263520283': desp('2026-10-21T11:13:40.000-04:00'),
  };
  const esperado = {
    '2026-10-19': ['48265507555'],
    '2026-10-20': ['48279810057', '48281437716', '48282048911', '48288871607'],
    '2026-10-21': ['48263520283', '48276931841'],
    '2026-10-22': [],
    '2026-10-23': [],
  };
  for (const [dia, ids] of Object.entries(esperado)) {
    test('despachados em ' + dia + ': ' + (ids.join(', ') || 'nenhum destes'), () => {
      const doDia = Object.keys(reais).filter(id => m.expGrupo(reais[id], dia, '2026-10-22') === 'despachado').sort();
      assert.deepEqual(doDia, ids);
    });
  }

  test('in_packing_list despachado nunca cai em prazo vencido nem em a enviar', () => {
    for (const dia of Object.keys(esperado)) {
      const g = m.expGrupo(reais['48276931841'], dia, '2026-10-22');
      assert.ok(g === 'despachado' || g === 'despachado_outro_dia', dia + ': ' + g);
    }
  });

  test('evidencia da bipagem: horario confirmado x indisponivel', () => {
    assert.equal(m.expFonteDespacho({ despachoFonte: 'agencia' }), 'horário confirmado pela agência');
    assert.equal(m.expFonteDespacho({ despachoFonte: 'coleta' }), 'horário confirmado na coleta');
    assert.equal(m.expFonteDespacho({ despachoFonte: 'evento_posterior' }), 'horário da bipagem indisponível');
    assert.equal(m.expFonteDespacho({}), '');
    assert.equal(m.expFonteDespacho(undefined), '');
  });
});

describe('programados: liberam na data x proximas liberacoes', () => {
  const item = (envio, liberacaoEm, pedidos = [envio], compra = '2026-10-20T10:00:00.000-03:00') =>
    ({ p: { envio, pedidos, compraMaisAntiga: compra, itens: {} }, e: { situacao: 'programado', liberacaoEm, prazoPostagem: null }, g: 'programado' });

  test('48315271920 (2 pedidos, libera 27/10) NUNCA aparece como liberando em 23/10', () => {
    const itens = [item('48315271920', '2026-10-27', ['2000019100000001', '2000019100000002']), item('A', '2026-10-23'), item('B', '2026-10-24')];
    const r = m.expDividirProgramados(itens, '2026-10-23');
    assert.deepEqual(r.naData.map(x => x.p.envio), ['A']);
    assert.deepEqual(r.proximas.map(x => x.p.envio), ['B', '48315271920']);
    // O pacote segue UM item, com os dois pedidos.
    assert.equal(r.proximas[1].p.pedidos.length, 2);
    const r27 = m.expDividirProgramados(itens, '2026-10-27');
    assert.deepEqual(r27.naData.map(x => x.p.envio), ['48315271920']);
  });

  test('proximas em ordem cronologica de liberacao; sem liberacao informada por ultimo', () => {
    const itens = [item('C', null), item('D', '2026-10-30'), item('E', '2026-10-25'), item('F', '2026-10-21')];
    const r = m.expDividirProgramados(itens, '2026-10-23');
    assert.deepEqual(r.naData, []);
    assert.deepEqual(r.proximas.map(x => x.p.envio), ['F', 'E', 'D', 'C']);
  });

  test('nenhum programado e perdido nem duplicado na divisao', () => {
    const itens = [item('1', '2026-10-23'), item('2', '2026-10-23'), item('3', '2026-10-24'), item('4', null)];
    const r = m.expDividirProgramados(itens, '2026-10-23');
    assert.equal(r.naData.length + r.proximas.length, itens.length);
    assert.equal(new Set([...r.naData, ...r.proximas].map(x => x.p.envio)).size, itens.length);
  });
});

describe('pedido 2000019019653362 e os 6 pacotes antigos', () => {
  const bip = (iso) => ({ situacao: 'despachado', substatus: 'in_packing_list', despachadoEm: iso, despachoFonte: 'agencia', prazoPostagem: null, atrasoML: null });
  test('bipado: nunca Prazo vencido, Atrasados ou A enviar, em nenhum dia de 19 a 23/10', () => {
    // Saida do backend para o envio do pedido (in_packing_list, SLA vencido 20/10, dropped_off 21/10 12:13 BRT).
    const e = bip('2026-10-21T11:13:00.000-04:00');
    for (const dia of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) {
      const g = m.expGrupo(e, dia, '2026-10-22');
      assert.ok(g === 'despachado' || g === 'despachado_outro_dia', dia + ': ' + g);
    }
    assert.equal(m.expGrupo(e, '2026-10-21', '2026-10-22'), 'despachado');
  });

  test('os 6 pacotes antigos nao aparecem em Ja bipados de 22/10', () => {
    const env = {
      a: bip('2026-10-20T11:18:10.000-04:00'), b: bip('2026-10-20T11:18:12.000-04:00'), c: bip('2026-10-20T11:18:14.000-04:00'),
      d: bip('2026-10-20T11:18:16.000-04:00'), e: bip('2026-10-21T11:13:53.000-04:00'), f: bip('2026-10-21T11:13:40.000-04:00'),
    };
    const pacs = Object.fromEntries(Object.keys(env).map(k => [k, { conta: 'overwine-ml', envio: k, pedidos: [k], itens: {}, compraMaisAntiga: '2026-10-18T10:00:00.000-03:00' }]));
    assert.equal(m.expResumo(pacs, env, '2026-10-22', '2026-10-22').despachado, 0);
    assert.equal(m.expResumo(pacs, env, '2026-10-20', '2026-10-22').despachado, 4);
    assert.equal(m.expResumo(pacs, env, '2026-10-21', '2026-10-22').despachado, 2);
  });

  test('a interface diz "Ja bipados", nunca "Despachados"', () => {
    const ini = html.indexOf('const EXP_JANELA_DIAS'), fim = html.indexOf('const TAB_SECTION_MAP');
    const bloco = html.slice(ini, fim);
    // So textos exibidos (entre aspas simples); nomes internos de grupo continuam.
    const textos = bloco.match(/'[^'\n]*'/g).join(' ');
    assert.doesNotMatch(textos, /Despachad|despachad[oa]s? (nesta|em|sem)/);
    assert.match(textos, /Já bipados/);
    assert.match(textos, /Já bipado/);
  });
});

describe('"A enviar" intocado', () => {
  test('regra do grupo e cartao de a enviar seguem identicos', () => {
    assert.ok(html.includes("return e.prazoPostagem === dia ? 'a_enviar' : 'pendente_outro_dia';"));
    assert.ok(html.includes(`if (g === 'a_enviar') { data = '<span class="exp-data">Postar até ' + expPrazoTexto(e) + '</span>'; badge = '<span class="badge ouro">A enviar</span>'; }`));
    assert.ok(html.includes("['a_enviar', 'A enviar', 'prazo oficial de postagem em ' + expDiaCurto(dia), ''],"));
  });
});

describe('so leitura', () => {
  test('a aba nao tem botao nem chamada que altere pedido ou envio', () => {
    const ini = html.indexOf('<div class="tab-content" id="tab-expedicao">');
    const fim = html.indexOf('<!-- TAB: TIPO DE ANUNCIO -->');
    const marcacao = html.slice(ini, fim);
    assert.ok(ini > 0 && fim > ini);
    assert.doesNotMatch(marcacao, /method|POST|DELETE|PUT/);
    const js = extrairFuncao('expConsultar');
    assert.doesNotMatch(js, /method\s*:/);
    assert.match(js, /\/api\/ml\/expedicao-envios\?ids=/);
  });
});

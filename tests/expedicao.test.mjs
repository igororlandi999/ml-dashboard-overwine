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
  'return { expMontarPacotes, expGrupo, expResumo, expValorCard, expDiaCurto, expPrazoTexto, expDistancia, expOrdenarFila, expMontarLotes };',
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
    assert.equal(m.expGrupo(e({ situacao: 'despachado' }), HOJE, HOJE), 'despachado_sem_data');
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

  test('despachado sem data (caso real 48265507555, in_hub): nao entra em dia nenhum e o dia fica incompleto', () => {
    const env = { a: { situacao: 'despachado', status: 'ready_to_ship', substatus: 'in_hub', despachadoEm: null, prazoPostagem: '2026-10-20' } };
    for (const dia of ['2026-10-20', HOJE]) {
      const r = m.expResumo(pac('a'), env, dia, HOJE);
      assert.deepEqual([r.despachado, r.atrasado, r.a_enviar, r.despachado_sem_data], [0, 0, 0, 1], dia);
      assert.equal(r.despachadoIncompleto, true);
      assert.equal(m.expValorCard(r.despachado, r.despachadoIncompleto), '?');
    }
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

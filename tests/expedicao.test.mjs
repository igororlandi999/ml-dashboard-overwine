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
  'return { expMontarPacotes, expGrupo, expResumo, expValorCard, expDiaCurto, expPrazoTexto };',
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

  test('pendente: prazo == dia → a enviar; < hoje → atrasado (em qualquer dia); sem prazo → sem_prazo', () => {
    assert.equal(m.expGrupo(e({ prazoPostagem: HOJE }), HOJE, HOJE), 'a_enviar');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-22' }), '2026-10-22', HOJE), 'a_enviar');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-22' }), HOJE, HOJE), 'pendente_outro_dia');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-20' }), HOJE, HOJE), 'atrasado');
    assert.equal(m.expGrupo(e({ prazoPostagem: '2026-10-20' }), '2026-10-25', HOJE), 'atrasado');
    assert.equal(m.expGrupo(e({}), HOJE, HOJE), 'sem_prazo');
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
    assert.deepEqual([r.atrasado, r.despachado, r.a_enviar, r.total], [1, 1, 1, 2]);
  });

  test('dia passado: nada "a enviar" (pendencias sao atrasos), sem falso incompleto em A enviar', () => {
    const r = m.expResumo(pac('a'), { a: { situacao: 'pendente', prazoPostagem: '2026-10-19' } }, '2026-10-19', HOJE);
    assert.equal(r.a_enviar, 0);
    assert.equal(r.atrasado, 1);
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

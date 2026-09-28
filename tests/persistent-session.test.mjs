/**
 * Sessao persistente no navegador — testes de COMPORTAMENTO.
 *
 * O contrato que estes testes travam: no storage do navegador so pode existir
 * o token OPACO de sessao do dashboard, e so quando o operador pediu para
 * manter conectado. Senha e credenciais do Mercado Livre nunca. Um token que
 * o backend recusa e apagado; Sair revoga no backend e apaga aqui.
 *
 * As funcoes sao as REAIS do index.html, com storage, rede e DOM falsos.
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

/** Um Storage falso, com a mesma API que o codigo usa. */
function storageFalso() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

const TOKEN = 'sess_' + 'ab12'.repeat(16);
const SENHA = 'senha-super-secreta';

/**
 * Ambiente: window com os dois storages, backendFetch falso (login certo/errado,
 * session valida/invalida, logout), e as telas como registradores.
 */
function montar({ local = storageFalso(), session = storageFalso(), sessaoValida = true, semStorage = false } = {}) {
  const chamadas = [];
  const telas = [];
  const win = semStorage
    ? { get localStorage() { throw new Error('bloqueado'); }, get sessionStorage() { throw new Error('bloqueado'); } }
    : { localStorage: local, sessionStorage: session };

  async function backendFetch(caminho, init) {
    const body = init && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ caminho, metodo: (init && init.method) || 'GET', body });
    if (caminho === '/api/auth/login') {
      if (body.password !== SENHA) return { ok: false, status: 401, json: async () => ({ error: 'Senha incorreta.' }) };
      return { ok: true, status: 200, json: async () => ({ session_token: TOKEN, expires_at: Date.now() + 1000, persistent: body.persistent === true }) };
    }
    if (caminho === '/api/auth/session') return { ok: sessaoValida, status: sessaoValida ? 200 : 401, json: async () => ({ ok: sessaoValida }) };
    if (caminho === '/api/auth/logout') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }

  const fonte = [
    'let SESSION_TOKEN = null;',
    extrairConstante('SESSAO_STORAGE_KEY'),
    extrairFuncao('_storage'),
    extrairFuncao('_tokenValido'),
    extrairFuncao('sessaoPersistir'),
    extrairFuncao('sessaoRestaurar'),
    extrairFuncao('sessaoLimpar'),
    extrairFuncao('restaurarSessaoAoAbrir'),
    extrairFuncao('apiLogin'),
    extrairFuncao('apiLogout'),
    extrairFuncao('checkSession'),
    'function hideLoading() { _telas.push("hideLoading"); }',
    'function showLoading(m) { _telas.push("showLoading:" + m); }',
    'function showSetup() { _telas.push("showSetup"); }',
    'async function startDashboard() { _telas.push("startDashboard"); }',
    'return { apiLogin, apiLogout, restaurarSessaoAoAbrir, sessaoRestaurar, sessaoLimpar, token: () => SESSION_TOKEN, definirToken: t => { SESSION_TOKEN = t; } };',
  ].join('\n');
  const api = new Function('window', 'backendFetch', '_telas', fonte)(win, backendFetch, telas);
  return Object.assign(api, { chamadas, telas, local, session });
}

describe('login com "Manter conectado"', () => {
  test('marcado: token vai para localStorage, nunca para sessionStorage, e o backend recebe persistent:true', async () => {
    const a = montar();
    await a.apiLogin(SENHA, true);
    assert.equal(a.token(), TOKEN);
    assert.deepEqual(a.local.dump(), { ow_sessao: TOKEN });
    assert.deepEqual(a.session.dump(), {});
    assert.deepEqual(a.chamadas[0].body, { password: SENHA, persistent: true });
  });

  test('desmarcado: token so em sessionStorage, backend recebe persistent:false', async () => {
    const a = montar();
    await a.apiLogin(SENHA, false);
    assert.deepEqual(a.session.dump(), { ow_sessao: TOKEN });
    assert.deepEqual(a.local.dump(), {});
    assert.equal(a.chamadas[0].body.persistent, false);
  });

  test('trocar de marcado para desmarcado num novo login limpa o localStorage', async () => {
    const a = montar();
    await a.apiLogin(SENHA, true);
    await a.apiLogin(SENHA, false);
    assert.deepEqual(a.local.dump(), {});
    assert.deepEqual(a.session.dump(), { ow_sessao: TOKEN });
  });

  test('a SENHA nunca vai para storage nenhum', async () => {
    const a = montar();
    await a.apiLogin(SENHA, true);
    const tudo = JSON.stringify(a.local.dump()) + JSON.stringify(a.session.dump());
    assert.ok(!tudo.includes(SENHA));
    assert.ok(!/APP_USR|TG-|access_token|refresh_token|ADMIN/.test(tudo));
  });

  test('login incorreto: erro, sem token em memoria e sem NADA no storage', async () => {
    const a = montar();
    await assert.rejects(() => a.apiLogin('errada', true), /Senha incorreta/);
    assert.equal(a.token(), null);
    assert.deepEqual(a.local.dump(), {});
    assert.deepEqual(a.session.dump(), {});
  });

  test('storage bloqueado (modo privado): login funciona em memoria, sem lancar', async () => {
    const a = montar({ semStorage: true });
    await a.apiLogin(SENHA, true);
    assert.equal(a.token(), TOKEN);
  });
});

describe('abrir a pagina com sessao persistida (F5, nova aba, navegador reaberto)', () => {
  test('sessao valida em localStorage: valida no backend e entra SEM mostrar o login', async () => {
    const local = storageFalso(); local.setItem('ow_sessao', TOKEN);
    const a = montar({ local });
    const entrou = await a.restaurarSessaoAoAbrir();
    assert.equal(entrou, true);
    assert.equal(a.token(), TOKEN);
    assert.deepEqual(a.chamadas.map(c => c.caminho), ['/api/auth/session']);
    assert.deepEqual(a.telas, ['showLoading:Restaurando sessao...', 'startDashboard'], 'nunca showSetup antes de entrar');
  });

  test('sessao valida em sessionStorage (desmarcado, mesma sessao do navegador): tambem entra', async () => {
    const session = storageFalso(); session.setItem('ow_sessao', TOKEN);
    const a = montar({ session });
    assert.equal(await a.restaurarSessaoAoAbrir(), true);
    assert.ok(a.telas.includes('startDashboard'));
  });

  test('sem sessao persistida: login direto, sem chamar o backend', async () => {
    const a = montar();
    assert.equal(await a.restaurarSessaoAoAbrir(), false);
    assert.deepEqual(a.chamadas, []);
    assert.deepEqual(a.telas, ['hideLoading', 'showSetup']);
  });

  test('sessao expirada/revogada (backend 401): token apagado do storage e login mostrado', async () => {
    const local = storageFalso(); local.setItem('ow_sessao', TOKEN);
    const a = montar({ local, sessaoValida: false });
    assert.equal(await a.restaurarSessaoAoAbrir(), false);
    assert.equal(a.token(), null);
    assert.deepEqual(a.local.dump(), {});
    assert.ok(a.telas.includes('showSetup'));
    assert.ok(!a.telas.includes('startDashboard'));
  });

  test('lixo no storage (nao e um token sess_): descartado sem chamar o backend', async () => {
    const local = storageFalso(); local.setItem('ow_sessao', 'qualquer-coisa');
    const a = montar({ local });
    assert.equal(await a.restaurarSessaoAoAbrir(), false);
    assert.deepEqual(a.chamadas, []);
    assert.deepEqual(a.local.dump(), {});
  });
});

describe('Sair', () => {
  test('logout revoga no backend (com o token ainda no header) e apaga os dois storages', async () => {
    const local = storageFalso(); local.setItem('ow_sessao', TOKEN);
    const session = storageFalso(); session.setItem('ow_sessao', TOKEN);
    const a = montar({ local, session });
    a.definirToken(TOKEN);
    await a.apiLogout();
    assert.deepEqual(a.chamadas.map(c => c.caminho + ' ' + c.metodo), ['/api/auth/logout POST']);
    assert.equal(a.token(), null);
    assert.deepEqual(a.local.dump(), {});
    assert.deepEqual(a.session.dump(), {});
  });

  test('sessao expirada durante o uso (handleSessionExpired) tambem apaga o storage', () => {
    assert.match(extrairFuncao('handleSessionExpired'), /sessaoLimpar\(\)/);
  });
});

describe('contrato no fonte', () => {
  test('a tela de login tem o checkbox, marcado por padrao', () => {
    assert.match(html, /<input type="checkbox" id="viewer-keep" checked/);
    assert.match(html, /Manter conectado neste navegador/);
    assert.match(extrairFuncao('checkViewerPass'), /viewer-keep/);
  });

  test('a unica chave de storage da sessao e ow_sessao, e nada de senha/ML e escrito no storage', () => {
    const escritas = [...html.matchAll(/(localStorage|sessionStorage)\.setItem\(([^,]+),/g)].map(m => m[2].trim());
    for (const chave of escritas) assert.ok(!/senha|password|ml_token|ml_refresh|access|admin/i.test(chave), chave);
    assert.ok(!html.includes("setItem('ml_token'"));
  });

  test('a tela de carregamento e a primeira a aparecer: o login so vem se a validacao falhar', () => {
    const init = html.slice(html.indexOf("window.addEventListener('DOMContentLoaded'"));
    const corpo = init.slice(0, init.indexOf('\n    });'));
    assert.ok(!corpo.includes('showSetup()'), 'o init nao mostra o login por conta propria');
    assert.match(corpo, /restaurarSessaoAoAbrir\(\)/);
    assert.match(html, /#loading-screen \{[^}]*display: flex/, 'loading visivel desde o CSS');
    assert.match(html, /#setup-screen \{[^}]*display: none/, 'login escondido desde o CSS');
  });
});

/**
 * Retorno OAuth do Mercado Livre na URL do dashboard — teste de COMPORTAMENTO.
 *
 * Contrato: quando o dashboard e aberto como redirect_uri de uma autorizacao
 * (?code=...&state=...), a URL fica INTACTA, para o operador copiar e entregar
 * ao seed do backend. O front nunca troca o code. Sem `state` (resto do fluxo
 * antigo), o ?code= e limpo da URL.
 *
 * O bloco testado e o REAL do index.html (o que roda no DOMContentLoaded).
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

function extrairBlocoRetorno() {
  const marca = 'const qsRetorno = new URLSearchParams(window.location.search);';
  const achado = html.indexOf(marca);
  assert.notEqual(achado, -1, 'bloco de retorno OAuth nao encontrado em index.html');
  const ini = html.lastIndexOf('{', achado);
  let nivel = 0;
  for (let j = ini; j < html.length; j++) {
    if (html[j] === '{') nivel++;
    if (html[j] === '}') { nivel--; if (nivel === 0) return html.slice(ini, j + 1); }
  }
  assert.fail('bloco sem fechamento');
}

function rodar(search) {
  const chamadas = [];
  const window = {
    location: { search, pathname: '/ml-dashboard-overwine/' },
    history: { replaceState: (...a) => chamadas.push(a) },
  };
  const document = { title: 'Dashboard' };
  new Function('window', 'document', 'URLSearchParams', extrairBlocoRetorno())(window, document, URLSearchParams);
  return chamadas;
}

describe('retorno OAuth na URL do dashboard', () => {
  test('code COM state: URL fica intacta (nada e reescrito)', () => {
    assert.deepEqual(rodar('?code=TG-abc-123&state=degustar-1a2b3c'), []);
  });
  test('code SEM state (fluxo antigo): ?code= e limpo da URL', () => {
    const c = rodar('?code=TG-abc-123');
    assert.equal(c.length, 1);
    assert.equal(c[0][2], '/ml-dashboard-overwine/');
  });
  test('sem code: nada acontece', () => {
    assert.deepEqual(rodar(''), []);
    assert.deepEqual(rodar('?state=degustar-x'), []);
  });
  test('o bloco nao troca o code nem fala com o backend', () => {
    const bloco = extrairBlocoRetorno();
    assert.doesNotMatch(bloco, /fetch|XMLHttpRequest|oauth\/token|localStorage|sessionStorage/);
  });
});

# ml-dashboard-overwine

## Seleção de contas (empresa × marketplace)

Dois seletores ao lado do período: **Empresa** e **Marketplace**. Aparecem
quando o backend declara mais de uma conta conectada em
`GET /api/orders/contas`. Hoje: Overwine e Degustar, ambas no Mercado Livre, e
a visão consolidada das duas.

- **Overwine sozinha é o comportamento de sempre.** Nenhuma requisição ganha
  parâmetro e nenhuma chave de storage muda de nome.
- **Trocar de seleção recarrega a página.** A sessão, o período e a aba aberta
  atravessam a recarga; os dados em memória, não. É o que garante que nenhum
  pedido de uma empresa fique na tela da outra.
- **Resposta de seleção anterior é descartada** em `backendFetch`.
- **A seleção é da aba** (`sessionStorage`). Duas abas podem mostrar empresas
  diferentes.
- **Atualização automática por conta.** No consolidado o poll lê o status das
  duas e pede sincronização só da que estiver atrasada.

### Indisponível não é zero

Custos, tarifas médias, meta mensal, cobertura alvo de estoque, relatório de
publicidade embutido e grupos do Radar são da Overwine. Em qualquer outra
seleção esses números aparecem como **indisponível**, com o motivo — nunca
zero e nunca o valor da Overwine.

| aba | Degustar | Consolidado |
|---|---|---|
| Geral, Catálogo, Top Vendas, Estoque, Qualidade, Pedidos | dados dela | união, com a empresa marcada |
| Receita líquida e tarifas | indisponível | indisponível |
| Reputação | a dela | indisponível (é de cada vendedor) |
| Publicidade manual | campo próprio | fechado (informar por empresa) |
| Margem Real | receita real; custo e margem indisponíveis | idem, uma linha por empresa |
| Previsão de Vendas | meta a informar | meta a informar |
| Giro de Estoque | cobertura alvo a informar | cobertura alvo a informar |
| Radar | indisponível | indisponível |
| Relâmpago | em nome da Degustar | bloqueado (exige um vendedor) |
| Assistente | bloqueado, com aviso | bloqueado, com aviso |

No consolidado o mesmo SKU em duas empresas vira duas chaves
(`21003 · Overwine`, `21003 · Degustar`): estoques e vendas não se somam.

Testes: `node --test tests/*.mjs` (`tests/selecao-contas.test.mjs`).

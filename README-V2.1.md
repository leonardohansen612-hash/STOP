# Tex STOP V2.1 — Correção com IA

Esta versão precisa rodar como **Render Web Service**, não como Static Site,
porque a chave da OpenAI fica somente no servidor.

## Render
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`

## Environment Variables
- `OPENAI_API_KEY` = sua chave da OpenAI
- `OPENAI_MODEL` = opcional. Padrão: `gpt-5.6-luna`

## Fluxo
1. Jogadores respondem.
2. STOP trava a rodada.
3. Admin clica em `CORRIGIR COM IA`.
4. Vazias/fora da letra viram 0 automaticamente.
5. A IA valida se a resposta pertence à categoria.
6. Confiança >= 90% é aplicada automaticamente.
7. Confiança < 90% aparece em amarelo como `REVISAR`.
8. Respostas válidas repetidas = 5; válidas únicas = 10.
9. Admin pode alterar qualquer pontuação antes de aplicar.

A chave da OpenAI nunca deve ser colocada no JavaScript do navegador.

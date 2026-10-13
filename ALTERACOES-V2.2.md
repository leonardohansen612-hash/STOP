# Tex STOP — revisão híbrida v2.2

- IA valida automaticamente respostas com confiança >= 0,90.
- Respostas com confiança inferior a 0,90 ou sem avaliação conclusiva ficam sinalizadas para revisão manual.
- O apresentador escolhe 0, 5 ou 10 pontos nos itens sinalizados; a aplicação fica bloqueada até a revisão completa.
- Respostas são salvas em sequência e o STOP manual aguarda o salvamento final; falhas de salvamento são informadas ao jogador.
- Modelo padrão OpenAI atualizado para gpt-5-mini (pode ser substituído por OPENAI_MODEL).

## Verificações necessárias antes de publicar
- Testar com 2+ celulares e a página de administração aberta.
- Configurar OPENAI_API_KEY no servidor; conferir OPENAI_MODEL se definido.
- Confirmar o fluxo de STOP manual e STOP por tempo com respostas incompletas.
- O cronômetro ainda depende de pelo menos um cliente/admin online; não é um agendador independente no servidor.
- As regras de Firestore do projeto original estão abertas. **Não publique como ambiente seguro** sem migrar para autenticação e regras de acesso por papel. Alterá-las isoladamente interromperia os clientes atuais.
- A rota /api/ai-review ainda necessita autenticação e limitação de requisições para prevenir consumo não autorizado da API.

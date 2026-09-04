# TEX STOP — V1

Arquivos:
- `/index.html` — celular dos jogadores
- `/admin.html` — notebook do apresentador
- `/tv.html` — tela da TV
- `/firebase-config.js` — cole as credenciais do Firebase
- `/firestore.rules` — regras simples para a V1

## Firebase
1. Crie/abra um projeto Firebase.
2. Ative Firestore Database.
3. Registre um app Web.
4. Copie o objeto `firebaseConfig` para `firebase-config.js`.
5. Em Firestore > Rules, publique o conteúdo de `firestore.rules`.

> Atenção: as regras da V1 estão abertas para facilitar o teste no pub. Depois da validação do jogo, endureça as regras/autenticação do admin.

## Deploy Vercel
Suba a pasta inteira para o GitHub e importe o repositório na Vercel.

Rotas esperadas:
- `https://SEU-DOMINIO/` — jogadores
- `https://SEU-DOMINIO/admin` — admin
- `https://SEU-DOMINIO/tv` — TV

## Fluxo
1. Jogadores entram pelo celular e cadastram a equipe.
2. Admin define categorias e duração e inicia rodada.
3. Respostas têm autosave no Firestore.
4. Primeiro STOP usa transaction no Firestore; apenas o primeiro encerramento é aceito.
5. Todos os celulares e a TV recebem o status `stopped` em tempo real.
6. Admin abre a correção, ajusta 10/5/0 e salva os pontos.
7. Ranking fica acumulado durante a partida.

## Pontuação sugerida
- 10: válida e única
- 5: válida repetida
- 0: vazia/inválida

A V1 faz uma sugestão automática e o admin pode sobrescrever.

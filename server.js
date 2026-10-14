import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import aiReviewHandler from './api/ai-review.js';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.post('/api/ai-review', aiReviewHandler);

app.get('/health', (_req,res)=>{
  res.status(200).json({
    ok:true,
    service:'tex-stop-ai',
    aiConfigured:Boolean(process.env.OPENAI_API_KEY),
    model:process.env.OPENAI_MODEL || 'gpt-5.6-luna'
  });
});

app.use(express.static(__dirname));

app.get('*', (_req,res)=>{
  res.sendFile(path.join(__dirname,'index.html'));
});

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`Tex STOP AI rodando na porta ${PORT}`);
});

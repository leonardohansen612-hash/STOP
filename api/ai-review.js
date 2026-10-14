import OpenAI from 'openai';

const MAX_ITEMS = 150;

function cleanText(v,max=120){
  return String(v ?? '').trim().slice(0,max);
}

function parseJson(text){
  const raw=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(raw)}catch{}
  const a=raw.indexOf('{');
  const b=raw.lastIndexOf('}');
  if(a>=0 && b>a) return JSON.parse(raw.slice(a,b+1));
  throw new Error('A IA não retornou JSON válido.');
}

export default async function aiReviewHandler(req,res){
  try{
    const apiKey=process.env.OPENAI_API_KEY;
    if(!apiKey){
      return res.status(503).json({
        ok:false,
        error:'OPENAI_API_KEY não configurada no Render.'
      });
    }

    const letter=cleanText(req.body?.letter,4).toUpperCase();
    const items=Array.isArray(req.body?.items) ? req.body.items.slice(0,MAX_ITEMS) : [];

    if(!letter || !items.length){
      return res.status(400).json({ok:false,error:'Letra ou respostas ausentes.'});
    }

    const safeItems=items.map((x,i)=>({
      id:cleanText(x.id || `item-${i}`,80),
      category:cleanText(x.category,80),
      answer:cleanText(x.answer,120)
    })).filter(x=>x.id && x.category && x.answer);

    if(!safeItems.length){
      return res.status(400).json({ok:false,error:'Nenhuma resposta válida para analisar.'});
    }

    const client=new OpenAI({apiKey});
    const model=process.env.OPENAI_MODEL || 'gpt-5.6-luna';

    const instructions = `
Você é o juiz de um jogo brasileiro de STOP/Adedonha.

Sua tarefa é avaliar se cada RESPOSTA é semanticamente válida para a CATEGORIA informada.
A verificação de letra inicial, respostas vazias, respostas repetidas e pontuação NÃO é sua responsabilidade.

Regras:
- Seja compatível com o uso comum do português do Brasil.
- Aceite nomes próprios, marcas, cidades, países, filmes, séries e termos estrangeiros quando fizerem sentido para a categoria.
- Para "Nome", aceite nomes de pessoas reais ou usuais.
- Para "Animal", aceite espécies e nomes populares de animais.
- Para "Cidade", aceite municípios/cidades reais.
- Para "Objeto", aceite objetos físicos reconhecíveis.
- Para "Comida", aceite pratos, ingredientes e alimentos normalmente consumidos.
- Para "Bebida", aceite bebidas reconhecíveis, alcoólicas ou não.
- Para "Marca", aceite marcas comerciais reconhecíveis.
- Para "Profissão", aceite profissões, ocupações e ofícios reconhecíveis.
- Para "País", aceite países reconhecidos de uso corrente.
- Para "Filme ou Série", aceite títulos reais de filmes ou séries.
- Para categorias personalizadas, use o significado natural da categoria.
- Se a resposta for claramente inválida, marque valid=false.
- Se for plausível mas você não tiver certeza, use confiança menor.
- Não invente fatos para validar uma resposta obscura.

Retorne APENAS JSON neste formato:
{
  "results": [
    {
      "id": "mesmo id recebido",
      "valid": true,
      "confidence": 0.98,
      "reason": "justificativa curta em português"
    }
  ]
}

confidence deve estar entre 0 e 1.
Retorne exatamente um resultado para cada item recebido.
`.trim();

    const payload = {
      letter,
      items:safeItems
    };

    const response=await client.responses.create({
      model,
      reasoning:{effort:'low'},
      input:[
        {role:'system',content:instructions},
        {role:'user',content:JSON.stringify(payload)}
      ]
    });

    const parsed=parseJson(response.output_text);
    const rows=Array.isArray(parsed?.results)?parsed.results:[];

    const byId=new Map(rows.map(r=>[String(r.id),r]));
    const results=safeItems.map(item=>{
      const r=byId.get(item.id)||{};
      return {
        id:item.id,
        valid:Boolean(r.valid),
        confidence:Math.max(0,Math.min(1,Number(r.confidence)||0)),
        reason:cleanText(r.reason || 'Sem justificativa da IA.',160)
      };
    });

    return res.status(200).json({
      ok:true,
      model,
      results
    });

  }catch(err){
    console.error('AI review error:',err);
    return res.status(500).json({
      ok:false,
      error:err?.message || 'Erro ao consultar a IA.'
    });
  }
}

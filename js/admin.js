import {
  db,gameRef,doc,setDoc,updateDoc,onSnapshot,collection,serverTimestamp,writeBatch,runTransaction
} from './firebase.js';
import {qs,esc,norm,randomLetter,DEFAULT_CATEGORIES} from './common.js';

const AI_CONFIDENCE_AUTO = 0.90;

let game={status:'lobby',round:0};
let teams=[];
let scoresDraft={};
let aiResults={};
let reviewBuiltForRound=null;

await setDoc(gameRef,{status:'lobby',round:0,createdAt:serverTimestamp()},{merge:true});

onSnapshot(gameRef,s=>{
  if(s.exists()) game=s.data();
  renderState();
});

onSnapshot(collection(db,'games',gameRef.id,'teams'),s=>{
  teams=s.docs.map(d=>({id:d.id,...d.data()}));
  renderTeams();
  if(game.status==='review' && reviewBuiltForRound!==game.round) runAiReview();
});

function renderState(){
  qs('#round').textContent=game.round||0;
  qs('#letter').textContent=game.letter||'-';
  qs('#status').textContent=game.status||'lobby';

  const alreadyScored=(game.scoredRound||0)===(game.round||0) && (game.round||0)>0;
  qs('#review').disabled=game.status!=='stopped' || alreadyScored;

  if(game.status==='review' && reviewBuiltForRound!==game.round){
    runAiReview();
  }
}

function renderTeams(){
  const ordered=[...teams].sort((a,b)=>(b.score||0)-(a.score||0));
  qs('#teams').innerHTML=ordered.length
    ? ordered.map(t=>`<div class="team">${esc(t.name)} <span class="muted">• ${t.score||0} pts</span></div>`).join('')
    : '<div class="muted">Nenhuma equipe conectada.</div>';
}

function readCategories(){
  return qs('#categories').value
    .replace(/\\n/g,'\n')
    .split(/\r?\n/)
    .map(x=>x.trim())
    .filter(Boolean)
    .slice(0,12);
}

qs('#start').addEventListener('click',async()=>{
  const cats=readCategories();
  const duration=Math.max(30,Math.min(300,Number(qs('#duration').value)||90));
  const end=new Date(Date.now()+duration*1000);

  reviewBuiltForRound=null;
  aiResults={};
  scoresDraft={};

  await updateDoc(gameRef,{
    status:'playing',
    round:(game.round||0)+1,
    letter:randomLetter(),
    categories:cats.length?cats:DEFAULT_CATEGORIES,
    startedAt:serverTimestamp(),
    endsAt:end,
    stopAt:null,
    stopById:null,
    stopByName:null,
    reviewScores:null,
    reviewTotals:null,
    aiReview:null
  });
});

qs('#review').addEventListener('click',async()=>{
  if(game.status!=='stopped') return;
  await updateDoc(gameRef,{status:'review'});
});

qs('#reset').addEventListener('click',async()=>{
  if(!confirm('Zerar placar e respostas de todas as equipes?')) return;

  const batch=writeBatch(db);
  teams.forEach(t=>{
    batch.set(doc(db,'games',gameRef.id,'teams',t.id),{
      score:0,
      answers:{},
      round:0,
      lastRoundPoints:0
    },{merge:true});
  });

  batch.set(gameRef,{
    status:'lobby',
    round:0,
    letter:null,
    categories:DEFAULT_CATEGORIES,
    stopByName:null,
    scoredRound:0,
    reviewScores:null,
    reviewTotals:null,
    aiReview:null
  },{merge:true});

  await batch.commit();
  clearReview();
});

function getRoundAnswer(team,cat){
  return team.round===game.round ? (team.answers?.[cat]||'') : '';
}

function baseCheck(answer){
  const a=norm(answer);
  const letter=norm(game.letter||'');
  if(!a) return {eligible:false,score:0,reason:'Vazia'};
  if(!letter || !a.startsWith(letter)) return {eligible:false,score:0,reason:'Fora da letra'};
  return {eligible:true,score:null,reason:'Aguardando IA'};
}

function duplicateCount(answer,cat){
  const n=norm(answer);
  return teams.filter(t=>norm(getRoundAnswer(t,cat))===n && n).length;
}

function buildAiItems(){
  const items=[];
  (game.categories||[]).forEach(cat=>{
    teams.forEach(t=>{
      const answer=getRoundAnswer(t,cat);
      const base=baseCheck(answer);
      if(base.eligible){
        items.push({
          id:`${t.id}|${cat}`,
          teamId:t.id,
          category:cat,
          answer
        });
      }
    });
  });
  return items;
}

async function runAiReview(){
  reviewBuiltForRound=game.round;
  scoresDraft={};
  aiResults={};

  qs('#autoBadge').hidden=false;
  qs('#reviewSummary').hidden=false;
  qs('#recalcReview').hidden=false;
  qs('#finishReview').hidden=false;

  setAiStatus('loading','🤖 Consultando a IA para validar as respostas...');

  const items=buildAiItems();

  try{
    if(items.length){
      const r=await fetch('/api/ai-review',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          letter:game.letter,
          items:items.map(x=>({
            id:x.id,
            category:x.category,
            answer:x.answer
          }))
        })
      });

      const data=await r.json().catch(()=>({}));
      if(!r.ok || !data.ok){
        throw new Error(data.error || `Erro HTTP ${r.status}`);
      }

      (data.results||[]).forEach(row=>{
        aiResults[row.id]=row;
      });

      setAiStatus('ok',`🤖 IA concluída com ${data.model||'modelo configurado'}. Revise apenas os itens amarelos.`);
    }else{
      setAiStatus('ok','Nenhuma resposta precisou de IA nesta rodada.');
    }

  }catch(err){
    console.error(err);
    setAiStatus(
      'warning',
      `⚠️ IA indisponível: ${err.message}. A correção caiu para o modo V2 local; revise as respostas manualmente.`
    );
  }

  buildReview();
  await persistPreview();
}

function suggestedScore(team,cat,answer){
  const base=baseCheck(answer);

  if(!base.eligible){
    return {
      score:0,
      state:'zero',
      reason:base.reason,
      confidence:1,
      needsReview:false
    };
  }

  const key=`${team.id}|${cat}`;
  const ai=aiResults[key];

  if(!ai){
    const repeated=duplicateCount(answer,cat)>1;
    return {
      score:repeated?5:10,
      state:'warning',
      reason:'IA não avaliou — revisar',
      confidence:0,
      needsReview:true
    };
  }

  const conf=Number(ai.confidence)||0;
  const needsReview=conf<AI_CONFIDENCE_AUTO;

  if(!ai.valid){
    return {
      score:0,
      state:needsReview?'warning':'invalid',
      reason:`${ai.reason} • IA ${Math.round(conf*100)}%`,
      confidence:conf,
      needsReview
    };
  }

  const repeated=duplicateCount(answer,cat)>1;
  return {
    score:repeated?5:10,
    state:needsReview?'warning':repeated?'repeat':'valid',
    reason:`${ai.reason} • IA ${Math.round(conf*100)}%${repeated?' • repetida':''}`,
    confidence:conf,
    needsReview
  };
}

function buildReview(){
  const cats=game.categories||[];
  const area=qs('#reviewArea');

  scoresDraft={};
  let html='';
  let reviewCount=0;

  cats.forEach(cat=>{
    html+=`<div class="category-card review-category">
      <div class="review-cat-head">
        <h3>${esc(cat)}</h3>
        <span class="muted">Letra ${esc(game.letter||'-')}</span>
      </div>`;

    teams.forEach(t=>{
      const ans=getRoundAnswer(t,cat);
      const s=suggestedScore(t,cat,ans);
      const key=`${t.id}|${cat}`;

      scoresDraft[key]=s.score;
      if(s.needsReview) reviewCount++;

      const stateClass=
        s.state==='valid'?'auto-valid':
        s.state==='repeat'?'auto-repeat':
        s.state==='warning'?'ai-warning':
        'auto-zero';

      html+=`<div class="review-row auto-review-row ${s.needsReview?'needs-review':''}">
        <div class="review-team">
          <b>${esc(t.name)}</b>
          ${s.needsReview?'<span class="review-flag">REVISAR</span>':''}
        </div>

        <div class="review-answer">
          ${esc(ans)||'<span class="muted">— vazio —</span>'}
          <span class="auto-reason ${stateClass}">${esc(s.reason)}</span>
        </div>

        <select class="scoreSel" data-team="${esc(t.id)}" data-cat="${esc(cat)}">
          <option value="10" ${s.score===10?'selected':''}>10 — válida única</option>
          <option value="5" ${s.score===5?'selected':''}>5 — repetida</option>
          <option value="0" ${s.score===0?'selected':''}>0 — inválida</option>
        </select>
      </div>`;
    });

    html+='</div>';
  });

  area.innerHTML=html;

  document.querySelectorAll('.scoreSel').forEach(sel=>{
    sel.addEventListener('change',()=>{
      scoresDraft[`${sel.dataset.team}|${sel.dataset.cat}`]=Number(sel.value);
      sel.closest('.auto-review-row')?.classList.remove('needs-review');
      sel.closest('.auto-review-row')?.querySelector('.review-flag')?.remove();
      renderSummary();
    });
  });

  renderSummary();

  if(reviewCount>0){
    setAiStatus(
      'warning',
      `🟡 ${reviewCount} resposta${reviewCount===1?'':'s'} com baixa confiança. Confira os itens marcados como REVISAR antes de aplicar os pontos.`
    );
  }
}

function calculatedTotals(){
  const totals={};
  teams.forEach(t=>{
    totals[t.id]=0;
    (game.categories||[]).forEach(cat=>{
      totals[t.id]+=Number(scoresDraft[`${t.id}|${cat}`]||0);
    });
  });
  return totals;
}

function renderSummary(){
  const totals=calculatedTotals();
  const ordered=[...teams].sort((a,b)=>(totals[b.id]||0)-(totals[a.id]||0));

  qs('#reviewSummary').innerHTML=ordered.map((t,i)=>`
    <div class="review-total-card">
      <span class="review-total-pos">${i+1}º</span>
      <span class="review-total-name">${esc(t.name)}</span>
      <strong>+${totals[t.id]||0} pts</strong>
    </div>
  `).join('');
}

async function persistPreview(){
  try{
    await updateDoc(gameRef,{
      reviewScores:scoresDraft,
      reviewTotals:calculatedTotals(),
      aiReview:{
        completedAt:serverTimestamp(),
        threshold:AI_CONFIDENCE_AUTO
      }
    });
  }catch(e){
    console.warn('Não foi possível salvar preview da correção.',e);
  }
}

qs('#recalcReview').addEventListener('click',()=>{
  reviewBuiltForRound=null;
  runAiReview();
});

qs('#finishReview').addEventListener('click',async()=>{
  if(game.status!=='review') return;

  const totals=calculatedTotals();
  const currentRound=game.round||0;

  try{
    await runTransaction(db,async tx=>{
      const gameSnap=await tx.get(gameRef);
      if(!gameSnap.exists()) throw new Error('Partida não encontrada.');

      const current=gameSnap.data();

      if((current.scoredRound||0)===currentRound){
        throw new Error('Esta rodada já foi pontuada.');
      }

      if(current.status!=='review'){
        throw new Error('A partida não está em correção.');
      }

      tx.update(gameRef,{
        scoredRound:currentRound,
        reviewScores:scoresDraft,
        reviewTotals:totals,
        scoredAt:serverTimestamp()
      });
    });

    const batch=writeBatch(db);

    teams.forEach(t=>{
      const add=totals[t.id]||0;
      batch.set(doc(db,'games',gameRef.id,'teams',t.id),{
        score:(t.score||0)+add,
        lastRoundPoints:add
      },{merge:true});
    });

    batch.set(gameRef,{
      status:'lobby',
      letter:null,
      stopByName:null,
      stopById:null
    },{merge:true});

    await batch.commit();
    clearReview();

  }catch(err){
    console.error(err);
    alert(err.message||'Não foi possível aplicar a pontuação.');
  }
});

function setAiStatus(type,text){
  const el=qs('#aiStatus');
  el.hidden=false;
  el.className=`ai-status ${type}`;
  el.textContent=text;
}

function clearReview(){
  reviewBuiltForRound=null;
  aiResults={};
  scoresDraft={};

  qs('#finishReview').hidden=true;
  qs('#recalcReview').hidden=true;
  qs('#autoBadge').hidden=true;
  qs('#reviewSummary').hidden=true;
  qs('#reviewSummary').innerHTML='';
  qs('#reviewArea').innerHTML='';
  qs('#aiStatus').hidden=true;
}

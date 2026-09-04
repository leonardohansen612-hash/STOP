import {
  db,gameRef,doc,setDoc,updateDoc,onSnapshot,collection,serverTimestamp,writeBatch,runTransaction
} from './firebase.js';
import {qs,esc,norm,randomLetter,DEFAULT_CATEGORIES} from './common.js';

let game={status:'lobby',round:0};
let teams=[];
let scoresDraft={};
let autoTotals={};

await setDoc(gameRef,{status:'lobby',round:0,createdAt:serverTimestamp()},{merge:true});

onSnapshot(gameRef,s=>{
  if(s.exists()) game=s.data();
  renderState();
});

onSnapshot(collection(db,'games',gameRef.id,'teams'),s=>{
  teams=s.docs.map(d=>({id:d.id,...d.data()}));
  renderTeams();
  if(game.status==='review') buildReview();
});

function renderState(){
  qs('#round').textContent=game.round||0;
  qs('#letter').textContent=game.letter||'-';
  qs('#status').textContent=game.status||'lobby';

  const alreadyScored=(game.scoredRound||0)===(game.round||0) && (game.round||0)>0;
  qs('#review').disabled=game.status!=='stopped' || alreadyScored;

  if(game.status==='review') buildReview();
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
    reviewTotals:null
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
    reviewTotals:null
  },{merge:true});

  await batch.commit();
  clearReview();
});

function getRoundAnswer(team,cat){
  return team.round===game.round ? (team.answers?.[cat]||'') : '';
}

function automaticScore(answer,cat){
  const a=norm(answer);
  const letter=norm(game.letter||'');

  if(!a) return {score:0,reason:'Vazia'};
  if(!letter || !a.startsWith(letter)) return {score:0,reason:'Fora da letra'};

  const same=teams.filter(t=>norm(getRoundAnswer(t,cat))===a).length;
  if(same>1) return {score:5,reason:`Repetida (${same} equipes)`};

  return {score:10,reason:'Única / letra correta'};
}

function buildReview(){
  const cats=game.categories||[];
  const area=qs('#reviewArea');

  scoresDraft={};
  autoTotals={};
  let html='';

  cats.forEach(cat=>{
    html+=`<div class="category-card review-category">
      <div class="review-cat-head">
        <h3>${esc(cat)}</h3>
        <span class="muted">Letra ${esc(game.letter||'-')}</span>
      </div>`;

    teams.forEach(t=>{
      const ans=getRoundAnswer(t,cat);
      const auto=automaticScore(ans,cat);
      const key=`${t.id}|${cat}`;

      scoresDraft[key]=auto.score;
      autoTotals[t.id]=(autoTotals[t.id]||0)+auto.score;

      const stateClass=auto.score===10?'auto-valid':auto.score===5?'auto-repeat':'auto-zero';

      html+=`<div class="review-row auto-review-row">
        <div class="review-team"><b>${esc(t.name)}</b></div>

        <div class="review-answer">
          ${esc(ans)||'<span class="muted">— vazio —</span>'}
          <span class="auto-reason ${stateClass}">${esc(auto.reason)}</span>
        </div>

        <select class="scoreSel" data-team="${t.id}" data-cat="${esc(cat)}">
          <option value="10" ${auto.score===10?'selected':''}>10 — válida única</option>
          <option value="5" ${auto.score===5?'selected':''}>5 — repetida</option>
          <option value="0" ${auto.score===0?'selected':''}>0 — inválida</option>
        </select>
      </div>`;
    });

    html+='</div>';
  });

  area.innerHTML=html;

  document.querySelectorAll('.scoreSel').forEach(sel=>{
    sel.addEventListener('change',()=>{
      scoresDraft[`${sel.dataset.team}|${sel.dataset.cat}`]=Number(sel.value);
      renderSummary();
    });
  });

  qs('#finishReview').hidden=false;
  qs('#recalcReview').hidden=false;
  qs('#autoBadge').hidden=false;
  qs('#reviewSummary').hidden=false;

  renderSummary();
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

qs('#recalcReview').addEventListener('click',buildReview);

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

      // Firestore transaction não deve depender de leituras posteriores.
      // Atualizações das equipes serão feitas em batch depois da trava da rodada.
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

function clearReview(){
  qs('#finishReview').hidden=true;
  qs('#recalcReview').hidden=true;
  qs('#autoBadge').hidden=true;
  qs('#reviewSummary').hidden=true;
  qs('#reviewSummary').innerHTML='';
  qs('#reviewArea').innerHTML='';
}

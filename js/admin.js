import {
  db,gameRef,doc,getDoc,setDoc,updateDoc,onSnapshot,collection,serverTimestamp,writeBatch,runTransaction
} from './firebase.js?v=20260910-6';
import {qs,esc,norm,randomLetter,DEFAULT_CATEGORIES} from './common.js?v=20260910-6';

const AI_CONFIDENCE_AUTO = 0.90; // exibido apenas como informação; a IA decide automaticamente

let game={status:'lobby',round:0};
let teams=[];
let scoresDraft={};
let aiResults={};
let reviewBuiltForRound=null;
let teamsReady=false;
let aiReviewRunning=false;
let aiRetryTimer=null;
let autoReviewTimer=null;
let autoFinalizeRunning=false;
let aiFailureCycles=0;
let historyRows=[];

const initialGameSnap=await getDoc(gameRef);
if(initialGameSnap.exists()){
  game=initialGameSnap.data();
}
if(!initialGameSnap.exists()){
  await setDoc(gameRef,{
    status:'lobby',
    round:0,
    usedLetters:[],
    categories:DEFAULT_CATEGORIES,
    createdAt:serverTimestamp()
  });

}else if(!Array.isArray(initialGameSnap.data().usedLetters)){
  await updateDoc(gameRef,{usedLetters:[]});
}

// Segurança do cronômetro: o Admin também encerra a rodada ao chegar em 00:00.
// Usa a mesma transação/status que o STOP normal, sem alterar o fluxo STOP ->
// REVIEW -> IA -> PONTOS -> LOBBY já existente.
let timeoutWatchRunning=false;
setInterval(async()=>{
  try{
    if(timeoutWatchRunning || !game || game.status!=='playing' || !game.endsAt) return;
    const end=game.endsAt?.toMillis ? game.endsAt.toMillis() : Number(game.endsAt);
    if(!Number.isFinite(end) || Date.now()<end) return;

    timeoutWatchRunning=true;
    await runTransaction(db,async tx=>{
      const snap=await tx.get(gameRef);
      if(!snap.exists()) return;
      const current=snap.data();
      if(current.status!=='playing') return;

      const currentEnd=current.endsAt?.toMillis
        ? current.endsAt.toMillis()
        : Number(current.endsAt);
      if(!Number.isFinite(currentEnd) || Date.now()<currentEnd) return;

      tx.update(gameRef,{
        status:'stopped',
        stopById:null,
        stopByName:'TEMPO ESGOTADO',
        stopAt:serverTimestamp()
      });
    });
  }catch(e){
    console.error('Erro no encerramento automático por tempo:',e);
  }finally{
    timeoutWatchRunning=false;
  }
},500);


// ===== RESPOSTAS / AUDITORIA =====
// Esta coleção é consumida apenas pelo painel Admin.
const historyCol=collection(db,'games',gameRef.id,'history');

function historyDate(value){
  try{
    const d=value?.toDate
      ? value.toDate()
      : value?.seconds
        ? new Date(value.seconds*1000)
        : null;
    return d?d.toLocaleString('pt-BR'):'';
  }catch(_){ return ''; }
}

function renderHistory(){
  const area=qs('#historyList');
  if(!area) return;

  const rows=[...historyRows].sort((a,b)=>{
    const ta=Number(a.startedAt?.seconds||a.savedAt?.seconds||0);
    const tb=Number(b.startedAt?.seconds||b.savedAt?.seconds||0);
    return tb-ta;
  });

  if(!rows.length){
    area.innerHTML='<div class="history-empty">Nenhuma rodada pontuada ainda.</div>';
    return;
  }

  area.innerHTML=rows.map((h,index)=>{
    const saved=historyDate(h.startedAt||h.savedAt);
    const teamRows=Array.isArray(h.teams)?h.teams:[];
    const stopper=h.stopByName?`• STOP: ${esc(h.stopByName)}`:'';

    return `<details class="history-round" ${index===0?'open':''}>
      <summary>
        <div class="history-round-meta">
          <span class="history-letter">${esc(h.letter||'-')}</span>
          <span>Rodada ${Number(h.round||0)}</span>
          <span class="history-stop">${stopper}</span>
        </div>
        <span class="history-date">${esc(saved)}</span>
      </summary>
      <div class="history-body">
        ${teamRows.map(t=>`
          <div class="history-team">
            <div class="history-team-head">
              <strong>${esc(t.name||'Equipe')}</strong>
              <span class="history-team-points">
                +${Number(t.roundPoints||0)} pts • total ${Number(t.totalAfter||0)}
              </span>
            </div>
            ${(Array.isArray(t.answers)?t.answers:[]).map(a=>{
              const p=Number(a.points||0);
              const scoreClass=p===10?'s10':p===5?'s5':'s0';
              const confidence=Number.isFinite(Number(a.aiConfidence))
                ? `${Math.round(Number(a.aiConfidence)*100)}%`
                : '—';
              const decision=a.aiEvaluated
                ? (a.aiValid?'VÁLIDA':'INVÁLIDA')
                : (a.baseReason||'REGRA LOCAL');
              const reason=a.aiReason||a.baseReason||'';
              return `<div class="history-answer">
                <div class="history-category">${esc(a.category||'')}</div>
                <div class="history-response">${esc(a.answer||'—')}</div>
                <div class="history-score ${scoreClass}">${p} pts</div>
                <div class="history-ai">
                  <b>${esc(decision)}</b>${a.aiEvaluated?` • IA ${esc(confidence)}`:''}
                  ${reason?`<br>${esc(reason)}`:''}
                </div>
              </div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    </details>`;
  }).join('');
}

onSnapshot(historyCol,s=>{
  historyRows=s.docs.map(d=>({id:d.id,...d.data()}));
  renderHistory();
});

function openAdminTab(name){
  const history=name==='history';
  qs('#gameView').hidden=history;
  qs('#historyView').hidden=!history;
  qs('#tabGame').classList.toggle('active',!history);
  qs('#tabHistory').classList.toggle('active',history);
  if(history) renderHistory();
}
qs('#tabGame')?.addEventListener('click',()=>openAdminTab('game'));
qs('#tabHistory')?.addEventListener('click',()=>openAdminTab('history'));
qs('#refreshHistory')?.addEventListener('click',()=>renderHistory());

onSnapshot(gameRef,s=>{
  if(s.exists()) game=s.data();
  renderState();
});

onSnapshot(collection(db,'games',gameRef.id,'teams'),s=>{
  teams=s.docs.map(d=>({id:d.id,...d.data()}));
  teamsReady=true;
  renderTeams();
  if(game.status==='review' && reviewBuiltForRound!==game.round) queueAiReview(80);
});

function renderState(){
  qs('#round').textContent=game.round||0;
  qs('#letter').textContent=game.letter||'-';
  qs('#status').textContent=game.status||'lobby';
  const used=(game.usedLetters||[]);
  const usedEl=qs('#usedLetters');
  if(usedEl) usedEl.textContent=used.length?used.join(' • '):'Nenhuma';

  const alreadyScored=(game.scoredRound||0)===(game.round||0) && (game.round||0)>0;
  qs('#review').disabled=game.status!=='stopped' || alreadyScored;

  // Fluxo 100% automático: STOP -> REVIEW -> IA -> pontos -> LOBBY.
  // Pequena espera para dar tempo aos últimos autosaves dos celulares chegarem.
  if(game.status==='stopped' && !alreadyScored){
    queueAutomaticReview(game.round||0);
  }

  if(game.status==='review' && reviewBuiltForRound!==game.round){
    queueAiReview(80);
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
  const usedLetters=Array.isArray(game.usedLetters)?game.usedLetters:[];
  const nextLetter=randomLetter(usedLetters);

  if(!nextLetter){
    alert('Todas as letras disponíveis já foram usadas hoje. Clique em “NOVO DIA / LIMPAR TUDO” para reiniciar o ciclo de letras.');
    return;
  }

  reviewBuiltForRound=null;
  aiResults={};
  scoresDraft={};
  aiFailureCycles=0;

  await updateDoc(gameRef,{
    status:'playing',
    round:(game.round||0)+1,
    letter:nextLetter,
    usedLetters:[...usedLetters,nextLetter],
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

function queueAutomaticReview(round){
  if(autoReviewTimer) clearTimeout(autoReviewTimer);
  autoReviewTimer=setTimeout(async()=>{
    autoReviewTimer=null;
    try{
      await runTransaction(db,async tx=>{
        const snap=await tx.get(gameRef);
        if(!snap.exists()) return;
        const current=snap.data();
        if(current.status!=='stopped') return;
        if((current.round||0)!==round) return;
        if((current.scoredRound||0)===round && round>0) return;
        tx.update(gameRef,{status:'review'});
      });
    }catch(err){
      console.error('Falha ao iniciar correção automática.',err);
      setTimeout(()=>queueAutomaticReview(round),1200);
    }
  },700);
}

qs('#reset').addEventListener('click',async()=>{
  if(!confirm('Zerar pontos e respostas, mantendo as equipes e as letras já usadas hoje?')) return;

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

qs('#clearAll').addEventListener('click',async()=>{
  if(!confirm('NOVO DIA: apagar TODAS as equipes, nomes, pontos, respostas e liberar novamente todas as letras?')) return;

  const batch=writeBatch(db);
  teams.forEach(t=>{
    batch.delete(doc(db,'games',gameRef.id,'teams',t.id));
  });

  batch.set(gameRef,{
    status:'lobby',
    round:0,
    letter:null,
    usedLetters:[],
    categories:DEFAULT_CATEGORIES,
    startedAt:null,
    endsAt:null,
    stopAt:null,
    stopById:null,
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

function queueAiReview(delay=0){
  if(aiRetryTimer) clearTimeout(aiRetryTimer);
  aiRetryTimer=setTimeout(()=>{
    aiRetryTimer=null;
    runAiReview();
  },delay);
}

async function requestAiReview(items,attempt=1){
  const r=await fetch(`/api/ai-review?_=${Date.now()}`,{
    method:'POST',
    cache:'no-store',
    headers:{
      'Content-Type':'application/json',
      'Cache-Control':'no-cache'
    },
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

  const rows=Array.isArray(data.results)?data.results:[];
  if(rows.length!==items.length){
    throw new Error(`A IA devolveu ${rows.length} de ${items.length} respostas.`);
  }

  return data;
}

async function runAiReview(){
  if(aiReviewRunning) return;
  if(game.status!=='review') return;

  // Na entrada em REVIEW o snapshot do jogo pode chegar alguns ms antes
  // do snapshot das equipes. Não marque a rodada como processada antes disso.
  if(!teamsReady){
    setAiStatus('loading','🤖 Aguardando respostas das equipes...');
    queueAiReview(250);
    return;
  }

  const items=buildAiItems();
  if(!teams.length){
    setAiStatus('loading','🤖 Aguardando equipes...');
    queueAiReview(250);
    return;
  }

  aiReviewRunning=true;
  scoresDraft={};
  aiResults={};

  qs('#autoBadge').hidden=false;
  qs('#reviewSummary').hidden=false;
  qs('#recalcReview').hidden=false;
  qs('#finishReview').hidden=false;

  setAiStatus('loading','🤖 Consultando a IA para validar as respostas...');

  let aiError=null;

  try{
    if(items.length){
      let data=null;
      for(let attempt=1;attempt<=3;attempt++){
        try{
          data=await requestAiReview(items,attempt);
          break;
        }catch(err){
          aiError=err;
          console.warn(`Tentativa IA ${attempt}/3 falhou:`,err);
          if(attempt<3){
            setAiStatus('loading',`🤖 IA demorou a responder. Tentando novamente (${attempt+1}/3)...`);
            await new Promise(resolve=>setTimeout(resolve,500*attempt));
          }
        }
      }

      if(!data) throw aiError || new Error('A IA não respondeu.');

      (data.results||[]).forEach(row=>{
        aiResults[String(row.id)]=row;
      });

      const missing=items.filter(x=>!aiResults[x.id]);
      if(missing.length){
        throw new Error(`Faltaram ${missing.length} resposta(s) na correção da IA.`);
      }

      setAiStatus('ok',`🤖 IA concluída com ${data.model||'modelo configurado'}. Aplicando os pontos automaticamente...`);
    }else{
      setAiStatus('ok','Nenhuma resposta precisou de IA. Aplicando os pontos automaticamente...');
    }

    aiFailureCycles=0;
    reviewBuiltForRound=game.round;
    buildReview({preserveAiStatus:true});
    await persistPreview();
    await applyReviewScores({automatic:true});

  }catch(err){
    console.error(err);
    reviewBuiltForRound=null;
    buildReview({preserveAiStatus:true});
    aiFailureCycles++;
    if(aiFailureCycles<=5){
      setAiStatus(
        'warning',
        `⚠️ Falha temporária na IA: ${err.message}. Nova tentativa automática em 5 segundos (${aiFailureCycles}/5)...`
      );
      queueAiReview(5000);
    }else{
      setAiStatus(
        'warning',
        `⚠️ A IA não respondeu após várias tentativas: ${err.message}. O sistema NÃO aplicou pontos. Use RECALCULAR após verificar a conexão/API.`
      );
    }
  }finally{
    aiReviewRunning=false;
  }
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

  // Modo automático: confiamos na decisão valid/invalid da IA mesmo quando
  // a confiança informada pelo modelo é menor. A confiança fica só visível
  // para auditoria, sem exigir intervenção do apresentador.
  if(!ai.valid){
    return {
      score:0,
      state:'invalid',
      reason:`${ai.reason} • IA ${Math.round(conf*100)}%`,
      confidence:conf,
      needsReview:false
    };
  }

  const repeated=duplicateCount(answer,cat)>1;
  return {
    score:repeated?5:10,
    state:repeated?'repeat':'valid',
    reason:`${ai.reason} • IA ${Math.round(conf*100)}%${repeated?' • repetida':''}`,
    confidence:conf,
    needsReview:false
  };
}

function buildReview({preserveAiStatus=false}={}){
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

  if(reviewCount>0 && !preserveAiStatus){
    setAiStatus(
      'warning',
      `🟡 ${reviewCount} resposta${reviewCount===1?'':'s'} com baixa confiança. Confira os itens marcados como REVISAR antes de aplicar os pontos.`
    );
  } else if(reviewCount>0 && preserveAiStatus && Object.keys(aiResults).length){
    setAiStatus(
      'warning',
      `🟡 ${reviewCount} resposta${reviewCount===1?'':'s'} realmente ficou${reviewCount===1?'':'ram'} com baixa confiança. Revise somente ${reviewCount===1?'este item':'estes itens'}.`
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
  queueAiReview(0);
});

async function applyReviewScores({automatic=false}={}){
  if(autoFinalizeRunning) return;
  if(game.status!=='review') return;

  autoFinalizeRunning=true;
  const totals=calculatedTotals();
  const currentRound=game.round||0;

  try{
    // Pontuação da rodada + placar das equipes + volta ao lobby em uma única
    // transação. Evita marcar a rodada como pontuada sem atualizar as equipes.
    await runTransaction(db,async tx=>{
      const gameSnap=await tx.get(gameRef);
      if(!gameSnap.exists()) throw new Error('Partida não encontrada.');

      const current=gameSnap.data();
      if((current.scoredRound||0)===currentRound){
        return; // outra execução já concluiu esta rodada
      }
      if(current.status!=='review'){
        throw new Error('A partida não está em correção.');
      }

      const teamReads=[];
      for(const t of teams){
        const ref=doc(db,'games',gameRef.id,'teams',t.id);
        const snap=await tx.get(ref);
        teamReads.push({t,ref,snap});
      }

      // Guarda a rodada completa para consulta posterior.
      // O horário de início entra no ID para não sobrescrever "Rodada 1"
      // de outro dia ou após um reset de pontos.
      const startSeconds=Number(current.startedAt?.seconds||0);
      const startNanos=Number(current.startedAt?.nanoseconds||0);
      const historyId=`round-${currentRound}-${startSeconds}-${startNanos}`;
      const historyRef=doc(db,'games',gameRef.id,'history',historyId);

      const historyTeams=teamReads.map(({t,snap})=>{
        const currentScore=snap.exists()?Number(snap.data().score||0):Number(t.score||0);
        const roundPoints=Number(totals[t.id]||0);

        return {
          id:t.id,
          name:t.name||'Equipe',
          roundPoints,
          totalBefore:currentScore,
          totalAfter:currentScore+roundPoints,
          answers:(current.categories||game.categories||[]).map(cat=>{
            const answer=t.round===currentRound?(t.answers?.[cat]||''):'';
            const key=`${t.id}|${cat}`;
            const ai=aiResults[key]||null;
            const base=baseCheck(answer);

            return {
              category:cat,
              answer,
              points:Number(scoresDraft[key]||0),
              aiEvaluated:!!ai,
              aiValid:ai?!!ai.valid:null,
              aiConfidence:ai?Number(ai.confidence||0):null,
              aiReason:ai?.reason||null,
              baseReason:!base.eligible?base.reason:null
            };
          })
        };
      });

      tx.set(historyRef,{
        round:currentRound,
        letter:current.letter||game.letter||null,
        categories:current.categories||game.categories||[],
        stopByName:current.stopByName||game.stopByName||null,
        stopById:current.stopById||game.stopById||null,
        startedAt:current.startedAt||null,
        savedAt:serverTimestamp(),
        teams:historyTeams
      });

      tx.update(gameRef,{
        scoredRound:currentRound,
        reviewScores:scoresDraft,
        reviewTotals:totals,
        scoredAt:serverTimestamp(),
        status:'lobby',
        letter:null,
        stopByName:null,
        stopById:null
      });

      teamReads.forEach(({t,ref,snap})=>{
        const currentScore=snap.exists()?Number(snap.data().score||0):Number(t.score||0);
        const add=Number(totals[t.id]||0);
        tx.set(ref,{
          score:currentScore+add,
          lastRoundPoints:add
        },{merge:true});
      });
    });

    clearReview();
  }catch(err){
    console.error(err);
    if(automatic){
      setAiStatus('warning',`⚠️ A IA corrigiu, mas não consegui aplicar os pontos: ${err.message}. Vou tentar novamente.`);
      setTimeout(()=>applyReviewScores({automatic:true}),1500);
    }else{
      alert(err.message||'Não foi possível aplicar a pontuação.');
    }
  }finally{
    autoFinalizeRunning=false;
  }
}

qs('#finishReview').addEventListener('click',()=>applyReviewScores({automatic:false}));

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

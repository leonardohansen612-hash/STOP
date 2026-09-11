import {db,gameRef,doc,getDocFromServer,updateDoc,onSnapshot,collection,serverTimestamp,runTransaction} from './firebase.js?v=20260910-6';
import {qs,getTeamId,fmtTime} from './common.js?v=20260910-6';

const teamId=getTeamId();
let teamName=sessionStorage.getItem('texStopTeamName')||'';
if(!teamName){
  window.location.replace('index.html');
}

let game=null, team=null, timerInt=null;
let answers={};
let currentCategoryIndex=0;
let renderedRound=null;
let saveTimer=null;
let flashedRound=0;
let syncFallbackInt=null;
let lastRealtimeGameAt=0;

const waiting=qs('#waiting');
const gameEl=qs('#game');
const stopped=qs('#stopped');
const answerInput=qs('#categoryAnswer');
const backBtn=qs('#backBtn');
const nextBtn=qs('#nextBtn');
const stopBtn=qs('#stopBtn');

qs('#teamDisplay').textContent=teamName;

// Bootstrap obrigatório: lê o estado atual diretamente do servidor ANTES de
// depender do primeiro evento realtime. Isso evita ficar preso no lobby na
// primeira rodada em celulares que restauraram a página/cache anterior.
try{
  const bootSnap=await getDocFromServer(gameRef);
  game=bootSnap.exists()?bootSnap.data():null;
}catch(e){
  console.warn('Bootstrap inicial do jogo falhou; realtime assumirá.',e);
}

function setStatus(s){
  qs('#statusText').textContent=s;
  qs('#dot').className='dot '+(s==='Jogando'?'live':s==='STOP'?'stop':'');
}

render();

onSnapshot(collection(db,'games',gameRef.id,'teams'),snap=>{
  const mine=snap.docs.map(d=>({id:d.id,...d.data()})).find(t=>t.id===teamId);
  if(mine){
    team=mine;
    teamName=mine.name||teamName;
    qs('#teamDisplay').textContent=teamName;
    sessionStorage.setItem('texStopTeamName',teamName);
  }
  render();
});

onSnapshot(gameRef,{includeMetadataChanges:true},snap=>{
  lastRealtimeGameAt=Date.now();
  game=snap.exists()?snap.data():null;
  render();
},err=>{
  console.error('Falha no listener em tempo real do jogo:',err);
});

// Fallback de sincronização: se o listener em tempo real ficar preso em cache
// ou sofrer uma queda silenciosa no Wi-Fi do celular, consultamos o estado do
// jogo periodicamente. Assim o INICIAR RODADA chega sem exigir F5/reload.
async function forceGameSync(){
  try{
    const snap=await getDocFromServer(gameRef);
    if(!snap.exists()) return;
    const fresh=snap.data();

    const currentRound=Number(game?.round||0);
    const freshRound=Number(fresh.round||0);
    const changed=!game || fresh.status!==game.status || freshRound!==currentRound || fresh.letter!==game.letter;

    if(changed || Date.now()-lastRealtimeGameAt>4000){
      game=fresh;
      render();
    }
  }catch(e){
    console.warn('Fallback de sincronização indisponível.',e);
  }
}

// Faz uma leitura REAL do servidor imediatamente ao abrir o jogo.
// Nos primeiros segundos usamos uma cadência mais agressiva para eliminar a
// janela em que o celular entrou na sala mas a conexão realtime ainda está
// sendo estabelecida. Depois voltamos para uma verificação leve.
forceGameSync();

let warmupChecks=0;
const warmupInt=setInterval(async()=>{
  warmupChecks++;
  await forceGameSync();
  if(warmupChecks>=20){
    clearInterval(warmupInt);
    if(!syncFallbackInt) syncFallbackInt=setInterval(forceGameSync,1500);
  }
},500);

window.addEventListener('focus',forceGameSync);
window.addEventListener('pageshow',forceGameSync);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden) forceGameSync();
});

function render(){
  if(!game || game.status==='lobby' || game.status==='review' || game.status==='finished'){
    waiting.hidden=false;
    gameEl.hidden=true;
    stopped.hidden=true;
    setStatus(game?.status==='review'?'Correção':'Aguardando');
    clearInterval(timerInt);
    return;
  }

  if(game.status==='playing'){
    waiting.hidden=true;
    stopped.hidden=true;
    gameEl.hidden=false;
    setStatus('Jogando');
    renderRound();
    return;
  }

  if(game.status==='stopped'){
    waiting.hidden=true;
    gameEl.hidden=true;
    stopped.hidden=false;
    setStatus('STOP');
    clearInterval(timerInt);
    qs('#stopMessage').textContent=`${game.stopByName||'Uma equipe'} pediu STOP.`;
    showFlash(game.stopByName||'');
  }
}

function renderRound(){
  qs('#letter').textContent=game.letter||'?';
  const round=game.round||1;

  if(renderedRound!==round){
    renderedRound=round;
    currentCategoryIndex=0;
    answers=(team?.round===round && team.answers) ? {...team.answers} : {};
  }

  renderCategory();

  clearInterval(timerInt);
  tick();
  timerInt=setInterval(tick,250);
}

function renderCategory(){
  const cats=game?.categories||[];
  if(!cats.length){
    qs('#categoryName').textContent='Sem categorias';
    qs('#categoryCounter').textContent='0 categorias';
    answerInput.value='';
    answerInput.disabled=true;
    backBtn.hidden=true;
    nextBtn.hidden=true;
    stopBtn.hidden=true;
    return;
  }

  currentCategoryIndex=Math.max(0,Math.min(currentCategoryIndex,cats.length-1));
  const cat=cats[currentCategoryIndex];
  const isLast=currentCategoryIndex===cats.length-1;

  qs('#categoryName').textContent=cat;
  qs('#categoryCounter').textContent=`Categoria ${currentCategoryIndex+1} de ${cats.length}`;
  qs('#categoryProgress').style.width=`${((currentCategoryIndex+1)/cats.length)*100}%`;

  answerInput.disabled=false;
  answerInput.value=answers[cat]||'';
  answerInput.placeholder=`Resposta para ${cat}...`;

  backBtn.hidden=currentCategoryIndex===0;
  nextBtn.hidden=isLast;
  stopBtn.hidden=!isLast;
  updateStopAvailability();

  setTimeout(()=>answerInput.focus(),0);
}

function captureCurrentAnswer(){
  const cats=game?.categories||[];
  const cat=cats[currentCategoryIndex];
  if(cat) answers[cat]=answerInput.value;
}

function missingAnswers(){
  captureCurrentAnswer();
  const cats=game?.categories||[];
  return cats.filter(cat=>!String(answers[cat]||'').trim());
}

function updateStopAvailability(){
  const cats=game?.categories||[];
  if(!cats.length || stopBtn.hidden) return;

  const missing=missingAnswers();
  stopBtn.disabled=missing.length>0;

  if(missing.length){
    stopBtn.textContent=`🛑 FALTA${missing.length>1?'M':''} ${missing.length} RESPOSTA${missing.length>1?'S':''}`;
    stopBtn.title=`Complete: ${missing.join(', ')}`;
    stopBtn.setAttribute('aria-disabled','true');
  }else{
    stopBtn.textContent='🛑 STOP!';
    stopBtn.title='Todas as respostas preenchidas. Pode dar STOP.';
    stopBtn.removeAttribute('aria-disabled');
  }
}

function queueSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveAnswers,150);
}

answerInput.addEventListener('input',()=>{
  captureCurrentAnswer();
  updateStopAvailability();
  queueSave();
});

answerInput.addEventListener('keydown',async e=>{
  if(e.key!=='Enter') return;
  e.preventDefault();
  if(stopBtn.hidden) await goNext();
});

async function goNext(){
  const cats=game?.categories||[];
  if(currentCategoryIndex>=cats.length-1) return;
  captureCurrentAnswer();
  await saveAnswers();
  currentCategoryIndex++;
  renderCategory();
}

async function goBack(){
  if(currentCategoryIndex<=0) return;
  captureCurrentAnswer();
  await saveAnswers();
  currentCategoryIndex--;
  renderCategory();
}

nextBtn.addEventListener('click',goNext);
backBtn.addEventListener('click',goBack);

async function saveAnswers(){
  if(!game || game.status!=='playing') return;
  captureCurrentAnswer();
  await updateDoc(doc(db,'games',gameRef.id,'teams',teamId),{
    answers,
    round:game.round,
    updatedAt:serverTimestamp()
  }).catch(()=>{});
}

stopBtn.addEventListener('click',async()=>{
  const missing=missingAnswers();
  updateStopAvailability();

  if(missing.length){
    alert(`Você precisa responder todas as categorias antes de dar STOP.\n\nFalta: ${missing.join(', ')}`);
    return;
  }

  saveAnswers(); // último save em paralelo; não atrasa o STOP
  await requestStop(teamName);
});

function tick(){
  if(!game?.endsAt){
    qs('#timer').textContent='--:--';
    return;
  }
  const end=game.endsAt.toMillis?game.endsAt.toMillis():game.endsAt;
  const ms=end-Date.now();
  qs('#timer').textContent=fmtTime(ms);
  if(ms<=0 && game.status==='playing') requestStop('TEMPO');
}

async function requestStop(by){
  if(by!=='TEMPO'){
    const missing=missingAnswers();
    if(missing.length){
      updateStopAvailability();
      return;
    }
  }

  try{
    await runTransaction(db,async tx=>{
      const snap=await tx.get(gameRef);
      if(!snap.exists()) return;
      const d=snap.data();
      if(d.status!=='playing') return;
      tx.update(gameRef,{
        status:'stopped',
        stopById:by==='TEMPO'?null:teamId,
        stopByName:by==='TEMPO'?'TEMPO ESGOTADO':by,
        stopAt:serverTimestamp()
      });
    });
  }catch(e){
    console.error(e);
  }
}

function showFlash(who){
  if(!game || flashedRound===game.round) return;
  flashedRound=game.round;
  qs('#flashWho').textContent=who;
  qs('#flash').classList.add('show');
  setTimeout(()=>qs('#flash').classList.remove('show'),1600);
}

import {db,gameRef,doc,setDoc,updateDoc,onSnapshot,collection,serverTimestamp,runTransaction} from './firebase.js';
import {qs,esc,getTeamId,fmtTime} from './common.js';

const teamId=getTeamId();
let game=null, team=null, timerInt=null;
let answers={};
let currentCategoryIndex=0;
let renderedRound=null;
let saveTimer=null;
let flashedRound=0;

const join=qs('#join');
const waiting=qs('#waiting');
const gameEl=qs('#game');
const stopped=qs('#stopped');
const answerInput=qs('#categoryAnswer');
const backBtn=qs('#backBtn');
const nextBtn=qs('#nextBtn');
const stopBtn=qs('#stopBtn');

function setStatus(s){
  qs('#statusText').textContent=s;
  qs('#dot').className='dot '+(s==='Jogando'?'live':s==='STOP'?'stop':'');
}

async function joinGame(name){
  team={id:teamId,name:name.trim()};
  await setDoc(doc(db,'games',gameRef.id,'teams',teamId),{
    name:team.name,score:0,joinedAt:serverTimestamp(),answers:{},round:0
  },{merge:true});
  sessionStorage.setItem('texStopTeamName',team.name);
  render();
}

qs('#joinForm').addEventListener('submit',e=>{
  e.preventDefault();
  joinGame(qs('#teamName').value);
});

const saved=sessionStorage.getItem('texStopTeamName');
if(saved) team={id:teamId,name:saved};

onSnapshot(collection(db,'games',gameRef.id,'teams'),snap=>{
  const teams=snap.docs.map(d=>({id:d.id,...d.data()}));
  const mine=teams.find(t=>t.id===teamId);
  if(mine) team=mine;
  qs('#teams').innerHTML=teams.map(t=>`<div class="team">${esc(t.name)}</div>`).join('');
  render();
});

onSnapshot(gameRef,snap=>{
  game=snap.exists()?snap.data():null;
  render();
});

function render(){
  if(!team){
    join.hidden=false;
    waiting.hidden=gameEl.hidden=stopped.hidden=true;
    return;
  }

  join.hidden=true;
  qs('#hello').textContent=`Equipe: ${team.name}`;

  if(!game || game.status==='lobby' || game.status==='review' || game.status==='finished'){
    waiting.hidden=false;
    gameEl.hidden=stopped.hidden=true;
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

  setTimeout(()=>answerInput.focus(),0);
}

function captureCurrentAnswer(){
  const cats=game?.categories||[];
  const cat=cats[currentCategoryIndex];
  if(!cat) return;
  answers[cat]=answerInput.value.trim();
}

function queueSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveAnswers,150);
}

answerInput.addEventListener('input',()=>{
  captureCurrentAnswer();
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
  await saveAnswers();
  await requestStop(team.name);
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

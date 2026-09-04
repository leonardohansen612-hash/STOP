import {db,gameRef,doc,setDoc,updateDoc,onSnapshot,collection,serverTimestamp,runTransaction} from './firebase.js';
import {qs,esc,getTeamId,fmtTime} from './common.js';

const teamId=getTeamId();
let game=null,team=null,timerInt=null,lastAnswers={},currentCategoryIndex=0;
const join=qs('#join'),waiting=qs('#waiting'),gameEl=qs('#game'),stopped=qs('#stopped');

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
  const previousRound=game?.round;
  game=snap.exists()?snap.data():null;
  if(game?.round && game.round!==previousRound) currentCategoryIndex=0;
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

  if(!game||game.status==='lobby'||game.status==='review'||game.status==='finished'){
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
  const cats=game.categories||[];
  const currentRound=game.round||1;
  qs('#letter').textContent=game.letter||'?';

  if(qs('#categoryCard').dataset.round!=currentRound){
    qs('#categoryCard').dataset.round=currentRound;
    lastAnswers=(team?.round===currentRound&&team.answers)||{};
    currentCategoryIndex=0;
  }

  if(currentCategoryIndex>Math.max(0,cats.length-1)) currentCategoryIndex=Math.max(0,cats.length-1);
  renderCategory();
  clearInterval(timerInt);
  tick();
  timerInt=setInterval(tick,250);
}

function renderCategory(){
  const cats=game?.categories||[];
  if(!cats.length){
    qs('#categoryName').textContent='Sem categorias';
    qs('#categoryProgress').textContent='';
    qs('#categoryAnswer').value='';
    qs('#nextBtn').hidden=true;
    qs('#stopBtn').hidden=false;
    return;
  }

  const cat=cats[currentCategoryIndex];
  const isLast=currentCategoryIndex===cats.length-1;
  qs('#categoryName').textContent=cat;
  qs('#categoryProgress').textContent=`Categoria ${currentCategoryIndex+1} de ${cats.length}`;
  qs('#categoryAnswer').value=lastAnswers[cat]||'';
  qs('#prevBtn').hidden=currentCategoryIndex===0;
  qs('#nextBtn').hidden=isLast;
  qs('#stopBtn').hidden=!isLast;
  qs('#nextBtn').textContent='PRÓXIMA →';
  setTimeout(()=>qs('#categoryAnswer').focus(),30);
}

function captureCurrentAnswer(){
  const cats=game?.categories||[];
  const cat=cats[currentCategoryIndex];
  if(!cat) return;
  lastAnswers[cat]=qs('#categoryAnswer').value.trim();
}

async function saveAnswers(){
  if(!game||game.status!=='playing') return;
  captureCurrentAnswer();
  await updateDoc(doc(db,'games',gameRef.id,'teams',teamId),{
    answers:lastAnswers,
    round:game.round,
    updatedAt:serverTimestamp()
  }).catch(()=>{});
}

let saveTimer;
qs('#categoryAnswer').addEventListener('input',()=>{
  captureCurrentAnswer();
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveAnswers,180);
});

qs('#categoryAnswer').addEventListener('keydown',async e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    const cats=game?.categories||[];
    if(currentCategoryIndex<cats.length-1){
      await saveAnswers();
      currentCategoryIndex++;
      renderCategory();
    }
  }
});

qs('#nextBtn').addEventListener('click',async()=>{
  await saveAnswers();
  const cats=game?.categories||[];
  if(currentCategoryIndex<cats.length-1){
    currentCategoryIndex++;
    renderCategory();
  }
});

qs('#prevBtn').addEventListener('click',async()=>{
  await saveAnswers();
  if(currentCategoryIndex>0){
    currentCategoryIndex--;
    renderCategory();
  }
});

function tick(){
  if(!game?.endsAt){
    qs('#timer').textContent='--:--';
    return;
  }
  const end=game.endsAt.toMillis?game.endsAt.toMillis():game.endsAt;
  const ms=end-Date.now();
  qs('#timer').textContent=fmtTime(ms);
  if(ms<=0&&game.status==='playing') requestStop('TEMPO');
}

qs('#stopBtn').addEventListener('click',async()=>{
  await saveAnswers();
  await requestStop(team.name);
});

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
  }catch(e){console.error(e)}
}

let flashedRound=0;
function showFlash(who){
  if(!game||flashedRound===game.round) return;
  flashedRound=game.round;
  qs('#flashWho').textContent=who;
  qs('#flash').classList.add('show');
  setTimeout(()=>qs('#flash').classList.remove('show'),1600);
}

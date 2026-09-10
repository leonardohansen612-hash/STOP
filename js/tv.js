import {db,gameRef,onSnapshot,collection} from './firebase.js';
import {qs,esc,fmtTime} from './common.js';

let game=null,teams=[],timerInt=null;
let previousStatus=null,previousRound=0;
let introTimer=null,stopTimer=null,resultTimer=null;
let audioCtx=null,soundEnabled=false,lastSecondBeep=null;
let lastKnownScores=new Map();

// Biblioteca de áudios do STOP.
// Escolhe aleatoriamente e evita repetir o mesmo som duas vezes seguidas.
const stopSoundFiles=[
  './assets/pare.mp3?v=1',
  './assets/para-para-para-aeee.mp3?v=1',
  './assets/mark-ronson-uptown-funk-ft.mp3?v=1',
  './assets/stop_1.mp3?v=1',
  './assets/its-time-to-stop-button.mp3?v=1'
];

const stopAudios=stopSoundFiles.map(src=>{
  const a=new Audio(src);
  a.preload='auto';
  a.volume=1;
  return a;
});
let lastStopSoundIndex=-1;

function pickStopSoundIndex(){
  if(stopAudios.length<=1) return 0;
  let idx;
  do{
    idx=Math.floor(Math.random()*stopAudios.length);
  }while(idx===lastStopSoundIndex);
  lastStopSoundIndex=idx;
  return idx;
}

function buildQr(){
  const joinUrl=new URL('./',window.location.href).href;
  qs('#joinUrl').textContent=joinUrl.replace(/^https?:\/\//,'').replace(/\/$/,'');
  const box=qs('#qrcode');
  box.innerHTML='';
  if(window.QRCode){
    new QRCode(box,{
      text:joinUrl,width:300,height:300,
      correctLevel:QRCode.CorrectLevel.H,
      colorDark:'#111111',colorLight:'#ffffff'
    });
  }else box.innerHTML='<div class="muted">QR Code indisponível</div>';
}
buildQr();

function ensureAudio(){
  if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended') audioCtx.resume();
}
function tone(freq,duration=.12,type='sine',gain=.055,delay=0){
  if(!soundEnabled) return;
  ensureAudio();
  const now=audioCtx.currentTime+delay;
  const osc=audioCtx.createOscillator(),g=audioCtx.createGain();
  osc.type=type;osc.frequency.setValueAtTime(freq,now);
  g.gain.setValueAtTime(.0001,now);
  g.gain.exponentialRampToValueAtTime(gain,now+.012);
  g.gain.exponentialRampToValueAtTime(.0001,now+duration);
  osc.connect(g);g.connect(audioCtx.destination);osc.start(now);osc.stop(now+duration+.03);
}
function soundIntro(){tone(330,.12,'triangle',.045);tone(494,.15,'triangle',.05,.13);tone(659,.34,'triangle',.06,.28)}
function soundStop(){
  if(!soundEnabled) return;
  try{
    stopAudios.forEach(a=>{
      a.pause();
      a.currentTime=0;
    });

    const chosen=stopAudios[pickStopSoundIndex()];
    const p=chosen.play();
    if(p?.catch) p.catch(()=>{});
  }catch(_){}
}
function soundResult(){tone(523,.12,'triangle',.045);tone(659,.12,'triangle',.05,.12);tone(784,.28,'triangle',.06,.24)}
function soundTick(){tone(920,.055,'square',.025)}
qs('#soundToggle')?.addEventListener('click',()=>{
  soundEnabled=!soundEnabled;
  if(soundEnabled){
    ensureAudio();
    stopAudios.forEach(a=>a.load());
    soundIntro();
  }else{
    stopAudios.forEach(a=>{
      try{a.pause();a.currentTime=0}catch(_){}
    });
  }
  const b=qs('#soundToggle');
  b.textContent=soundEnabled?'🔊 SOM LIGADO':'🔇 ATIVAR SOM';
  b.classList.toggle('on',soundEnabled);
});

onSnapshot(gameRef,s=>{
  const next=s.exists()?s.data():null;
  const oldStatus=game?.status||previousStatus;
  const oldRound=game?.round||previousRound;
  game=next;
  handleTransitions(oldStatus,oldRound);
  render();
  previousStatus=game?.status||'lobby';
  previousRound=game?.round||0;
});

onSnapshot(collection(db,'games',gameRef.id,'teams'),s=>{
  const oldScores=new Map(teams.map(t=>[t.id,Number(t.score||0)]));
  teams=s.docs.map(d=>({id:d.id,...d.data()}));
  if(oldScores.size) lastKnownScores=oldScores;
  render();
});

function showOverlay(id,ms){
  const el=qs(id); if(!el) return;
  el.classList.add('show');
  const timer=setTimeout(()=>el.classList.remove('show'),ms);
  return timer;
}
function hideOverlay(id){qs(id)?.classList.remove('show')}

function handleTransitions(oldStatus,oldRound){
  const status=game?.status||'lobby';
  const round=game?.round||0;

  // Nova rodada: revelação cinematográfica da letra.
  if(status==='playing' && (oldStatus!=='playing' || round!==oldRound)){
    hideOverlay('#stopOverlay');hideOverlay('#resultOverlay');
    qs('#introLetter').textContent=game.letter||'?';
    qs('#introRound').textContent=`RODADA ${round}`;
    clearTimeout(introTimer);
    introTimer=showOverlay('#roundIntro',2350);
    soundIntro();
  }

  // STOP: impacto em tela cheia.
  if(status==='stopped' && oldStatus!=='stopped'){
    hideOverlay('#roundIntro');
    qs('#stopWho').textContent=game.stopByName||'';
    clearTimeout(stopTimer);
    stopTimer=showOverlay('#stopOverlay',2100);
    soundStop();
  }

  // A correção automática pode ser muito rápida. Quando volta ao lobby,
  // mostramos um resumo usando lastRoundPoints já gravado nas equipes.
  if(status==='lobby' && (oldStatus==='review' || oldStatus==='stopped') && round>0){
    setTimeout(()=>showRoundResult(),180);
  }
}

function showRoundResult(){
  if(!teams.length) return;
  const roundPoints=[...teams]
    .map(t=>({...t,roundPts:Number(t.lastRoundPoints||0)}))
    .sort((a,b)=>b.roundPts-a.roundPts || Number(b.score||0)-Number(a.score||0));

  const best=roundPoints[0];
  qs('#resultTeam').textContent=best?.name||'Rodada concluída';
  qs('#resultPoints').textContent=`+${best?.roundPts||0} PTS`;

  const ordered=[...teams]
    .sort((a,b)=>(b.score||0)-(a.score||0) || String(a.name||'').localeCompare(String(b.name||''),'pt-BR'))
    .slice(0,3);
  qs('#resultRanking').innerHTML=ordered.map((t,i)=>`
    <div class="result-rank">${i+1}º ${esc(t.name||'Equipe')}<strong>${Number(t.score||0)} pts</strong></div>
  `).join('');

  clearTimeout(resultTimer);
  resultTimer=showOverlay('#resultOverlay',4200);
  soundResult();
}

function renderRankCards(targetId){
  const el=qs(targetId); if(!el) return;
  const ordered=[...teams]
    .sort((a,b)=>(b.score||0)-(a.score||0) || String(a.name||'').localeCompare(String(b.name||''),'pt-BR'))
    .slice(0,5);

  if(!ordered.length){
    el.innerHTML='<div class="tv-empty">Aguardando equipes...</div>';
    return;
  }
  el.innerHTML=ordered.map((t,i)=>`
    <div class="tv-rank-card ${i===0?'first':''}">
      <span class="tv-rank-pos">${i+1}º</span>
      <span class="tv-rank-name">${esc(t.name||'Equipe')}</span>
      <strong>${t.score||0} pts</strong>
    </div>
  `).join('');
}

function render(){
  const status=game?.status||'lobby';
  qs('#statusText').textContent=
    status==='playing'?'AO VIVO':
    status==='stopped'?'STOP':
    status==='review'?'CORRIGINDO COM IA':
    'AGUARDANDO';
  qs('#dot').className='dot '+(status==='playing'?'live':status==='stopped'?'stop':'');
  qs('#roundBadge').textContent=`RODADA ${game?.round||0}`;

  qs('#lobby').hidden=status!=='lobby';
  qs('#playing').hidden=status!=='playing';
  qs('#review').hidden=status!=='review';

  const teamCount=qs('#teamCount');
  if(teamCount) teamCount.textContent=teams.length;
  const lobbyTeams=qs('#teamsLobby');
  if(lobbyTeams){
    lobbyTeams.innerHTML=teams.length
      ? teams.map(t=>`<div class="tv-team-pill">${esc(t.name||'Equipe')}</div>`).join('')
      : '<div class="tv-empty">Nenhuma equipe entrou ainda.</div>';
  }

  renderRankCards('#rankCards');
  renderRankCards('#rankCardsPlaying');

  if(status==='playing'){
    qs('#letter').textContent=game.letter||'?';
    qs('#cats').innerHTML=(game.categories||[]).map((c,i)=>`
      <div class="tv-cat"><span>${i+1}</span>${esc(c)}</div>
    `).join('');
    clearInterval(timerInt);
    tick();
    timerInt=setInterval(tick,200);
  }else{
    clearInterval(timerInt);
    lastSecondBeep=null;
  }

  if(status==='review') renderReview();
}

function tick(){
  const timer=qs('#timer'),card=document.querySelector('.tv-timer-card'),bar=qs('#timeProgress');
  if(!game?.endsAt){
    timer.textContent='--:--';card?.classList.remove('timer-danger');
    if(bar) bar.style.transform='scaleX(1)';
    return;
  }
  const end=game.endsAt.toMillis?game.endsAt.toMillis():game.endsAt;
  const remaining=Math.max(0,end-Date.now());
  timer.textContent=fmtTime(remaining);
  card?.classList.toggle('timer-danger',remaining<=10000);

  const start=game.startedAt?.toMillis?game.startedAt.toMillis():null;
  if(start && end>start && bar){
    const pct=Math.max(0,Math.min(1,remaining/(end-start)));
    bar.style.transform=`scaleX(${pct})`;
  }

  const sec=Math.ceil(remaining/1000);
  if(soundEnabled && sec<=5 && sec>0 && sec!==lastSecondBeep){
    lastSecondBeep=sec;soundTick();
  }
}

function renderReview(){
  qs('#reviewRound').textContent=game?.round||'-';
  let html='';
  const reviewScores=game?.reviewScores||{};
  (game.categories||[]).forEach((c,idx)=>{
    html+=`<div class="tv-review-card">
      <div class="tv-review-cat"><span>${idx+1}</span>${esc(c)}</div>
      <div class="tv-review-answers">`;
    teams.forEach(t=>{
      const key=`${t.id}|${c}`;
      const answer=(t.round===game.round&&t.answers?.[c])||'—';
      const score=reviewScores[key];
      html+=`<div class="tv-review-row">
        <b>${esc(t.name||'Equipe')}</b>
        <span>${esc(answer)}</span>
        ${score!==undefined?`<strong class="tv-review-score">+${score}</strong>`:''}
      </div>`;
    });
    html+='</div></div>';
  });
  qs('#reviewTv').innerHTML=html;
}

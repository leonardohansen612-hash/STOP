import {db,gameRef,onSnapshot,collection} from './firebase.js';
import {qs,esc,fmtTime} from './common.js';

let game=null,teams=[],timerInt=null,lastFlash=0;

function buildQr(){
  const joinUrl=new URL('./',window.location.href).href;
  qs('#joinUrl').textContent=joinUrl.replace(/^https?:\/\//,'').replace(/\/$/,'');
  const box=qs('#qrcode');
  box.innerHTML='';
  if(window.QRCode){
    new QRCode(box,{
      text:joinUrl,
      width:300,
      height:300,
      correctLevel:QRCode.CorrectLevel.H,
      colorDark:'#111111',
      colorLight:'#ffffff'
    });
  }else{
    box.innerHTML='<div class="muted">QR Code indisponível</div>';
  }
}
buildQr();

onSnapshot(gameRef,s=>{
  game=s.exists()?s.data():null;
  render();
});

onSnapshot(collection(db,'games',gameRef.id,'teams'),s=>{
  teams=s.docs.map(d=>({id:d.id,...d.data()}));
  render();
});

function renderRankCards(targetId){
  const el=qs(targetId);
  if(!el) return;

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
    status==='playing'?'Jogando':
    status==='stopped'?'STOP':
    status==='review'?'Correção':
    'Aguardando';

  qs('#dot').className='dot '+(status==='playing'?'live':status==='stopped'?'stop':'');

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
    timerInt=setInterval(tick,250);
  }else{
    clearInterval(timerInt);
  }

  if(status==='stopped'&&lastFlash!==game.round){
    lastFlash=game.round;
    qs('#flashWho').textContent=game.stopByName||'';
    qs('#flash').classList.add('show');
    setTimeout(()=>qs('#flash').classList.remove('show'),2200);
  }

  if(status==='review') renderReview();
}

function tick(){
  if(!game?.endsAt){
    qs('#timer').textContent='--:--';
    return;
  }
  const end=game.endsAt.toMillis?game.endsAt.toMillis():game.endsAt;
  qs('#timer').textContent=fmtTime(end-Date.now());
}

function renderReview(){
  qs('#reviewRound').textContent=game?.round||'-';
  let html='';
  (game.categories||[]).forEach((c,idx)=>{
    html+=`<div class="tv-review-card">
      <div class="tv-review-cat"><span>${idx+1}</span>${esc(c)}</div>
      <div class="tv-review-answers">`;
    teams.forEach(t=>{
      html+=`<div class="tv-review-row">
        <b>${esc(t.name||'Equipe')}</b>
        <span>${esc((t.round===game.round&&t.answers?.[c])||'—')}</span>
      </div>`;
    });
    html+='</div></div>';
  });
  qs('#reviewTv').innerHTML=html;
}

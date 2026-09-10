import {db,gameRef,doc,setDoc,serverTimestamp} from './firebase.js?v=20260910-9';
import {qs,getTeamId} from './common.js?v=20260910-9';

const form=qs('#joinForm');
const input=qs('#teamName');
const btn=form.querySelector('button[type="submit"]');

form.addEventListener('submit',async e=>{
  e.preventDefault();
  const name=input.value.trim();
  if(!name) return;

  btn.disabled=true;
  btn.textContent='ENTRANDO...';

  try{
    const teamId=getTeamId();
    await setDoc(doc(db,'games',gameRef.id,'teams',teamId),{
      name,
      score:0,
      joinedAt:serverTimestamp(),
      answers:{},
      round:0
    },{merge:true});

    sessionStorage.setItem('texStopTeamName',name);
    // O primeiro carregamento do game em alguns celulares só passa a receber
    // as mudanças do Firestore depois de um refresh. Marcamos a entrada para
    // o game.html fazer UM bootstrap automático, antes de exibir a espera.
    sessionStorage.setItem('texStopNeedsFirstBoot','1');
    window.location.replace(`game.html?join=${Date.now()}`);
  }catch(err){
    console.error(err);
    btn.disabled=false;
    btn.textContent='ENTRAR NO JOGO';
    alert('Não foi possível entrar no jogo. Tente novamente.');
  }
});

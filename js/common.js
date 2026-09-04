export const DEFAULT_CATEGORIES=["Nome","Animal","Cidade","Objeto","Comida","Bebida","Marca","Profissão","País","Filme ou Série"];
export const LETTERS="ABCDEFGHILMNOPRSTUV".split("");
export function qs(s){return document.querySelector(s)}
export function qsa(s){return [...document.querySelectorAll(s)]}
export function esc(s=''){return String(s).replace(/[&<>'\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'\"':"&quot;"}[c]))}
export function norm(s=''){return s.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
export function randomLetter(){return LETTERS[Math.floor(Math.random()*LETTERS.length)]}
export function fmtTime(ms){const s=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
export function getTeamId(){let id=sessionStorage.getItem('texStopTeamId');if(!id){id=crypto.randomUUID();sessionStorage.setItem('texStopTeamId',id)}return id}

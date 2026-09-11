(function(){
'use strict';
const MODES={
 bp:{name:'BP',open:18,summary:'隨機開 18 角；流程為紅1禁、藍1禁、紅1選、藍1選；紅2禁、藍2禁、紅2選、藍2選；藍3禁、紅3禁、藍3選、紅3選。角色固定進入對應座位。'},
 fearless:{name:'無懼',open:52,summary:'52 角全開；各方前幾局使用過的角色僅該方不能再選。紅、藍各先禁一角，選角順序紅藍紅藍藍紅，可各使用一次 Insert Ban。'},
 cm01:{name:'CM01',open:20,summary:'隨機開 20 角；紅方禁一角、藍方禁兩角。選角順序紅藍紅藍藍紅，可自由安排座位並各使用一次 Insert Ban。'},
 rdbp:{name:'RD+BP',open:20,summary:'52 角隨機各分 26 角；雙方各移除 3 角後，從剩餘 46 角隨機開 20 角，接著依 CM01 流程禁選。'},
 re:{name:'Re.星杯戰爭',open:52,summary:'固定為無懼選角五連戰、100 秒、人機對戰。每場將遭遇一支曾參賽隊伍。'}
};
const PICK_ORDER=['red','blue','red','blue','blue','red'];
const SEAT_ORDER=[['red',0],['blue',0],['red',1],['blue',1],['blue',2],['red',2]];
const BP_STEPS=[
 ['bp-ban','red',0],['bp-ban','blue',0],['bp-pick','red',0],['bp-pick','blue',0],
 ['bp-ban','red',1],['bp-ban','blue',1],['bp-pick','red',1],['bp-pick','blue',1],
 ['bp-ban','blue',2],['bp-ban','red',2],['bp-pick','blue',2],['bp-pick','red',2]
];
let state=null,timerId=null,storyTimer=null,onlinePollId=null,learningEnabled=false,learningRequestKey='',favoriteName='',playerName='',seatDockCleanup=null;
const q=id=>document.getElementById(id), teamName=t=>t==='red'?'紅方':'藍方', other=t=>t==='red'?'blue':'red';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const byId=id=>characters.find(c=>c.id===Number(id));
const API_BASE=String(window.ASTERIATED_API_BASE||'').replace(/\/$/,'');
async function api(path,payload={},token=''){
 if(!API_BASE||API_BASE.includes('REPLACE-WITH'))throw new Error('後端尚未部署，請先設定 config.js 的 Worker 網址');
 const headers={'content-type':'application/json'};if(token)headers['x-player-token']=token;
 const response=await fetch(API_BASE+path,{method:'POST',headers,body:JSON.stringify(payload)});
 const data=await response.json().catch(()=>({ok:false,error:'伺服器回應格式錯誤'}));
 if(!response.ok||data.ok===false)throw new Error(data.error||`伺服器錯誤 (${response.status})`);
 return data;
}
function renderFavoriteGrid(){
 const box=q('favoriteGrid');if(!box)return;box.innerHTML='';
 characters.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='favorite-card'+(favoriteName===c.name?' selected':'');b.innerHTML=`<img decoding="async" loading="lazy" src="${c.image}" alt=""><span>${esc(c.name)}</span>`;b.onclick=()=>{favoriteName=c.name;renderFavoriteGrid()};box.appendChild(b)});
}
document.querySelectorAll('.versus-mode-btn').forEach(btn=>btn.onclick=()=>selectMode(btn.dataset.mode));
q('versusSeriesLength').onchange=()=>state&&render();q('versusTimer').onchange=()=>state&&startTimer();
q('versusLearningToggle').onclick=()=>{learningEnabled=!learningEnabled;learningRequestKey='';const b=q('versusLearningToggle');b.classList.toggle('active',learningEnabled);b.setAttribute('aria-pressed',String(learningEnabled));b.textContent=learningEnabled?'◇ 學習模式：開啟':'◇ 學習模式：關閉'};
q('profileStartBtn').onclick=()=>startSeries();
function selectMode(mode){
 gameMode=mode;document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));document.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');
 if(q('chainConfig'))q('chainConfig').classList.add('hidden');q('versusConfig').classList.toggle('hidden',mode==='re');q('reConfig').classList.toggle('hidden',mode!=='re');
 if(mode!=='re')q('versusRuleSummary').textContent=MODES[mode].summary;q('profileError').textContent='';
}
function teamKey(value){return String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'')}
function reTeamForSide(side){return side===state?.playerTeam?state.teamName:(state?.reOpponent?.name||'對戰隊伍')}
function sideLabel(side){return state?.mode==='re'?`${teamName(side)}・${reTeamForSide(side)}`:teamName(side)}
function reOpponentAvatar(){
 const team=state?.reOpponent?.sourceName||state?.reOpponent?.name,rows=(window.RE_DIALOGUES||[]).filter(x=>x.team&&teamKey(x.team)===teamKey(team)),ids=shuffle([...new Set(rows.map(x=>byName(x.character)?.id).filter(Boolean))]);
 return ids[0]||state?.reOpponent?.rounds?.flat().map(byName).find(Boolean)?.id||characters[0]?.id;
}
function chooseReTeamRecords(){
 const groups=new Map();for(const rec of window.RE_TEAM_DRAFTS||[]){const key=teamKey(rec.name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(rec)}
 const teams=[];for(const list of groups.values()){const ranked=list.slice().sort((a,b)=>recordCompleteness(b)-recordCompleteness(a)).slice(0,2);ranked.forEach((rec,index)=>teams.push(completeReTeamRecord(rec,index?`${rec.name}支隊`:rec.name)))}
 return shuffle(teams).slice(0,5);
}
function recordCompleteness(record){return Array.from({length:5},(_,index)=>Math.min(3,Array.isArray(record?.rounds?.[index])?record.rounds[index].filter(name=>byName(name)).length:0)).reduce((a,b)=>a+b,0)}
function completeReTeamRecord(record,displayName=record?.name||'參賽隊伍'){const rounds=[],used=new Set();for(let index=0;index<5;index++){const valid=[...new Set((Array.isArray(record?.rounds?.[index])?record.rounds[index]:[]).filter(name=>byName(name)))].slice(0,3);const available=shuffle(characters.map(c=>c.name).filter(name=>!used.has(name)&&!valid.includes(name)));while(valid.length<3&&available.length)valid.push(available.pop());valid.forEach(name=>used.add(name));rounds.push(valid)}return{...record,name:displayName,sourceName:record?.name||displayName,rounds}}
function startSeries(){
 const entered=q('playerNameInput').value.trim().slice(0,30),isRe=gameMode==='re';
 if(isRe&&(!entered||!favoriteName)){q('profileError').textContent='請先輸入隊伍名稱並選擇本命角色';return}
 if(!isRe&&q('versusBattleType').value==='online')return showOnlineLobby();
 playerName=entered||'玩家';
 const total=isRe?5:(Number(q('versusSeriesLength').value)||1);
 state={mode:gameMode,total,match:0,matchActive:false,history:[],used:{red:new Set(),blue:new Set()},phase:null,pool:[],banned:new Set(),seats:{red:[null,null,null],blue:[null,null,null]},insert:{red:true,blue:true},log:[],events:[],rdHands:null,rdRemoved:{red:new Set(),blue:new Set()},seconds:0,delegated:false,playMode:isRe?'ai':q('versusBattleType').value,learning:isRe?false:learningEnabled,playerTeam:null,marks:{diamond:new Set(),danger:new Set()},teamName:playerName,favorite:isRe?favoriteName:'',reTeams:isRe?chooseReTeamRecords():[],rePlayerUsed:new Set(),reFavoriteUsed:false,reFavoriteSeen:0,reOpponent:null};
 q('profileError').textContent='';q('profilePanel').classList.add('hidden');q('gamePanel').classList.add('hidden');q('resultPanel').classList.add('hidden');q('chainResultPanel').classList.add('hidden');q('versusPanel').classList.remove('hidden');
 if(isRe)showReStory();else startMatchSafe();
}
function showReStory(){
 clearTimeout(storyTimer);const team=state.teamName.endsWith('隊')?state.teamName:`${state.teamName}隊`;
 const lines=[`如果當時選${state.favorite}就好了...`,'....','......','種種的回憶仍然困著你，難以走出過往失利的陰霾。','你走在路上，急促的喇叭聲越來越近，車燈在你眼前瞬間越放越大...','....','一道白光之後，你睜開眼',`『${team}，請趕快入座』，你被主辦的聲音喚回神，`,'旁邊的隊友也催促你趕緊入座。','『原來...我穿越回那場比賽開始前嗎？』'];
 const p=q('versusPanel');p.innerHTML=`<div class="re-story-page"><button id="reStorySkip" class="re-story-skip">Skip</button><div id="reStoryBox" class="re-story-box" role="button" tabindex="0"><div id="reStoryText" class="re-story-text"></div><button id="reStoryEnter" class="vs-btn re-story-enter hidden">確認，進入比賽</button></div></div>`;
 let line=0,pos=0,done=false,entering=false;const text=q('reStoryText'),box=q('reStoryBox');
 const draw=()=>{text.innerHTML=lines.map((x,i)=>`<div class="${i===line&&!done?'typing':''}">${esc(i<line||done?x:i===line?x.slice(0,pos):'')}</div>`).join('')};
 const tick=()=>{if(done)return;if(pos<lines[line].length){pos++;draw();storyTimer=setTimeout(tick,46);return}if(line<lines.length-1){line++;pos=0;draw();storyTimer=setTimeout(tick,320);return}done=true;draw();q('reStoryEnter').classList.remove('hidden')};
 const speed=()=>{if(done)return;pos=lines[line].length;draw();clearTimeout(storyTimer);storyTimer=setTimeout(tick,120)};
 const enter=event=>{event?.preventDefault();event?.stopPropagation();if(entering)return;entering=true;clearTimeout(storyTimer);state.matchActive=false;p.innerHTML='';startMatchSafe()};
 box.onclick=e=>{if(e.target.id==='reStoryEnter')enter(e);else speed()};box.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();speed()}};q('reStorySkip').addEventListener('click',enter,{once:true});draw();tick();
}
+function showOnlineLobby(message=''){
 q('profilePanel').classList.add('hidden');q('versusPanel').classList.remove('hidden');
 q('versusPanel').innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-battle-title">雙人線上對戰</div><div class="vs-title">建立房間或輸入朋友的房號</div>${message?`<p>${message}</p>`:''}<div class="vs-toolbar"><button id="vsCreateRoom" class="vs-btn">建立新房間</button><button id="vsJoinRoom" class="vs-btn">輸入房號加入</button><button id="vsReconnect" class="vs-btn">重新連線</button><button id="vsQuit" class="vs-btn danger">回到首頁</button></div></div>`;
 q('vsCreateRoom').onclick=createOnlineRoom;q('vsJoinRoom').onclick=()=>joinOnlineRoom();q('vsReconnect').onclick=()=>joinOnlineRoom(true);q('vsQuit').onclick=quit;
}
async function createOnlineRoom(){
 try{const made=await api('/api/rooms',{mode:gameMode,seriesLength:Number(q('versusSeriesLength').value)||1});await joinOnlineRoom(false,made.code)}catch(e){showOnlineLobby(e.message)}
}
async function joinOnlineRoom(reconnect=false,given=''){
 const code=String(given||prompt('請輸入 6 位房號')||'').trim().toUpperCase();if(!code)return;
 try{
  let token=reconnect?sessionStorage.getItem(`ag-room-${code}`):'';
  let joined;if(token)joined=await api(`/api/rooms/${code}/state`,{},token);else{joined=await api(`/api/rooms/${code}/join`,{});token=joined.token;sessionStorage.setItem(`ag-room-${code}`,token)}
  state={online:{code,token,version:0},playMode:'online',learning:learningEnabled,marks:{diamond:new Set(),danger:new Set()}};syncOnline(joined.room,joined.side);startOnlinePoll();
 }catch(e){showOnlineLobby(e.message)}
}
function syncOnline(room,side=state?.playerTeam){
 if(!state)return;const g=room.game;
 Object.assign(state,{mode:room.mode,total:room.seriesLength,match:room.matchNumber,playerTeam:side,history:(room.history||[]).map((h,i)=>({match:i+1,red:h.red,blue:h.blue,rs:h.redScore,bs:h.blueScore,trash:[h.trash]})),used:{red:new Set(room.used.red),blue:new Set(room.used.blue)},phase:g?.phase||null,pool:g?.pool||[],banned:new Set(g?.banned||[]),seats:g?.seats||{red:[null,null,null],blue:[null,null,null]},insert:g?.insert||{red:true,blue:true},rdHands:g?.rdHands?{red:new Set(g.rdHands.red),blue:new Set(g.rdHands.blue)}:null,rdRemoved:g?.rdRemoved?{red:new Set(g.rdRemoved.red),blue:new Set(g.rdRemoved.blue)}:{red:new Set(),blue:new Set()},log:(g?.events||[]).slice(-8).map(eventLabel)});
 state.online.version=room.version;state.online.status=room.status;learningRequestKey='';
 if(room.status==='waiting')renderOnlineWaiting();else if(room.status==='result'||room.status==='completed'){renderResult(room.result.redScore,room.result.blueScore);wireOnlineResult(room.status)}else if(state.phase?.kind==='rd-remove'&&state.phase.controller!==state.playerTeam)renderOnlinePrivateWait();else render();
}
function eventLabel(e){const c=e.characterId&&byId(e.characterId);return`${teamName(e.team)} ${e.action}${c?' '+c.name:''}`}
function renderOnlineWaiting(){q('versusPanel').innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-battle-title">房號 ${state.online.code}</div><div class="vs-title">你是${teamName(state.playerTeam)}，等待另一位玩家加入</div><p>把房號 <b>${state.online.code}</b> 傳給朋友。對方加入後會自動開始。</p><button id="vsCopyRoom" class="vs-btn">複製房號</button><button id="vsQuit" class="vs-btn danger">離開</button></div>`;q('vsCopyRoom').onclick=()=>navigator.clipboard?.writeText(state.online.code);q('vsQuit').onclick=quit}
function wireOnlineResult(status){if(q('vsNext'))q('vsNext').onclick=()=>onlineAction({action:'next'});if(q('vsRestart'))q('vsRestart').onclick=showOnlineLobby;if(status==='completed'&&q('vsRestart'))q('vsRestart').textContent='建立新房間'}
function startOnlinePoll(){clearInterval(onlinePollId);onlinePollId=setInterval(async()=>{if(!state?.online)return;try{const out=await api(`/api/rooms/${state.online.code}/state`,{},state.online.token);if(out.room.version!==state.online.version)syncOnline(out.room,out.side)}catch(e){console.warn('房間同步：',e.message)}},1200)}
async function onlineAction(action){
 try{const out=await api(`/api/rooms/${state.online.code}/action`,{version:state.online.version,...action},state.online.token);syncOnline(out.room,out.side)}catch(e){alert(e.message);try{const fresh=await api(`/api/rooms/${state.online.code}/state`,{},state.online.token);syncOnline(fresh.room,fresh.side)}catch(_){}}
}
function startMatchSafe(){for(let attempt=0;attempt<3;attempt++){try{startMatch();return true}catch(error){console.error(`第 ${state?.history?.length+1||1} 場載入失敗（第 ${attempt+1} 次）：`,error);clearInterval(timerId);state.matchActive=false;if(state?.mode==='re'&&state.reTeams){const replacement=chooseReTeamRecords()[0];if(replacement)state.reTeams[state.history.length]=replacement}}}const p=q('versusPanel');if(p)p.innerHTML=`<div class="vs-result"><div class="vs-title">本場資料載入失敗</div><p>系統已排除異常隊伍，請按下方按鈕重新抽選對手。</p><button id="vsRecover" class="vs-btn">重新載入本場</button><button id="vsHome" class="vs-btn">回到首頁</button></div>`;if(q('vsRecover'))q('vsRecover').onclick=startMatchSafe;if(q('vsHome'))q('vsHome').onclick=quit;return false}
function startMatch(){
 if(state.matchActive)return;if(state.history.length>=state.total){if(state.mode==='re')renderReFinal();return}state.matchActive=true;state.match=state.history.length+1;learningRequestKey='';state.banned=new Set();state.seats={red:[null,null,null],blue:[null,null,null]};state.insert={red:true,blue:true};state.log=[];state.events=[];state.delegated=false;state.playerTeam=state.playMode==='ai'?(Math.random()<.5?'red':'blue'):null;
 if(state.mode==='re'){
   state.reOpponent=state.reTeams[state.match-1]||chooseReTeamRecords()[0];
   const cpu=other(state.playerTeam),prior=(state.reOpponent?.rounds||[]).slice(0,state.match-1).flat().map(name=>characters.find(c=>c.name===name)?.id).filter(Boolean);
   state.used={red:new Set(),blue:new Set()};state.used[state.playerTeam]=new Set(state.rePlayerUsed);state.used[cpu]=new Set(prior);state.reOpponentAvatarId=reOpponentAvatar();
   if(!state.rePlayerUsed.has(byName(state.favorite)?.id))state.reFavoriteSeen++;
 }
 if(state.mode==='rdbp'){
   const all=shuffle(characters.map(c=>c.id));state.rdHands={red:new Set(all.slice(0,26)),blue:new Set(all.slice(26))};state.rdRemoved={red:new Set(),blue:new Set()};state.pool=all;state.phase={kind:'rd-handover',team:'red',controller:'red'};
 }else{
   state.pool=['fearless','re'].includes(state.mode)?characters.map(c=>c.id):shuffle(characters.map(c=>c.id)).slice(0,MODES[state.mode].open);beginBan();
 }
 log(`第 ${state.match} 場開始：${MODES[state.mode].name}${state.mode==='re'?'・對手 '+state.reOpponent.name:''}`);render();if(state.phase.kind!=='rd-handover')startTimer();
}
function beginBan(){
 if(state.mode==='bp')setBpStep(0);
 else state.phase={kind:'ban',step:0,team:'red',controller:'red'};
}
function setBpStep(step){const item=BP_STEPS[step];if(!item)return finishMatch();const [kind,team,seat]=item;state.phase={kind,bpStep:step,team,controller:team,seat}}
function phaseText(){const p=state.phase;if(!p)return'';
 if(p.kind==='rd-handover')return`請將裝置交給${sideLabel(p.controller)}`;
 if(p.kind==='rd-remove')return`${sideLabel(p.controller)}從自己的 26 角移除角色（剩 ${p.remaining} 角）`;
 if(p.kind==='bp-ban')return`${p.seat===0?sideLabel(p.team)+(p.team==='red'?'1':'1'):sideLabel(p.team)+(p.seat+1)}玩家禁角`;
 if(p.kind==='bp-pick')return`${sideLabel(p.team)}${p.seat+1}玩家選角，將固定放入${teamName(p.team)}${p.seat+1}`+(state.delegated?`（由${sideLabel(p.controller)}代選）`:'');
 if(p.kind==='ban')return`${sideLabel(p.controller)}禁角`;
 if(p.kind==='insert')return`${sideLabel(p.controller)}使用 Insert Ban`;
 if(p.kind==='pick')return`${sideLabel(p.team)}選角`+(state.delegated?`（由${sideLabel(p.controller)}代選）`:'');return''}
function availableFor(id){const p=state.phase;if(!p||state.banned.has(id)||state.seats.red.includes(id)||state.seats.blue.includes(id))return false;
 if(state.playMode==='online'&&p.controller!==state.playerTeam)return false;
 if(p.kind==='rd-remove')return state.rdHands[p.controller].has(id)&&!state.rdRemoved[p.controller].has(id);
 if(['fearless','re'].includes(state.mode)&&['ban','insert'].includes(p.kind)&&state.used[other(p.controller)].has(id))return false;
 if(p.kind==='pick'||p.kind==='bp-pick'){if(['fearless','re'].includes(state.mode)&&state.used[p.team].has(id))return false;}
 return state.pool.includes(id);
}
function choose(id){const p=state.phase;
 if(p?.kind==='pick'&&state.pendingPick===id){state.pendingPick=null;render();startTimer();return;}
 if(!availableFor(id))return;
 if(state.playMode==='online'){
  if(p.kind==='pick'){state.pendingPick=id;renderSeatsChoice();return}
  return void onlineAction({action:'select',characterId:id});
 }
 if(p.kind==='rd-remove'){state.rdRemoved[p.controller].add(id);recordEvent('remove',p.controller,id);log(`${teamName(p.controller)}移除 ${byId(id).name}`);p.remaining--;if(!p.remaining){if(p.controller==='red'){clearInterval(timerId);state.log=[];state.phase={kind:'rd-handover',team:'blue',controller:'blue'};render();return}else{const left=characters.map(c=>c.id).filter(x=>!state.rdRemoved.red.has(x)&&!state.rdRemoved.blue.has(x));state.pool=shuffle(left).slice(0,20);state.log=[];beginBan();}}render();startTimer();return;}
 if(['ban','bp-ban','insert'].includes(p.kind)){state.banned.add(id);recordEvent(p.kind==='insert'?'insert-ban':'ban',p.controller,id);log(`${teamName(p.controller)}禁用 ${byId(id).name}${p.kind==='insert'?'（Insert Ban）':''}`);advanceAfterBan();return;}
 if(p.kind==='bp-pick'){state.seats[p.team][p.seat]=id;recordEvent('pick',p.team,id,p.seat);log(`${teamName(p.controller)}為${teamName(p.team)}${p.seat+1}選擇 ${byId(id).name}`);state.delegated=false;advanceBpStep();return;}
 if(p.kind==='pick'){state.pendingPick=id;renderSeatsChoice();}
}
function advanceAfterBan(){const p=state.phase;
 if(p.kind==='bp-ban'){advanceBpStep();return;}
 else if(p.kind==='insert'){state.insert[p.controller]=false;state.phase=p.resume;}
 else if(p.step===0)state.phase={kind:'ban',step:1,team:'blue',controller:'blue'};
 else if(p.step===1&&!['fearless','re'].includes(state.mode))state.phase={kind:'ban',step:2,team:'blue',controller:'blue'};
 else beginPicks();render();startTimer();
}
function skipBan(){if(!state.phase||!['ban','bp-ban','insert'].includes(state.phase.kind))return;if(state.playMode==='online')return void onlineAction({action:'skip'});recordEvent('skip-ban',state.phase.controller);log(`${teamName(state.phase.controller)}空過禁角`);advanceAfterBan();}
function advanceBpStep(){const next=state.phase.bpStep+1;if(next>=BP_STEPS.length)return finishMatch();setBpStep(next);render();startTimer();}
function beginPicks(){state.phase={kind:'pick',index:0,team:PICK_ORDER[0],controller:PICK_ORDER[0]};render();startTimer();}
function renderSeatsChoice(){clearInterval(timerId);const p=state.phase,id=state.pendingPick;const free=state.seats[p.team].map((x,i)=>x==null?i:-1).filter(i=>i>=0);if(free.length===1)return placePick(free[0]);render(free);}
function placePick(seat){const p=state.phase,id=state.pendingPick;if(id==null||state.seats[p.team][seat]!=null)return;if(state.playMode==='online'){state.pendingPick=null;return void onlineAction({action:'select',characterId:id,seatIndex:seat})}state.seats[p.team][seat]=id;recordEvent('pick',p.team,id,seat);log(`${teamName(p.controller)}為${teamName(p.team)}${seat+1}選擇 ${byId(id).name}`);state.pendingPick=null;state.delegated=false;const next=p.index+1;if(next>=PICK_ORDER.length)return finishMatch();state.phase={kind:'pick',index:next,team:PICK_ORDER[next],controller:PICK_ORDER[next]};render();startTimer();}
function useInsert(){const p=state.phase;if(!p||p.kind!=='pick'||state.pendingPick!=null)return;const blocker=other(p.team);if(!state.insert[blocker])return;if(state.playMode==='online')return void onlineAction({action:'insert'});state.phase={kind:'insert',team:blocker,controller:blocker,resume:{...p}};render();startTimer();}
function onTimeout(){const p=state.phase;if(!p)return;if(state.pendingPick!=null&&p.kind==='pick'){placePick(bestSeatFor(p.team,state.pendingPick));return}if(['ban','bp-ban','insert'].includes(p.kind)){skipBan();return;}if(p.kind==='rd-remove'){const id=state.pool.find(availableFor);if(id)choose(id);return;}if(['pick','bp-pick'].includes(p.kind)){state.delegated=true;p.controller=other(p.team);log(`${teamName(p.team)}選角超時，改由${teamName(p.controller)}代選`);render();startTimer();}}
function startTimer(){clearInterval(timerId);const limit=state?.mode==='re'?100:(Number(q('versusTimer').value)||0);state.seconds=limit;if(!limit){renderTimer();return}renderTimer();timerId=setInterval(()=>{state.seconds--;renderTimer();if(state.seconds<=0){clearInterval(timerId);onTimeout()}},1000)}
function renderTimer(){const e=q('vsTimer');if(!e)return;e.textContent=state.seconds?`${state.seconds}s`:'∞';e.classList.toggle('urgent',state.seconds>0&&state.seconds<=5)}
function reDialogueFor(team,char,fallback){
 const rows=(window.RE_DIALOGUES||[]).filter(x=>x.character===char),same=rows.filter(x=>x.team&&teamKey(x.team)===teamKey(team)),generic=rows.filter(x=>!x.team),pool=same.length?same:generic.length?generic:rows;
 return pool.length?pool[Math.floor(Math.random()*pool.length)].text:fallback;
}
async function finishMatch(){
 if(!state.matchActive||state.history.length>=state.total)return;state.matchActive=false;clearInterval(timerId);state.phase=null;
 const red=[...state.seats.red],blue=[...state.seats.blue],favorite=byName(state.favorite),isRe=state.mode==='re';
 q('versusPanel').innerHTML='<div class="vs-draft-shell vs-privacy"><div class="vs-title">伺服器正在結算…</div></div>';
 try{
  const out=await api('/api/mode/resolve',{mode:state.mode,seriesLength:state.total,matchNumber:state.match,red,blue,pool:[...state.pool],redHand:state.rdHands?[...state.rdHands.red]:null,blueHand:state.rdHands?[...state.rdHands.blue]:null,events:state.events||[],reMode:isRe,playerTeam:state.playerTeam,favoriteId:favorite?.id||null,teamName:state.teamName||null,opponentTeam:state.reOpponent?.name||null});
  for(const t of ['red','blue'])state.seats[t].forEach(id=>state.used[t].add(id));
  let rs=Number(out.redScore),bs=Number(out.blueScore);const rec={match:state.match,red,blue,rs,bs,rawRs:Number(out.rawRedScore??rs),rawBs:Number(out.rawBlueScore??bs),opponent:state.reOpponent?.name||''};
  if(isRe){
   const playerIds=rec[state.playerTeam],hasFav=playerIds.includes(favorite?.id);playerIds.forEach(id=>state.rePlayerUsed.add(id));if(hasFav)state.reFavoriteUsed=true;
   rec.bondComeback=!!out.bondComeback;rec.tieBreak=!!out.tieBreak;rec.reWinner=out.winner===state.playerTeam?'player':'cpu';rec.playerTeam=state.playerTeam;rec.favoriteUsed=hasFav;rec.trash=[out.trash||'勝負已定，命運再次向前推進。'];
   const winningSide=out.winner,winnerIds=rec[winningSide],winnerTeam=reTeamForSide(winningSide);
   if(rec.bondComeback){rec.reQuote={id:favorite.id,name:favorite.name,text:'真是受不了你呢，都傷痕累累還要硬拼。',by:`來自 ${favorite.name} 無盡的羈絆`,bond:true}}
   else{const charId=winnerIds[Math.floor(Math.random()*winnerIds.length)],char=byId(charId),fallback=rec.trash[0];rec.reQuote={id:charId,name:char.name,text:reDialogueFor(winnerTeam,char.name,fallback),by:winnerTeam}}
  }else rec.trash=[out.trash||'本場結算完成。'];
  state.history.push(rec);renderResult(rs,bs);
 }catch(e){state.matchActive=true;q('versusPanel').innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-title">結算失敗</div><p>${esc(e.message)}</p><button id="vsRetry" class="vs-btn">重試</button><button id="vsQuit" class="vs-btn danger">回到首頁</button></div>`;q('vsRetry').onclick=finishMatch;q('vsQuit').onclick=quit}
}
function log(s){state.log.push(s)}
function recordEvent(action,team,characterId=null,seatIndex=null,timedOut=false){if(!state?.events)return;state.events.push({sequence:state.events.length+1,team,action,characterId,seatIndex,timedOut})}
function isCpuTeam(team){return (state.playMode==='ai'||state.playMode==='online')&&team!==state.playerTeam}
function byName(name){return characters.find(c=>c.name===name)}
function candidateIds(team){return state.pool.filter(id=>!state.banned.has(id)&&!state.seats.red.includes(id)&&!state.seats.blue.includes(id)&&!(['fearless','re'].includes(state.mode)&&state.used[team].has(id)))}
async function rankedCandidates(team,count=3){const available=candidateIds(team);if(!available.length)return[];const out=await api('/api/recommend',{team,currentIds:state.seats[team].filter(Boolean),availableIds:available,count});return out.ids||[]}
async function refreshLearningMarks(){if(!state?.learning||!state.phase||['rd-remove','rd-handover'].includes(state.phase.kind)){state.marks={diamond:new Set(),danger:new Set()};return}const focus=state.playerTeam||(state.phase.team||state.phase.controller),enemy=other(focus),mine=state.seats[focus].filter(Boolean).length,enemyCount=state.seats[enemy].filter(Boolean).length,key=JSON.stringify([state.match,state.phase,focus,[...state.banned],state.seats]);if(key===learningRequestKey)return;learningRequestKey=key;try{const diamond=mine<3?await rankedCandidates(focus,mine===0?3:mine===1?2:1):[],danger=enemyCount>0&&enemyCount<3?await rankedCandidates(enemy,1):[];if(key!==learningRequestKey)return;state.marks={diamond:new Set(diamond),danger:new Set(danger)};render()}catch(e){console.warn('Learning mode:',e.message)}}
function bestSeatFor(team){return state.seats[team].findIndex(x=>x==null)}
async function cpuPrivateRemoval(){const team=state.phase.controller,hand=[...state.rdHands[team]],out=await api('/api/decision',{action:'remove',team,availableIds:hand,currentIds:[]});(out.ids||[]).forEach(id=>{state.rdRemoved[team].add(id);recordEvent('remove',team,id)});state.log=[];if(team==='red'){state.phase={kind:'rd-handover',team:'blue',controller:'blue'};render()}else{const left=characters.map(c=>c.id).filter(id=>!state.rdRemoved.red.has(id)&&!state.rdRemoved.blue.has(id));state.pool=shuffle(left).slice(0,20);beginBan();render();startTimer()}}
function reCpuCandidate(team){
 const available=candidateIds(team),pickNo=state.seats[team].filter(Boolean).length,script=state.reOpponent?.rounds?.[state.match-1]||[],wanted=byName(script[pickNo]);
 if(wanted&&available.includes(wanted.id))return wanted.id;
 const talkers=[...new Set((window.RE_DIALOGUES||[]).filter(x=>x.team&&teamKey(x.team)===teamKey(state.reOpponent?.sourceName||state.reOpponent?.name)).map(x=>byName(x.character)?.id).filter(id=>available.includes(id)))];
 const pool=talkers.length?talkers:available;return pool[Math.floor(Math.random()*pool.length)];
}
function maybeCpuAct(){
 if(state.playMode!=='ai'||!state.phase)return;const snapshot=state.phase;
 if(snapshot.kind==='rd-handover'&&isCpuTeam(snapshot.controller)){setTimeout(()=>{if(state.phase===snapshot)cpuPrivateRemoval().catch(e=>log(e.message))},420);return}
 if(snapshot.kind==='pick'&&snapshot.team===state.playerTeam&&isCpuTeam(other(snapshot.team))&&state.insert[other(snapshot.team)]){setTimeout(()=>{if(state.phase===snapshot&&state.pendingPick==null)useInsert()},520);return}
 if(!isCpuTeam(snapshot.controller))return;
 setTimeout(async()=>{if(state.phase!==snapshot)return;try{
   if(snapshot.kind==='rd-remove'){await cpuPrivateRemoval();return}
   if(['ban','bp-ban','insert'].includes(snapshot.kind)){const ranked=await rankedCandidates(other(snapshot.controller),1),target=ranked[0]??candidateIds(snapshot.controller)[0];if(state.phase!==snapshot)return;if(target!=null)choose(target);else skipBan();return}
   if(snapshot.kind==='bp-pick'){const ranked=await rankedCandidates(snapshot.team,1),id=ranked[0];if(state.phase===snapshot&&id!=null)choose(id);return}
   if(snapshot.kind==='pick'){const id=state.mode==='re'?reCpuCandidate(snapshot.team):(await rankedCandidates(snapshot.team,1))[0];if(state.phase===snapshot&&id!=null){state.pendingPick=id;placePick(bestSeatFor(snapshot.team))}}
  }catch(e){console.warn('CPU:',e.message)}
 },snapshot.kind==='pick'?1500:650)
}
function cardHTML(id){const c=byId(id),cpuLocked=state.playMode==='ai'&&state.phase&&isCpuTeam(state.phase.controller),pending=state.pendingPick===id,enemyHistoryLocked=['fearless','re'].includes(state.mode)&&['ban','insert'].includes(state.phase?.kind)&&state.used[other(state.phase.controller)].has(id),disabled=!availableFor(id)||cpuLocked||(state.pendingPick!=null&&!pending),classes=['vs-card'],pickedNow=state.seats.red.includes(id)||state.seats.blue.includes(id);if(state.banned.has(id))classes.push('banned');if(pickedNow)classes.push('picked');if(pending)classes.push('pending-seat');if(enemyHistoryLocked)classes.push('enemy-history-locked');if(state.marks.diamond.has(id))classes.push('learn-diamond');if(state.marks.danger.has(id))classes.push('learn-danger');let usedBadges='';if(['fearless','re'].includes(state.mode)){const redUsed=state.used.red.has(id),blueUsed=state.used.blue.has(id);if(redUsed)classes.push('used-red');if(blueUsed)classes.push('used-blue');if(redUsed&&blueUsed)classes.push('used-both');usedBadges=`<span class="vs-used-badges">${redUsed?'<i class="red">紅方已用</i>':''}${blueUsed?'<i class="blue">藍方已用</i>':''}</span>`}if(state.mode==='rdbp'&&state.phase?.kind==='rd-remove'){classes.push('assigned-'+state.phase.controller);if(state.rdRemoved[state.phase.controller].has(id))classes.push('rd-removed')}return`<button class="${classes.join(' ')}" data-id="${id}" ${disabled?'disabled':''}><span class="vs-avatar-ring"><img src="${c.image}" alt=""></span>${usedBadges}<b>${c.name}</b>${pending?'<small class="vs-place-hint">請在下方座位放置角色</small>':''}</button>`}
function mapSeatHTML(t,i,free){const id=state.seats[t][i],c=id&&byId(id),target=free?.includes(i)&&state.phase?.team===t;return`<div class="vs-map-seat ${t} ${t[0]}${i+1} ${target?'target':''}" data-seat="${i}" data-team="${t}">${t==='red'&&i===0?'<div class="vs-first">FIRST PLAYER</div>':''}${c?`<img src="${c.image}" alt=""><span class="vs-seat-caption"><b>${teamName(t)}${i+1}</b><em>${c.name}</em></span>`:`<span class="vs-seat-empty"><b>${teamName(t)}${i+1}</b><em>${target?'點此放置':'尚未選擇'}</em></span>`}</div>`}
function orderHTML(){const order=state.mode==='bp'?SEAT_ORDER.map(([t,i])=>`${teamName(t)}${i+1}`):['紅方','藍方','紅方','藍方','藍方','紅方'];return order.map((x,i)=>`<span class="vs-order-node ${x.startsWith('紅')?'red':'blue'}">${x}</span>${i<order.length-1?'<span class="vs-order-arrow">➜</span>':''}`).join('')}
function visiblePool(){return state.phase?.kind==='rd-remove'?[...state.rdHands[state.phase.controller]]:state.pool}
function confirmRdHandover(){state.phase={kind:'rd-remove',team:state.phase.team,controller:state.phase.controller,remaining:3};render();startTimer()}
function renderOnlinePrivateWait(){const p=q('versusPanel'),phase=state.phase;p.innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-battle-title">RD+BP・私人移除階段</div><div class="vs-title">等待${teamName(phase.controller)}完成移除</div><p>對方的 26 角與移除結果不會顯示。</p><button id="vsQuit" class="vs-btn danger">離開房間</button></div>`;q('vsQuit').onclick=quit}
function render(free){const p=q('versusPanel'),phase=state.phase;if(state.pendingPick!=null&&phase?.kind==='pick'&&!Array.isArray(free))free=state.seats[phase.team].map((id,index)=>id==null?index:-1).filter(index=>index>=0);if(phase?.kind==='rd-handover'){const cpu=isCpuTeam(phase.controller);p.innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-battle-title">RD+BP・私人移除階段</div><div class="vs-privacy-icon">${cpu?'🤖':'🔒'}</div><div class="vs-title">${cpu?'電腦正在處理自己的 26 角':'請將裝置交給'+teamName(phase.controller)}</div><p>${cpu?'電腦的角色名單與移除結果不會顯示。':'上一方的 26 角名單已隱藏。確認周圍沒有對方玩家後，再顯示'+teamName(phase.controller)+'的角色。'}</p>${cpu?'':`<button id="vsReveal" class="vs-btn">我是${teamName(phase.controller)}，顯示我的 26 角</button>`}<button id="vsQuit" class="vs-btn danger">結束本次連戰</button></div>`;if(q('vsReveal'))q('vsReveal').onclick=confirmRdHandover;q('vsQuit').onclick=()=>{if(confirm('確定結束本次連戰並回到首頁？'))quit()};maybeCpuAct();return}const insertTeam=phase?.kind==='pick'?other(phase.team):null,humanController=!isCpuTeam(phase.controller);void refreshLearningMarks();const playerLabel=teamName(state.playerTeam),cpuLabel=teamName(other(state.playerTeam));p.innerHTML=`<div class="vs-draft-shell ${state.mode==='re'?'re-draft-shell':''}"><div class="vs-header"><div class="vs-title">${MODES[state.mode].name}</div><div class="vs-status">第 <b>${state.match}</b> / ${state.total} 場</div></div>${state.playMode==='ai'&&state.mode!=='re'?`<div class="vs-player-side"><b>${playerLabel}</b> 為 <span class="${state.playerTeam}">${teamName(state.playerTeam)}</span>，<b>${cpuLabel}</b> 為 <span class="${other(state.playerTeam)}">${teamName(other(state.playerTeam))}</span>${isCpuTeam(phase.controller)?'<span class="vs-cpu-thinking">🤖 電腦思考中…</span>':''}</div>`:''}<div class="vs-turn ${phase?.controller||''}">${phaseText()} <span id="vsTimer" class="vs-timer"></span></div><div class="vs-toolbar">${humanController&&['ban','bp-ban','insert'].includes(phase?.kind)?'<button id="vsSkip" class="vs-btn">空過禁角</button>':''}${insertTeam&&state.insert[insertTeam]&&(!state.playerTeam||insertTeam===state.playerTeam)?`<button id="vsInsert" class="vs-btn insert">${teamName(insertTeam)}使用 Insert Ban</button>`:''}<button id="vsQuit" class="vs-btn danger">結束本次連戰</button></div><div class="vs-section-title">${phase?.kind==='rd-remove'?teamName(phase.controller)+'的 26 角（對方不可見）':'可選角色'}</div><div class="vs-pool">${visiblePool().map(cardHTML).join('')}</div><div class="vs-section-title">紅藍選角順序</div><div class="vs-order">${orderHTML()}</div><div class="vs-section-title">模擬座位配置</div><div class="vs-seat-map">${['red','blue'].map(t=>[0,1,2].map(i=>mapSeatHTML(t,i,free)).join('')).join('')}<div class="vs-map-center"><b>${phaseText()}</b><small>${MODES[state.mode].name}<br>紅1為 First Player</small></div></div><div class="vs-log">${state.log.slice(-8).map(x=>`<div>${x}</div>`).join('')}</div></div>`;
 if(state.playMode==='online')p.insertAdjacentHTML('afterbegin',`<div class="vs-player-side">房號 <b>${state.online.code}</b>・你是 <span class="${state.playerTeam}">${teamName(state.playerTeam)}</span>${phase.controller===state.playerTeam?'・輪到你操作':'・等待對方操作'}</div>`);
 if(state.mode==='re'){
   const fav=byName(state.favorite),oppAvatar=byId(state.reOpponentAvatarId),oppSide=other(state.playerTeam),turn=p.querySelector('.vs-turn'),center=p.querySelector('.vs-map-center'),header=p.querySelector('.vs-header');
   if(header)header.insertAdjacentHTML('afterend',`<div class="re-matchup"><b class="${state.playerTeam}">${esc(sideLabel(state.playerTeam))}</b><span>VS</span><b class="${oppSide}">${esc(sideLabel(oppSide))}</b>${isCpuTeam(phase.controller)?'<small class="vs-cpu-thinking">🤖 電腦思考中…</small>':''}</div>`);
   if(turn)turn.innerHTML=`<span class="re-favorite-speaker"><img src="${fav.image}" alt="${esc(fav.name)}"><small>本命</small></span><span class="re-turn-words">${esc(phaseText())}</span><span id="vsTimer" class="vs-timer"></span>`;
   if(center)center.innerHTML=`<span class="re-center-opponent ${oppSide}">${oppAvatar?`<img src="${oppAvatar.image}" alt="${esc(oppAvatar.name)}">`:''}<span><small>本場對戰隊伍</small><b>${esc(state.reOpponent?.name||'')}</b></span></span><small>${esc(phaseText())}<br>紅1為 First Player</small>`;
 }
 const seatMap=p.querySelector('.vs-seat-map');if(seatMap){const arrow=document.createElement('div');arrow.className='vs-direction-arrow';arrow.textContent='➜';arrow.setAttribute('aria-hidden','true');seatMap.appendChild(arrow);if(['re','fearless'].includes(state.mode)){seatDockCleanup?.();const anchor=document.createElement('div');anchor.className='vs-seat-anchor';seatMap.before(anchor);anchor.appendChild(seatMap);const updateDock=()=>seatMap.classList.toggle('is-docked',anchor.getBoundingClientRect().top>window.innerHeight-seatMap.offsetHeight);window.addEventListener('scroll',updateDock,{passive:true});window.addEventListener('resize',updateDock);seatDockCleanup=()=>{window.removeEventListener('scroll',updateDock);window.removeEventListener('resize',updateDock)};requestAnimationFrame(updateDock)}}
 const pendingCard=p.querySelector('.vs-card.pending-seat');if(pendingCard)pendingCard.disabled=false;p.querySelectorAll('.vs-card:not(:disabled)').forEach(b=>b.onclick=()=>choose(Number(b.dataset.id)));p.querySelectorAll('.vs-map-seat.target').forEach(e=>e.onclick=()=>placePick(Number(e.dataset.seat)));if(q('vsSkip'))q('vsSkip').onclick=skipBan;if(q('vsInsert'))q('vsInsert').onclick=useInsert;q('vsQuit').onclick=()=>{if(confirm('確定結束本次連戰並回到首頁？'))quit()};renderTimer();maybeCpuAct();}
function avatarRow(ids,large=false,mine=false,label=''){return`<div class="re-lineup-wrap ${mine?'mine':''}"><div class="${large?'vs-result-avatars':'vs-mini-avatars'}">${ids.map(id=>{const c=byId(id);return`<img src="${c.image}" alt="${esc(c.name)}" title="${esc(c.name)}">`}).join('')}</div>${label?`<div class="re-lineup-team">${esc(label)}</div>`:''}</div>`}
function trashTalk(rec){const red=rec.red.map(byId),blue=rec.blue.map(byId),lines=[];try{if(typeof chainRoleTrashTalks==='function')chainRoleTrashTalks({player:red,cpu:blue,specialAudience:[]}).slice(0,2).forEach(x=>lines.push(x))}catch(e){}const winner=rec.rs===rec.bs?'雙方打得難分難解，觀眾決定把鍋留給下一場。':rec.rs>rec.bs?'藍方選完才發現，真正被 Ban 掉的是自己的勝算。':'紅方握有 First Player，卻把勝利先手讓給了藍方。';lines.unshift(winner);return lines.slice(0,3)}
function wireNextButton(finalAction){const button=q('vsNext');if(!button)return;button.type='button';button.onclick=event=>{event.preventDefault();if(button.dataset.busy==='1')return;button.dataset.busy='1';button.disabled=true;button.textContent='載入中…';clearInterval(timerId);state.matchActive=false;if(state.history.length>=state.total)finalAction();else startMatchSafe()}}
function renderResult(rs,bs){
 const last=state.history.at(-1),winner=rs===bs?'平手':rs>bs?'紅方勝':'藍方勝';
 if(state.mode==='re'){
   const mine=last.reWinner==='player'?'勝':'負',quote=last.reQuote,c=byId(quote.id),redMine=last.playerTeam==='red',blueMine=last.playerTeam==='blue';
   q('versusPanel').innerHTML=`<div class="vs-result re-match-result"><div class="vs-battle-title">Re.星杯戰爭・本場結算</div><div class="vs-title">第 ${state.match} 場・${esc(sideLabel('red'))}　VS　${esc(sideLabel('blue'))}</div><div class="vs-lineups"><div class="vs-result-team red"><h3>${esc(sideLabel('red'))}</h3>${avatarRow(last.red,true,redMine,reTeamForSide('red'))}<div class="vs-score red">${rs}</div>${last.favoriteUsed&&redMine?`<small class="re-favorite-score">${last.bondComeback?'本命・無盡羈絆逆轉':'本命羈絆 +5'}</small>`:''}</div><div class="vs-versus">VS</div><div class="vs-result-team blue"><h3>${esc(sideLabel('blue'))}</h3>${avatarRow(last.blue,true,blueMine,reTeamForSide('blue'))}<div class="vs-score blue">${bs}</div>${last.favoriteUsed&&blueMine?`<small class="re-favorite-score">${last.bondComeback?'本命・無盡羈絆逆轉':'本命羈絆 +5'}</small>`:''}</div></div><h2 class="re-round-verdict ${last.reWinner}">我方${mine}</h2><div class="re-character-dialogue ${quote.bond?'diamond bond':''}"><img src="${c.image}" alt="${esc(c.name)}"><div class="re-dialogue-copy"><b>${esc(c.name)}</b><p>「${esc(quote.text)}」</p><small class="re-quote-by">---by.${esc(quote.by)}</small></div></div><div class="vs-section-title">連戰紀錄</div>${historyHTML()}<div class="vs-toolbar"><button id="vsNext" class="vs-btn">${state.match<state.total?'下一場':'查看最終結算'}</button><button id="vsHome" class="vs-btn">回到首頁</button></div></div>`;
   wireNextButton(renderReFinal);q('vsHome').onclick=quit;return;
 }
 q('versusPanel').innerHTML=`<div class="vs-result"><div class="vs-battle-title">${MODES[state.mode].name}・本場結算</div><div class="vs-title">第 ${state.match} 場完成</div><div class="vs-lineups"><div class="vs-result-team red"><h3>紅方</h3>${avatarRow(last.red,true)}<div class="vs-score red">${rs}</div></div><div class="vs-versus">VS</div><div class="vs-result-team blue"><h3>藍方</h3>${avatarRow(last.blue,true)}<div class="vs-score blue">${bs}</div></div></div><h2>${winner}</h2><div class="vs-trash">${last.trash.map(x=>`<div>「${x}」</div>`).join('')}</div><div class="vs-section-title">連戰紀錄</div>${historyHTML()}<div class="vs-toolbar">${state.history.length<state.total?'<button id="vsNext" class="vs-btn">下一場</button>':'<button id="vsRestart" class="vs-btn">同規則再來一次</button>'}<button id="vsHome" class="vs-btn">回到首頁</button></div></div>`;wireNextButton(startSeries);if(q('vsRestart'))q('vsRestart').onclick=startSeries;q('vsHome').onclick=quit;
}
function reRanking(pattern){
 const rows=window.RE_RANKINGS||[],exact=rows.filter(x=>x.pattern===pattern);if(exact.length)return{...exact[Math.floor(Math.random()*exact.length)],exact:true};
 const wins=[...pattern].reduce((n,x)=>n+(x==='O'?1:x==='D'?.5:0),0),scored=rows.map(x=>{const rw=[...x.pattern].filter(v=>v==='O').length,winGap=Math.abs(rw-wins),roundGap=[...x.pattern].reduce((n,v,i)=>n+(pattern[i]==='D'?.5:v===pattern[i]?0:1),0);return{x,winGap,roundGap}}).sort((a,b)=>a.winGap-b.winGap||a.roundGap-b.roundGap||a.x.rank-b.x.rank),best=scored.filter(x=>x.winGap===scored[0].winGap&&x.roundGap===scored[0].roundGap);return{...best[Math.floor(Math.random()*best.length)].x,exact:false};
}
function secondPlaceTalk(){
 const lines=['最遙遠的距離，就是獎盃已在你面前，而你捧不起。','當上帝為你關了冠軍的門，同時會幫你打開亞軍的窗。','未來是你的，但冠軍是我的。','勝敗乃兵家常事，少俠請重新來過！','你拼到了冠軍戰門票，最後的王座仍然只差一步。'];let text=lines[Math.floor(Math.random()*lines.length)];
 const rival=state.history.at(-1)?.opponent||'最後一場敵方隊伍',anyRole=byId(shuffle(state.history.flatMap(x=>x[x.playerTeam]))[0])?.name||state.favorite;
 return text.replace(/夢母獅三遷隊|夢母獅隊|母獅隊|母獅/g,rival).replace(/\(我方隊伍名\)/g,state.teamName).replace(/\(任意那一場的角色\)/g,anyRole);
}
function reRankEnding(rank){
 if(rank===1)return{tier:'gold',text:'這一次，你終於改寫了命運，站上 Re.星杯戰爭的頂點。'};
 if(rank===2)return{tier:'silver',text:secondPlaceTalk()};
 if(rank===3)return{tier:'bronze',text:'你盡力了，真的。'};
 if(rank===32)return{tier:'wood last',text:'奪冠是才能，墊底更是憑實力才能獲得的才能！'};
 return{tier:'wood',text:'即使轉生也好想再奪冠一場...真的好想啊....'};
}
function reFavoriteEndingHTML(victory){
 const fav=byName(state.favorite);if(state.reFavoriteUsed){state.reFavoriteEndingText='你與本命一起走完了這段被改寫的歷史。';return`<div class="re-congrats diamond"><img src="${fav.image}" alt="${esc(fav.name)}"><div><b>${victory?`恭喜 ${esc(state.teamName)} 贏得 Re.星杯戰爭！`:`恭喜 ${esc(state.teamName)} 獲得第 ${state.reFinal?.rank||''} 名！`}</b><p>你與本命「${esc(state.favorite)}」一起走完了這段被改寫的歷史。</p></div></div>`}
 const lines=['我是什麼很爛的角色嗎？','我本將心照明月，奈何明月照溝渠。','選角沒有對錯，只有選我與不選我。','原來我的存在，只是為了證明其他人有多熱門。','沒關係，也許我不是當下最好的選擇。所以你有贏吧？是吧？','再會啦，心愛的無緣的人。那只是無聊的故事、憨人的夢。'];state.reFavoriteEndingText=state.reFavoriteSeen>=3?lines[Math.floor(Math.random()*lines.length)]:'原來回到過去，你還是沒有選我。';return`<div class="re-neglect"><img src="${fav.image}" alt="${esc(fav.name)}"><div><b>${esc(fav.name)}</b><p>「${esc(state.reFavoriteEndingText)}」</p></div></div>`;
}
function chibiPath(name){return`assets/chibi/${encodeURIComponent(name)}.webp`}
function reChampionChibi(){if(state.reFavoriteUsed)return state.favorite;const own=state.history.at(-1)?.[state.history.at(-1)?.playerTeam]||[];return byId(own[Math.floor(Math.random()*own.length)])?.name||state.favorite}
function reUsedBard(){return state.history.some(h=>(h[h.playerTeam]||[]).some(id=>['吟游詩人','吟遊詩人'].includes(byId(id)?.name)))}
function renderReFinal(){
 clearInterval(timerId);const wins=state.history.filter(x=>x.reWinner==='player').length,losses=state.history.length-wins,pattern=state.history.map(x=>x.reWinner==='player'?'O':'X').join(''),ranking=reRanking(pattern),victory=wins===5,ending=reRankEnding(victory?1:ranking.rank);
 const spark=Array.from({length:22},(_,i)=>`<i style="--i:${i};--x:${(i*47)%100}%;--d:${(i%7)*.16}s"></i>`).join('');
 const rank=victory?1:ranking.rank,rankNote=victory?'五戰全勝，奪得 32 隊賽事冠軍。':`${ranking.exact?'與參考賽程隊伍 '+ranking.team+' 完全相同。':'依勝場數與逐輪結果，比照最接近的隊伍 '+ranking.team+'。'}`;state.reFinal={wins,losses,pattern,rank,ending,rankNote};
 const championChibi=victory?reChampionChibi():'',wheelchairBard=!victory&&rank>3&&reUsedBard();
 q('versusPanel').innerHTML=`<div class="re-final ${victory?'victory':'defeat'}">${victory?`<div class="re-confetti">${spark}</div><div class="re-cup-stage"><img class="re-chibi re-chibi-left" src="${chibiPath(championChibi)}" alt="${esc(championChibi)} Q版"><img class="re-cup" src="assets/anniversary_cup.png" alt="冠軍獎盃"></div>`:''}<div class="re-final-title">Re.星杯戰爭・${victory?'冠軍':'最終名次'}</div><div class="re-rank-stage">${wheelchairBard?`<img class="re-chibi re-chibi-left" src="${chibiPath('輪椅吟遊詩人')}" alt="輪椅吟遊詩人 Q版">`:''}<div class="re-rank-number tier-${ending.tier.split(' ')[0]}">第 ${rank} 名 <small>/ 32 隊</small></div></div><div class="re-rank-ending ${ending.tier}">「${esc(ending.text)}」</div>${reFavoriteEndingHTML(victory)}<div class="re-record">${wins} 勝・${losses} 負</div>${historyHTML()}<div class="vs-toolbar"><button id="reSaveImage" class="vs-btn re-save-btn">儲存圖片</button><button id="vsRestart" class="vs-btn">重新挑戰</button><button id="vsHome" class="vs-btn">回到首頁</button></div></div>`;
 q('reSaveImage').onclick=saveReResultImage;q('vsRestart').onclick=startSeries;q('vsHome').onclick=quit;
}
function historyHTML(){const re=state.mode==='re';return`<table class="vs-history ${re?'re-history':''}"><thead><tr><th>場次</th><th>紅方</th><th>紅分</th><th>藍方</th><th>藍分</th><th>${re?'我方結果':'結果'}</th></tr></thead><tbody>${state.history.map(h=>{const redMine=re&&h.playerTeam==='red',blueMine=re&&h.playerTeam==='blue';return`<tr><td>${h.match}</td><td>${avatarRow(h.red,false,redMine,re?redMine?state.teamName:h.opponent:'')}</td><td class="vs-score red" style="font-size:20px">${h.rs}</td><td>${avatarRow(h.blue,false,blueMine,re?blueMine?state.teamName:h.opponent:'')}</td><td class="vs-score blue" style="font-size:20px">${h.bs}</td><td class="${re?(h.reWinner==='player'?'re-win':'re-loss'):''}">${re?(h.reWinner==='player'?'勝':'負'):(h.rs===h.bs?'平手':h.rs>h.bs?'紅方勝':'藍方勝')}</td></tr>`}).join('')}</tbody></table>`}
function reLoadImage(src){if(typeof loadCanvasSafeImage==='function')return loadCanvasSafeImage(src).catch(()=>null);return new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=src})}
function reCanvasCircle(ctx,image,x,y,r,border){ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();if(image)ctx.drawImage(image,x-r,y-r,r*2,r*2);ctx.restore();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.lineWidth=5;ctx.strokeStyle=border;ctx.stroke()}
function reCanvasWrap(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){let line='',lines=[];for(const ch of String(text)){const next=line+ch;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=ch}else line=next}if(line)lines.push(line);lines.slice(0,maxLines).forEach((value,index)=>ctx.fillText(value,x,y+index*lineHeight));return y+Math.min(lines.length,maxLines)*lineHeight}
async function saveReResultImage(){
 const button=q('reSaveImage');if(button){button.disabled=true;button.textContent='圖片產生中…'}
 try{
   const W=1400,H=1320,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d'),font='"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',final=state.reFinal,fav=byName(state.favorite);
   const allIds=[...new Set(state.history.flatMap(h=>[...h.red,...h.blue]))],images=new Map(await Promise.all(allIds.map(async id=>[id,await reLoadImage(byId(id).image)]))),favImage=await reLoadImage(fav.image),gradient=ctx.createLinearGradient(0,0,0,H);gradient.addColorStop(0,'#162643');gradient.addColorStop(1,'#070d1c');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);ctx.strokeStyle='#d9b85f';ctx.lineWidth=5;ctx.strokeRect(24,24,W-48,H-48);
   ctx.textAlign='center';ctx.fillStyle='#f5cf72';ctx.font=`900 30px ${font}`;ctx.fillText('ASTERIATED GRAIL',W/2,72);ctx.fillStyle='#fff4ce';ctx.font=`1000 58px ${font}`;ctx.fillText('Re.星杯戰爭',W/2,145);ctx.fillStyle='#ffe18a';ctx.font=`1000 82px ${font}`;ctx.fillText(`第 ${final.rank} 名`,W/2,248);ctx.fillStyle='#dfe8fb';ctx.font=`800 28px ${font}`;ctx.fillText(`${state.teamName}　${final.wins}勝 ${final.losses}負`,W/2,300);
   ctx.fillStyle=final.rank===2?'#d9e2ef':final.rank===3?'#d69061':final.rank===1?'#ffe18a':'#d4b185';ctx.font=`700 25px ${font}`;reCanvasWrap(ctx,`「${final.ending.text}」`,W/2,355,1120,38,2);
   let y=450;ctx.font=`800 21px ${font}`;for(const h of state.history){ctx.fillStyle='rgba(22,35,62,.95)';ctx.fillRect(65,y-42,W-130,120);ctx.strokeStyle='#40577f';ctx.lineWidth=2;ctx.strokeRect(65,y-42,W-130,120);ctx.fillStyle='#f4d06f';ctx.textAlign='left';ctx.fillText(`第 ${h.match} 場`,88,y+7);const redMine=h.playerTeam==='red',blueMine=h.playerTeam==='blue',redName=redMine?state.teamName:h.opponent,blueName=blueMine?state.teamName:h.opponent;ctx.textAlign='center';ctx.fillStyle='#ff9aaa';ctx.fillText(`紅方・${redName}`,385,y-10);ctx.fillStyle='#91c4ff';ctx.fillText(`藍方・${blueName}`,1005,y-10);for(let i=0;i<3;i++){reCanvasCircle(ctx,images.get(h.red[i]),300+i*76,y+33,29,redMine?'#f3ce63':'#a65465');reCanvasCircle(ctx,images.get(h.blue[i]),920+i*76,y+33,29,blueMine?'#f3ce63':'#4f83bd')}ctx.fillStyle='#ff91a3';ctx.font=`900 29px ${font}`;ctx.fillText(String(h.rs),640,y+18);ctx.fillStyle='#7db7ff';ctx.fillText(String(h.bs),760,y+18);ctx.fillStyle=h.reWinner==='player'?'#ffe18a':'#ff91a3';ctx.font=`1000 32px ${font}`;ctx.fillText(h.reWinner==='player'?'勝':'負',700,y+62);ctx.font=`800 21px ${font}`;y+=136}
   ctx.fillStyle='rgba(24,37,66,.98)';ctx.fillRect(115,1145,W-230,112);ctx.strokeStyle=state.reFavoriteUsed?'#aef3ff':'#8c6f9f';ctx.lineWidth=4;ctx.strokeRect(115,1145,W-230,112);reCanvasCircle(ctx,favImage,185,1201,40,state.reFavoriteUsed?'#baf2ff':'#c6a1dc');ctx.textAlign='left';ctx.fillStyle='#ffe39a';ctx.font=`900 23px ${font}`;ctx.fillText(state.favorite,250,1185);ctx.fillStyle='#f1f5ff';ctx.font=`600 20px ${font}`;reCanvasWrap(ctx,`「${state.reFavoriteEndingText}」`,250,1218,940,28,2);ctx.textAlign='center';ctx.fillStyle='#8291b2';ctx.font=`500 16px ${font}`;ctx.fillText('Re.星杯戰爭・五連戰紀錄',W/2,1290);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('瀏覽器無法輸出 PNG');const url=URL.createObjectURL(blob),link=document.createElement('a'),safeTeam=state.teamName.replace(/[\\/:*?"<>|]/g,'_');link.href=url;link.download=`Re星杯戰爭_${safeTeam}_第${final.rank}名.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }catch(error){alert('圖片產生失敗：'+error.message)}finally{if(button){button.disabled=false;button.textContent='儲存圖片'}}
}
function quit(){clearInterval(timerId);clearInterval(onlinePollId);clearTimeout(storyTimer);state=null;q('versusPanel').classList.add('hidden');q('profilePanel').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})}
renderFavoriteGrid();
selectMode('bp');
})();

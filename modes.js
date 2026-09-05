(function(){
'use strict';
const MODES={
 bp:{name:'BP',open:18,summary:'隨機開 18 角；流程為紅1禁、藍1禁、紅1選、藍1選；紅2禁、藍2禁、紅2選、藍2選；藍3禁、紅3禁、藍3選、紅3選。角色固定進入對應座位。'},
 fearless:{name:'無懼',open:52,summary:'52 角全開；各方前幾局使用過的角色僅該方不能再選。紅、藍各先禁一角，選角順序紅藍紅藍藍紅，可各使用一次 Insert Ban。'},
 cm01:{name:'CM01',open:20,summary:'隨機開 20 角；紅方禁一角、藍方禁兩角。選角順序紅藍紅藍藍紅，可自由安排座位並各使用一次 Insert Ban。'},
 rdbp:{name:'RD+BP',open:20,summary:'52 角隨機各分 26 角；雙方各移除 3 角後，從剩餘 46 角隨機開 20 角，接著依 CM01 流程禁選。'}
};
const PICK_ORDER=['red','blue','red','blue','blue','red'];
const SEAT_ORDER=[['red',0],['blue',0],['red',1],['blue',1],['blue',2],['red',2]];
const BP_STEPS=[
 ['bp-ban','red',0],['bp-ban','blue',0],['bp-pick','red',0],['bp-pick','blue',0],
 ['bp-ban','red',1],['bp-ban','blue',1],['bp-pick','red',1],['bp-pick','blue',1],
 ['bp-ban','blue',2],['bp-ban','red',2],['bp-pick','blue',2],['bp-pick','red',2]
];
let state=null,timerId=null,onlinePollId=null,legacyStart=window.startProfileGame,learningEnabled=false,learningRequestKey='';
const q=id=>document.getElementById(id), teamName=t=>t==='red'?'紅方':'藍方', other=t=>t==='red'?'blue':'red';
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
document.querySelectorAll('.versus-mode-btn').forEach(btn=>btn.onclick=()=>selectMode(btn.dataset.mode));
q('versusSeriesLength').onchange=()=>state&&render();q('versusTimer').onchange=()=>state&&startTimer();
q('versusLearningToggle').onclick=()=>{learningEnabled=!learningEnabled;learningRequestKey='';const b=q('versusLearningToggle');b.classList.toggle('active',learningEnabled);b.setAttribute('aria-pressed',String(learningEnabled));b.textContent=learningEnabled?'◇ 學習模式：開啟':'◇ 學習模式：關閉'};
q('profileStartBtn').onclick=()=>{if(MODES[gameMode])startSeries();else legacyStart()};
function selectMode(mode){gameMode=mode;document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));document.querySelector(`[data-mode="${mode}"]`).classList.add('active');if(q('chainConfig'))q('chainConfig').classList.add('hidden');q('versusConfig').classList.remove('hidden');q('versusRuleSummary').textContent=MODES[mode].summary;q('profileError').textContent='';}
function startSeries(){
 const total=Number(q('versusSeriesLength').value)||1;
 if(q('versusBattleType').value==='online')return showOnlineLobby();
 state={mode:gameMode,total,match:0,history:[],used:{red:new Set(),blue:new Set()},phase:null,pool:[],banned:new Set(),seats:{red:[null,null,null],blue:[null,null,null]},insert:{red:true,blue:true},log:[],rdHands:null,rdRemoved:{red:new Set(),blue:new Set()},seconds:0,delegated:false,playMode:q('versusBattleType').value,learning:learningEnabled,playerTeam:null,marks:{diamond:new Set(),danger:new Set()}};
 q('profilePanel').classList.add('hidden');q('gamePanel').classList.add('hidden');q('resultPanel').classList.add('hidden');q('chainResultPanel').classList.add('hidden');q('versusPanel').classList.remove('hidden');startMatch();
}

function showOnlineLobby(message=''){
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
function startMatch(){
 state.match++;learningRequestKey='';state.banned=new Set();state.seats={red:[null,null,null],blue:[null,null,null]};state.insert={red:true,blue:true};state.log=[];state.delegated=false;state.playerTeam=state.playMode==='ai'?(Math.random()<.5?'red':'blue'):null;
 if(state.mode==='rdbp'){
   const all=shuffle(characters.map(c=>c.id));state.rdHands={red:new Set(all.slice(0,26)),blue:new Set(all.slice(26))};state.rdRemoved={red:new Set(),blue:new Set()};state.pool=all;state.phase={kind:'rd-handover',team:'red',controller:'red'};
 }else{
   state.pool=state.mode==='fearless'?characters.map(c=>c.id):shuffle(characters.map(c=>c.id)).slice(0,MODES[state.mode].open);beginBan();
 }
 log(`第 ${state.match} 場開始：${MODES[state.mode].name}`);render();if(state.phase.kind!=='rd-handover')startTimer();
}
function beginBan(){
 if(state.mode==='bp')setBpStep(0);
 else state.phase={kind:'ban',step:0,team:'red',controller:'red'};
}
function setBpStep(step){const item=BP_STEPS[step];if(!item)return finishMatch();const [kind,team,seat]=item;state.phase={kind,bpStep:step,team,controller:team,seat}}
function phaseText(){const p=state.phase;if(!p)return'';
 if(p.kind==='rd-handover')return`請將裝置交給${teamName(p.controller)}`;
 if(p.kind==='rd-remove')return`${teamName(p.controller)}從自己的 26 角移除角色（剩 ${p.remaining} 角）`;
 if(p.kind==='bp-ban')return`${p.seat===0?teamName(p.team)+(p.team==='red'?'1':'1'):teamName(p.team)+(p.seat+1)}玩家禁角`;
 if(p.kind==='bp-pick')return`${teamName(p.team)}${p.seat+1}玩家選角，將固定放入${teamName(p.team)}${p.seat+1}`+(state.delegated?`（由${teamName(p.controller)}代選）`:'');
 if(p.kind==='ban')return`${teamName(p.controller)}禁角`;
 if(p.kind==='insert')return`${teamName(p.controller)}使用 Insert Ban`;
 if(p.kind==='pick')return`${teamName(p.team)}選角`+(state.delegated?`（由${teamName(p.controller)}代選）`:'');return''}
function availableFor(id){const p=state.phase;if(!p||state.banned.has(id)||state.seats.red.includes(id)||state.seats.blue.includes(id))return false;
 if(state.playMode==='online'&&p.controller!==state.playerTeam)return false;
 if(p.kind==='rd-remove')return state.rdHands[p.controller].has(id)&&!state.rdRemoved[p.controller].has(id);
 if(p.kind==='pick'||p.kind==='bp-pick'){if(state.mode==='fearless'&&state.used[p.team].has(id))return false;}
 return state.pool.includes(id);
}
function choose(id){if(!availableFor(id))return;const p=state.phase;
 if(state.playMode==='online'){
  if(p.kind==='pick'){state.pendingPick=id;renderSeatsChoice();return}
  return void onlineAction({action:'select',characterId:id});
 }
 if(p.kind==='rd-remove'){state.rdRemoved[p.controller].add(id);log(`${teamName(p.controller)}移除 ${byId(id).name}`);p.remaining--;if(!p.remaining){if(p.controller==='red'){clearInterval(timerId);state.log=[];state.phase={kind:'rd-handover',team:'blue',controller:'blue'};render();return}else{const left=characters.map(c=>c.id).filter(x=>!state.rdRemoved.red.has(x)&&!state.rdRemoved.blue.has(x));state.pool=shuffle(left).slice(0,20);state.log=[];beginBan();}}render();startTimer();return;}
 if(['ban','bp-ban','insert'].includes(p.kind)){state.banned.add(id);log(`${teamName(p.controller)}禁用 ${byId(id).name}${p.kind==='insert'?'（Insert Ban）':''}`);advanceAfterBan();return;}
 if(p.kind==='bp-pick'){state.seats[p.team][p.seat]=id;log(`${teamName(p.controller)}為${teamName(p.team)}${p.seat+1}選擇 ${byId(id).name}`);state.delegated=false;advanceBpStep();return;}
 if(p.kind==='pick'){state.pendingPick=id;renderSeatsChoice();}
}
function advanceAfterBan(){const p=state.phase;
 if(p.kind==='bp-ban'){advanceBpStep();return;}
 else if(p.kind==='insert'){state.insert[p.controller]=false;state.phase=p.resume;}
 else if(p.step===0)state.phase={kind:'ban',step:1,team:'blue',controller:'blue'};
 else if(p.step===1&&state.mode!=='fearless')state.phase={kind:'ban',step:2,team:'blue',controller:'blue'};
 else beginPicks();render();startTimer();
}
function skipBan(){if(!state.phase||!['ban','bp-ban','insert'].includes(state.phase.kind))return;if(state.playMode==='online')return void onlineAction({action:'skip'});log(`${teamName(state.phase.controller)}空過禁角`);advanceAfterBan();}
function advanceBpStep(){const next=state.phase.bpStep+1;if(next>=BP_STEPS.length)return finishMatch();setBpStep(next);render();startTimer();}
function beginPicks(){state.phase={kind:'pick',index:0,team:PICK_ORDER[0],controller:PICK_ORDER[0]};render();startTimer();}
function renderSeatsChoice(){const p=state.phase,id=state.pendingPick;const free=state.seats[p.team].map((x,i)=>x==null?i:-1).filter(i=>i>=0);if(free.length===1)return placePick(free[0]);render(free);}
function placePick(seat){const p=state.phase,id=state.pendingPick;if(id==null||state.seats[p.team][seat]!=null)return;if(state.playMode==='online'){state.pendingPick=null;return void onlineAction({action:'select',characterId:id,seatIndex:seat})}state.seats[p.team][seat]=id;log(`${teamName(p.controller)}為${teamName(p.team)}${seat+1}選擇 ${byId(id).name}`);state.pendingPick=null;state.delegated=false;const next=p.index+1;if(next>=PICK_ORDER.length)return finishMatch();state.phase={kind:'pick',index:next,team:PICK_ORDER[next],controller:PICK_ORDER[next]};render();startTimer();}
function useInsert(){const p=state.phase;if(!p||p.kind!=='pick')return;const blocker=other(p.team);if(!state.insert[blocker])return;if(state.playMode==='online')return void onlineAction({action:'insert'});state.phase={kind:'insert',team:blocker,controller:blocker,resume:{...p}};render();startTimer();}
function onTimeout(){const p=state.phase;if(!p)return;if(['ban','bp-ban','insert'].includes(p.kind)){skipBan();return;}if(p.kind==='rd-remove'){const id=state.pool.find(availableFor);if(id)choose(id);return;}if(['pick','bp-pick'].includes(p.kind)){state.delegated=true;p.controller=other(p.team);log(`${teamName(p.team)}選角超時，改由${teamName(p.controller)}代選`);render();startTimer();}}
function startTimer(){clearInterval(timerId);const limit=Number(q('versusTimer').value)||0;state.seconds=limit;if(!limit){renderTimer();return}renderTimer();timerId=setInterval(()=>{state.seconds--;renderTimer();if(state.seconds<=0){clearInterval(timerId);onTimeout()}},1000)}
function renderTimer(){const e=q('vsTimer');if(!e)return;e.textContent=state.seconds?`${state.seconds}s`:'∞';e.classList.toggle('urgent',state.seconds>0&&state.seconds<=5)}
async function finishMatch(){clearInterval(timerId);state.phase=null;for(const t of ['red','blue'])state.seats[t].forEach(id=>state.used[t].add(id));q('versusPanel').innerHTML='<div class="vs-draft-shell vs-privacy"><div class="vs-title">伺服器正在結算…</div></div>';try{const out=await api('/api/mode/resolve',{mode:state.mode,seriesLength:state.total,matchNumber:state.match,red:[...state.seats.red],blue:[...state.seats.blue],pool:[...state.pool],redHand:state.rdHands?[...state.rdHands.red]:null,blueHand:state.rdHands?[...state.rdHands.blue]:null});const rec={match:state.match,red:[...state.seats.red],blue:[...state.seats.blue],rs:out.redScore,bs:out.blueScore,trash:[out.trash]};state.history.push(rec);renderResult(rec.rs,rec.bs)}catch(e){q('versusPanel').innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-title">結算失敗</div><p>${e.message}</p><button id="vsRetry" class="vs-btn">重試</button><button id="vsQuit" class="vs-btn danger">回到首頁</button></div>`;q('vsRetry').onclick=finishMatch;q('vsQuit').onclick=quit}}
function log(s){state.log.push(s)}
function isCpuTeam(team){return (state.playMode==='ai'||state.playMode==='online')&&team!==state.playerTeam}
function candidateIds(team){return state.pool.filter(id=>!state.banned.has(id)&&!state.seats.red.includes(id)&&!state.seats.blue.includes(id)&&!(state.mode==='fearless'&&state.used[team].has(id)))}
async function rankedCandidates(team,count=3){const available=candidateIds(team);if(!available.length)return[];const out=await api('/api/recommend',{team,currentIds:state.seats[team].filter(Boolean),availableIds:available,count});return out.ids||[]}
async function refreshLearningMarks(){if(!state?.learning||!state.phase||['rd-remove','rd-handover'].includes(state.phase.kind)){state.marks={diamond:new Set(),danger:new Set()};return}const focus=state.playerTeam||(state.phase.team||state.phase.controller),enemy=other(focus),mine=state.seats[focus].filter(Boolean).length,enemyCount=state.seats[enemy].filter(Boolean).length,key=JSON.stringify([state.match,state.phase,focus,[...state.banned],state.seats]);if(key===learningRequestKey)return;learningRequestKey=key;try{const diamond=mine<3?await rankedCandidates(focus,mine===0?3:mine===1?2:1):[],danger=enemyCount>0&&enemyCount<3?await rankedCandidates(enemy,1):[];if(key!==learningRequestKey)return;state.marks={diamond:new Set(diamond),danger:new Set(danger)};render()}catch(e){console.warn('Learning mode:',e.message)}}
function bestSeatFor(team){return state.seats[team].findIndex(x=>x==null)}
async function cpuPrivateRemoval(){const team=state.phase.controller,hand=[...state.rdHands[team]],out=await api('/api/decision',{action:'remove',team,availableIds:hand,currentIds:[]});(out.ids||[]).forEach(id=>state.rdRemoved[team].add(id));state.log=[];if(team==='red'){state.phase={kind:'rd-handover',team:'blue',controller:'blue'};render()}else{const left=characters.map(c=>c.id).filter(id=>!state.rdRemoved.red.has(id)&&!state.rdRemoved.blue.has(id));state.pool=shuffle(left).slice(0,20);beginBan();render();startTimer()}}
function maybeCpuAct(){if(state.playMode!=='ai'||!state.phase)return;const snapshot=state.phase;if(snapshot.kind==='rd-handover'&&isCpuTeam(snapshot.controller)){setTimeout(()=>{if(state.phase===snapshot)cpuPrivateRemoval().catch(e=>log(e.message))},420);return}if(snapshot.kind==='pick'&&snapshot.team===state.playerTeam&&isCpuTeam(other(snapshot.team))&&state.insert[other(snapshot.team)]){setTimeout(()=>{if(state.phase===snapshot)useInsert()},520);return}if(!isCpuTeam(snapshot.controller))return;setTimeout(async()=>{if(state.phase!==snapshot)return;try{if(snapshot.kind==='rd-remove'){await cpuPrivateRemoval();return}const decisionTeam=['ban','bp-ban','insert'].includes(snapshot.kind)?other(snapshot.controller):snapshot.team,available=candidateIds(decisionTeam),out=await api('/api/decision',{action:snapshot.kind,team:decisionTeam,currentIds:state.seats[decisionTeam].filter(Boolean),availableIds:available}),id=out.id;if(id==null){skipBan();return}if(['ban','bp-ban','insert','bp-pick'].includes(snapshot.kind)){choose(id);return}if(snapshot.kind==='pick'){state.pendingPick=id;placePick(bestSeatFor(snapshot.team))}}catch(e){log(`電腦操作失敗：${e.message}`);render()}},snapshot.kind==='pick'?1500:650)}
function cardHTML(id){const c=byId(id),cpuLocked=state.playMode==='ai'&&state.phase&&isCpuTeam(state.phase.controller),disabled=!availableFor(id)||cpuLocked,classes=['vs-card'],pickedNow=state.seats.red.includes(id)||state.seats.blue.includes(id);if(state.banned.has(id))classes.push('banned');if(pickedNow)classes.push('picked');if(state.marks.diamond.has(id))classes.push('learn-diamond');if(state.marks.danger.has(id))classes.push('learn-danger');let usedBadges='';if(state.mode==='fearless'){const redUsed=state.used.red.has(id),blueUsed=state.used.blue.has(id);if(redUsed)classes.push('used-red');if(blueUsed)classes.push('used-blue');if(redUsed&&blueUsed)classes.push('used-both');usedBadges=`<span class="vs-used-badges">${redUsed?'<i class="red">紅方已用</i>':''}${blueUsed?'<i class="blue">藍方已用</i>':''}</span>`}if(state.mode==='rdbp'&&state.phase?.kind==='rd-remove'){classes.push('assigned-'+state.phase.controller);if(state.rdRemoved[state.phase.controller].has(id))classes.push('rd-removed')}return`<button class="${classes.join(' ')}" data-id="${id}" ${disabled?'disabled':''}><span class="vs-avatar-ring"><img src="${c.image}" alt=""></span>${usedBadges}<b>${c.name}</b></button>`}
function mapSeatHTML(t,i,free){const id=state.seats[t][i],c=id&&byId(id),target=free?.includes(i)&&state.phase?.team===t;return`<div class="vs-map-seat ${t} ${t[0]}${i+1} ${target?'target':''}" data-seat="${i}" data-team="${t}">${t==='red'&&i===0?'<div class="vs-first">FIRST PLAYER</div>':''}${c?`<img src="${c.image}" alt=""><span class="vs-seat-caption"><b>${teamName(t)}${i+1}</b><em>${c.name}</em></span>`:`<span class="vs-seat-empty"><b>${teamName(t)}${i+1}</b><em>${target?'點此放置':'尚未選擇'}</em></span>`}</div>`}
function orderHTML(){const order=state.mode==='bp'?SEAT_ORDER.map(([t,i])=>`${teamName(t)}${i+1}`):['紅方','藍方','紅方','藍方','藍方','紅方'];return order.map((x,i)=>`<span class="vs-order-node ${x.startsWith('紅')?'red':'blue'}">${x}</span>${i<order.length-1?'<span class="vs-order-arrow">➜</span>':''}`).join('')}
function visiblePool(){return state.phase?.kind==='rd-remove'?[...(state.rdHands?.[state.phase.controller]||[])]:state.pool}
function confirmRdHandover(){state.phase={kind:'rd-remove',team:state.phase.team,controller:state.phase.controller,remaining:3};render();startTimer()}
function renderOnlinePrivateWait(){const p=q('versusPanel'),phase=state.phase;p.innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-battle-title">RD+BP・私人移除階段</div><div class="vs-title">等待${teamName(phase.controller)}完成移除</div><p>對方的 26 角與移除結果不會顯示。</p><button id="vsQuit" class="vs-btn danger">離開房間</button></div>`;q('vsQuit').onclick=quit}
 function render(free){const p=q('versusPanel'),phase=state.phase;if(phase?.kind==='rd-handover'){const cpu=isCpuTeam(phase.controller);p.innerHTML=`<div class="vs-draft-shell vs-privacy"><div class="vs-battle-title">RD+BP・私人移除階段</div><div class="vs-privacy-icon">${cpu?'🤖':'🔒'}</div><div class="vs-title">${cpu?'電腦正在處理自己的 26 角':'請將裝置交給'+teamName(phase.controller)}</div><p>${cpu?'電腦的角色名單與移除結果不會顯示。':'上一方的 26 角名單已隱藏。確認周圍沒有對方玩家後，再顯示'+teamName(phase.controller)+'的角色。'}</p>${cpu?'':`<button id="vsReveal" class="vs-btn">我是${teamName(phase.controller)}，顯示我的 26 角</button>`}<button id="vsQuit" class="vs-btn danger">結束本次連戰</button></div>`;if(q('vsReveal'))q('vsReveal').onclick=confirmRdHandover;q('vsQuit').onclick=()=>{if(confirm('確定結束本次連戰並回到首頁？'))quit()};maybeCpuAct();return}const insertTeam=phase?.kind==='pick'?other(phase.team):null,humanController=!isCpuTeam(phase.controller);void refreshLearningMarks();p.innerHTML=`<div class="vs-draft-shell"><div class="vs-header"><div class="vs-title">${MODES[state.mode].name}</div><div class="vs-status">第 <b>${state.match}</b> / ${state.total} 場</div></div>${state.playMode==='ai'?`<div class="vs-player-side">本場玩家為 <span class="${state.playerTeam}">${teamName(state.playerTeam)}</span>，電腦為 <span class="${other(state.playerTeam)}">${teamName(other(state.playerTeam))}</span>${isCpuTeam(phase.controller)?'<span class="vs-cpu-thinking">🤖 電腦思考中…</span>':''}</div>`:''}<div class="vs-turn ${phase?.controller||''}">${phaseText()} <span id="vsTimer" class="vs-timer"></span></div><div class="vs-toolbar">${humanController&&['ban','bp-ban','insert'].includes(phase?.kind)?'<button id="vsSkip" class="vs-btn">空過禁角</button>':''}${insertTeam&&state.insert[insertTeam]&&(!state.playerTeam||insertTeam===state.playerTeam)?`<button id="vsInsert" class="vs-btn insert">${teamName(insertTeam)}使用 Insert Ban</button>`:''}<button id="vsQuit" class="vs-btn danger">結束本次連戰</button></div><div class="vs-section-title">${phase?.kind==='rd-remove'?teamName(phase.controller)+'的 26 角（對方不可見）':'可選角色'}</div><div class="vs-pool">${visiblePool().map(cardHTML).join('')}</div><div class="vs-section-title">紅藍選角順序</div><div class="vs-order">${orderHTML()}</div><div class="vs-section-title">模擬座位配置</div><div class="vs-seat-map">${['red','blue'].map(t=>[0,1,2].map(i=>mapSeatHTML(t,i,free)).join('')).join('')}<div class="vs-map-center"><b>${phaseText()}</b><small>${MODES[state.mode].name}<br>紅1為 First Player</small></div></div><div class="vs-log">${state.log.slice(-8).map(x=>`<div>${x}</div>`).join('')}</div></div>`;
 if(state.playMode==='online')p.insertAdjacentHTML('afterbegin',`<div class="vs-player-side">房號 <b>${state.online.code}</b>・你是 <span class="${state.playerTeam}">${teamName(state.playerTeam)}</span>${phase.controller===state.playerTeam?'・輪到你操作':'・等待對方操作'}</div>`);
 p.querySelectorAll('.vs-card:not(:disabled)').forEach(b=>b.onclick=()=>choose(Number(b.dataset.id)));p.querySelectorAll('.vs-map-seat.target').forEach(e=>e.onclick=()=>placePick(Number(e.dataset.seat)));if(q('vsSkip'))q('vsSkip').onclick=skipBan;if(q('vsInsert'))q('vsInsert').onclick=useInsert;q('vsQuit').onclick=()=>{if(confirm('確定結束本次連戰並回到首頁？'))quit()};renderTimer();maybeCpuAct();}
function avatarRow(ids,large=false){return`<div class="${large?'vs-result-avatars':'vs-mini-avatars'}">${ids.map(id=>{const c=byId(id);return`<img src="${c.image}" alt="${c.name}" title="${c.name}">`}).join('')}</div>`}
function trashTalk(rec){const red=rec.red.map(byId),blue=rec.blue.map(byId),lines=[];try{if(typeof chainRoleTrashTalks==='function')chainRoleTrashTalks({player:red,cpu:blue,specialAudience:[]}).slice(0,2).forEach(x=>lines.push(x))}catch(e){}const winner=rec.rs===rec.bs?'雙方打得難分難解，觀眾決定把鍋留給下一場。':rec.rs>rec.bs?'藍方選完才發現，真正被 Ban 掉的是自己的勝算。':'紅方握有 First Player，卻把勝利先手讓給了藍方。';lines.unshift(winner);return lines.slice(0,3)}
function renderResult(rs,bs){const last=state.history.at(-1),winner=rs===bs?'平手':rs>bs?'紅方勝':'藍方勝';q('versusPanel').innerHTML=`<div class="vs-result"><div class="vs-battle-title">${MODES[state.mode].name}・本場結算</div><div class="vs-title">第 ${state.match} 場完成</div><div class="vs-lineups"><div class="vs-result-team red"><h3>紅方</h3>${avatarRow(last.red,true)}<div class="vs-score red">${rs}</div></div><div class="vs-versus">VS</div><div class="vs-result-team blue"><h3>藍方</h3>${avatarRow(last.blue,true)}<div class="vs-score blue">${bs}</div></div></div><h2>${winner}</h2><div class="vs-trash">${last.trash.map(x=>`<div>「${x}」</div>`).join('')}</div><div class="vs-section-title">連戰紀錄</div>${historyHTML()}<div class="vs-toolbar">${state.match<state.total?'<button id="vsNext" class="vs-btn">下一場</button>':'<button id="vsRestart" class="vs-btn">同規則再來一次</button>'}<button id="vsHome" class="vs-btn">回到首頁</button></div></div>`;if(q('vsNext'))q('vsNext').onclick=startMatch;if(q('vsRestart'))q('vsRestart').onclick=startSeries;q('vsHome').onclick=quit;}
function historyHTML(){return`<table class="vs-history"><thead><tr><th>場次</th><th>紅方</th><th>紅分</th><th>藍方</th><th>藍分</th><th>結果</th></tr></thead><tbody>${state.history.map(h=>`<tr><td>${h.match}</td><td>${avatarRow(h.red)}</td><td class="vs-score red" style="font-size:20px">${h.rs}</td><td>${avatarRow(h.blue)}</td><td class="vs-score blue" style="font-size:20px">${h.bs}</td><td>${h.rs===h.bs?'平手':h.rs>h.bs?'紅方勝':'藍方勝'}</td></tr>`).join('')}</tbody></table>`}
function quit(){clearInterval(timerId);clearInterval(onlinePollId);state=null;q('versusPanel').classList.add('hidden');q('profilePanel').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})}
selectMode('bp');
})();

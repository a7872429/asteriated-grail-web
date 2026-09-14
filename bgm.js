(()=>{
'use strict';
const KEY='asteriated-bgm-enabled';
let ctx=null,master=null,musicBus=null,timer=null,nextTime=0,step=0,started=false;
let enabled=localStorage.getItem(KEY)!=='0';
const tempo=96,beat=60/tempo,eighth=beat/2;
const progression=[[50,53,57],[46,50,53],[41,45,48],[48,52,55],[43,46,50],[50,53,57],[45,49,52],[45,49,52]];
const melody=[62,null,65,69,67,65,64,null,62,60,58,60,62,null,57,null,65,null,69,70,69,67,65,null,64,65,67,64,62,null,60,null,62,65,69,null,70,69,67,65,64,null,62,60,58,60,62,null,67,65,64,null,62,60,57,60,61,64,69,67,65,64,61,null];
const arp=[0,1,2,1,0,2,1,2],midi=n=>440*Math.pow(2,(n-69)/12);
function audio(){
 if(ctx)return ctx;ctx=new (window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=0;
 const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-18;compressor.knee.value=18;compressor.ratio.value=5;compressor.attack.value=.01;compressor.release.value=.35;
 musicBus=ctx.createGain();musicBus.gain.value=.82;
 const delay=ctx.createDelay(.8),feedback=ctx.createGain(),wet=ctx.createGain();delay.delayTime.value=.28;feedback.gain.value=.22;wet.gain.value=.2;
 musicBus.connect(master);musicBus.connect(delay);delay.connect(feedback);feedback.connect(delay);delay.connect(wet);wet.connect(master);master.connect(compressor);compressor.connect(ctx.destination);return ctx;
}
function envelope(g,t,d,peak,attack=.02,release=.18){g.gain.cancelScheduledValues(t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+d+release)}
function voice(note,t,d,kind='triangle',vol=.025,detune=0,cutoff=1800){
 if(note==null||!musicBus)return;const o=ctx.createOscillator(),f=ctx.createBiquadFilter(),g=ctx.createGain();o.type=kind;o.frequency.value=midi(note);o.detune.value=detune;f.type='lowpass';f.frequency.setValueAtTime(cutoff,t);f.Q.value=.7;envelope(g,t,d,vol);o.connect(f);f.connect(g);g.connect(musicBus);o.start(t);o.stop(t+d+.35);
}
function chord(notes,t,d){notes.forEach((n,i)=>{voice(n-12,t,d,'sine',.018,i*2-2,900);voice(n,t+.015,d*.92,'triangle',.008,i-1,1250)})}
function drum(t,strong){const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(strong?105:82,t);o.frequency.exponentialRampToValueAtTime(42,t+.12);g.gain.setValueAtTime(strong?.05:.025,t);g.gain.exponentialRampToValueAtTime(.0001,t+.18);o.connect(g);g.connect(musicBus);o.start(t);o.stop(t+.2)}
function shimmer(t){[74,81,86].forEach((n,i)=>voice(n,t+i*.035,.12,'sine',.006,0,2600))}
function schedule(s,t){const bar=Math.floor(s/8)%8,pos=s%8,ch=progression[bar];if(pos===0){chord(ch,t,eighth*7.6);drum(t,true)}if(pos===4)drum(t,false);const bass=ch[0]-12+(pos===6?7:0);if(pos%2===0)voice(bass,t,eighth*1.65,'sine',.025,0,650);voice(ch[arp[pos]]+12,t,eighth*.72,'triangle',.012,pos%2?3:-3,1700);const lead=melody[s%melody.length];if(lead!=null)voice(lead,t,eighth*.82,pos%4===0?'sine':'triangle',.021,0,2300);if((bar===3||bar===7)&&pos===6)shimmer(t)}
function scheduler(){if(!ctx||!enabled||ctx.state==='closed')return;while(nextTime<ctx.currentTime+.45){schedule(step,nextTime);nextTime+=eighth;step=(step+1)%64}}
async function start(){if(!enabled)return;const c=audio();if(c.state==='suspended')await c.resume();if(started){master.gain.cancelScheduledValues(c.currentTime);master.gain.linearRampToValueAtTime(.14,c.currentTime+.5);return}started=true;step=0;nextTime=c.currentTime+.06;master.gain.setValueAtTime(.0001,c.currentTime);master.gain.linearRampToValueAtTime(.14,c.currentTime+1.3);scheduler();timer=setInterval(scheduler,100)}
function stop(){if(!ctx||!master)return;master.gain.cancelScheduledValues(ctx.currentTime);master.gain.setTargetAtTime(.0001,ctx.currentTime,.12)}
function label(){const b=document.getElementById('bgmToggle');if(!b)return;b.textContent=enabled?'♫ 音樂：開':'♫ 音樂：關';b.setAttribute('aria-pressed',String(enabled));b.classList.toggle('is-off',!enabled)}
function toggle(e){e.preventDefault();e.stopPropagation();enabled=!enabled;localStorage.setItem(KEY,enabled?'1':'0');label();if(enabled)start().catch(console.warn);else stop()}
function install(){
 if(document.getElementById('bgmToggle'))return;const style=document.createElement('style');style.textContent='#bgmToggle{position:fixed;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));z-index:10000;border:1px solid #e7bd63;border-radius:999px;background:rgba(9,16,34,.9);color:#ffe3a6;padding:8px 12px;font-size:13px;font-weight:800;box-shadow:0 4px 18px rgba(0,0,0,.3);backdrop-filter:blur(8px);cursor:pointer}#bgmToggle.is-off{border-color:#52638e;color:#9da9ca}@media(max-width:600px){#bgmToggle{top:auto;bottom:max(12px,env(safe-area-inset-bottom));font-size:12px;padding:7px 10px}}';document.head.appendChild(style);
 const b=document.createElement('button');b.id='bgmToggle';b.type='button';b.title='背景音樂開關';b.addEventListener('click',toggle);document.body.appendChild(b);label();
 document.addEventListener('click',e=>{if(e.target.closest?.('#profileStartBtn'))start().catch(console.warn)},true);
 document.addEventListener('visibilitychange',()=>{if(!ctx)return;if(document.hidden)ctx.suspend();else if(enabled&&started)ctx.resume()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();window.AsteriatedBGM={start,toggle};
})();
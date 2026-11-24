/* CONCT&T IFAC • Experiência pública (mantém as rotas e o protocolo RDS V2) */
const $ = id => document.getElementById(id);
const state = { status:null, flashUntil:0, sending:false };
const time = seconds => {
  const s = Math.max(0, Math.floor(Number(seconds)||0));
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
};
function notify(message,error=false){
  const el=$('toast'); el.textContent=message;el.classList.toggle('error',error);
  state.flashUntil=Date.now()+6500;
}
let sbClient=null;
let authReady=false;
async function initializeCloud(){
  const c=window.IFAC_RDS_CONFIG||{};
  if (!c.supabaseUrl?.startsWith('https://') || c.supabaseUrl.includes('SEU-PROJETO') ||
      !c.supabasePublishableKey || c.supabasePublishableKey.includes('COLE_A_CHAVE')) {
    throw Error('Configure web_vercel/config.public.js com a URL e a chave pública do Supabase.');
  }
  if (!window.supabase?.createClient)throw Error('Não foi possível carregar a biblioteca do Supabase.');
  sbClient=window.supabase.createClient(c.supabaseUrl,c.supabasePublishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const result=await sbClient.auth.getSession();
  if(result.error)throw result.error;
  if(!result.data.session){
    const {error}=await sbClient.auth.signInAnonymously();
    if(error)throw Error('Não foi possível criar o acesso anônimo: '+error.message);
  }
  authReady=true;
}
const CALLS={
  '/api/state':['rds_state',()=>({})],
  '/api/request':['rds_request',x=>({p_name:x.name||'Visitante'})],
  '/api/cancel':['rds_cancel',()=>({})],
  '/api/command':['rds_command',x=>({p_kind:x.kind,
      p_green:x.kind==='auto'?x.green:null,
      p_yellow:x.kind==='auto'?x.yellow:null,
      p_red:x.kind==='auto'?x.red:null})]
};
async function api(path,body={}){
  if(!authReady)throw Error('Conexão com Supabase ainda não iniciada.');
  const call=CALLS[path];if(!call)throw Error('Operação não disponível no site público.');
  const {data,error}=await sbClient.rpc(call[0],call[1](body));
  if(error)throw Error(error.message||'Falha na nuvem');
  return data||{};
}
function showLights(payload,lights){
  document.querySelectorAll('.lamp').forEach(x=>x.classList.remove('lit'));
  let title='Aguardando recepção RDS',id=null;
  if(payload==='000011'){id='light-red';title='Vermelho acionado'}
  else if(payload==='001100'){id='light-yellow';title='Amarelo acionado'}
  else if(payload==='110000'){id='light-green';title='Verde acionado'}
  else if(payload==='000000')title='Luzes desligadas';
  else if(payload==='111111')title='Todas as luzes acesas';
  else if(payload==='020202')title='Alerta rápido recebido';
  else if(payload==='030303')title='Alerta lento recebido';
  else if(payload==='000300')title='Alerta amarelo recebido';
  else if(payload?.startsWith('t'))title='Ciclo automático em operação';
  else if(payload)title='Outro modo RDS recebido';
  if(lights){
    for (const color of ['red','yellow','green'])if(lights[color])$(`light-${color}`).classList.add('lit');
  }else if(id){$(id).classList.add('lit')}
  $('signal-status').textContent=title;
  $('signal-code').textContent='RDS PAYLOAD · '+(payload||'—');
}
function update(j){
  state.status=j.status;
  const waiting=j.status==='waiting',active=j.status==='active';
  const resolved=['expired','rejected','finished','disconnected','cancelled','revoked'].includes(j.status);
  $('idle-area').hidden=waiting||active||resolved;
  $('wait-area').hidden=!waiting;
  $('active-area').hidden=!active;
  $('result-area').hidden=!resolved;
  const titles={idle:'Solicite seu acesso',waiting:'Você está na fila',active:'Controle liberado!',expired:'Tempo de espera expirado',rejected:'Solicitação recusada',finished:'Sua experiência terminou',cancelled:'Solicitação cancelada',disconnected:'Sessão encerrada por desconexão',revoked:'Sessão encerrada pelo expositor'};
  $('status-title').textContent=titles[j.status]||'Experiência FM-RDS';
  const badge=$('state-badge');
  badge.textContent=active?'● LIBERADO':waiting?'◷ AGUARDANDO':resolved?'CONCLUÍDO':'● DISPONÍVEL';
  badge.classList.toggle('state-active',active);
  badge.classList.toggle('state-wait',waiting);
  badge.classList.toggle('state-end',resolved);
  if(waiting){
    $('position').textContent=j.position??'—';
    $('waiting-left').textContent=time(j.waiting_left);
    $('wait-message').textContent=`Há ${Math.max(0,(j.position||1)-1)} pessoa(s) à sua frente. Aguarde a aprovação do expositor.`;
    $('waiting-progress').style.width=`${Math.max(0,Math.min(100,(Number(j.waiting_left)||0)/300*100))}%`;
  }
  if(active)$('control-left').textContent=time(j.control_left);
  if(resolved){
    const messages={expired:'Seu pedido saiu automaticamente da fila após cinco minutos.',rejected:'O expositor recusou este pedido. Você pode tentar novamente.',finished:'Obrigado por participar da demonstração!',cancelled:'Sua solicitação foi cancelada.',disconnected:'A sessão foi encerrada após perda de conexão.',revoked:'O expositor encerrou a sessão. Obrigado por participar!'};
    $('result-text').textContent=messages[j.status]||'';
  }
  const sim=false;
  const stationOnline=!!(j.bridge_online&&j.tx_online&&j.rx_online);
  $('mode-badge').textContent=stationOnline?'RÁDIO / HARDWARE':'ESTAÇÃO OFFLINE';
  $('join').disabled=!stationOnline;
  $('join').title=stationOnline?'Solicitar autorização':'Aguarde notebook, ESP32 e ESP8266 conectarem';
  for(const [prefix,online] of [['tx',j.tx_online],['rx',j.rx_online]]){
    const el=$(`${prefix}-health`);
    el.textContent=online?'● WI-FI ONLINE':'○ OFFLINE';
    el.classList.toggle('offline',!online);
  }
  showLights(j.last_payload,j.rx_lights);
  const pending=j.command||{},labels={pending:'Aguardando o ESP32',ack:'No Si4713 · aguardando recepção',received:'RDS recebido pelo ESP8266',failed:'Comando não retirado pelo ESP32'};
  $('delivery-state').textContent=(sim?'SIMULAÇÃO · ':'')+(labels[pending.state]||'Sem envio recente');
  if(Date.now()>state.flashUntil)$('toast').textContent='';
}
async function refresh(){
  try{update(await api('/api/state'))}
  catch(e){notify('Servidor indisponível: '+e.message,true)}
}
async function act(path,body={}){
  try{await api(path,body);await refresh()}
  catch(e){notify(e.message,true)}
}
async function sendCommand(body){
  if(state.sending)return;
  state.sending=true;
  document.querySelectorAll('.command,#auto').forEach(el=>el.disabled=true);
  try{
    const res=await api('/api/command',body);
    notify('Comando '+res.payload+' registrado no Supabase. Aguardando notebook e rádio.');
    await refresh();
  }catch(e){notify(e.message,true)}
  finally{state.sending=false;document.querySelectorAll('.command,#auto').forEach(el=>el.disabled=false)}
}
$('join').onclick=()=>act('/api/request',{name:$('name').value||'Visitante'});
$('name').addEventListener('keydown',e=>{if(e.key==='Enter')$('join').click()});
$('cancel').onclick=()=>act('/api/cancel');
$('finish').onclick=()=>act('/api/cancel');
$('again').onclick=()=>act('/api/request',{name:$('name').value||'Visitante'});
document.querySelectorAll('.command').forEach(btn=>btn.onclick=()=>sendCommand({kind:btn.dataset.kind}));
$('auto').onclick=()=>{
  const body={kind:'auto'};
  for(const k of ['green','yellow','red']){
    const el=$(`${k}-sec`);const n=Number(el.value);
    if(!Number.isInteger(n)||n<2||n>30){notify('Informe tempos inteiros entre 2 e 30 segundos.',true);el.focus();return}
    body[k]=n;
  }
  sendCommand(body);
};
initializeCloud().then(()=>{
  refresh();setInterval(refresh,2000);
}).catch(e=>{
  notify('Erro de inicialização: '+e.message,true);
  $('status-title').textContent='Estação temporariamente indisponível';
  $('join').disabled=true;
  $('mode-badge').textContent='DESCONECTADO';
});

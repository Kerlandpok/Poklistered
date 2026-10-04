/* Automatic account storage, local offline copy, immutable server history. */
(() => {
const META=window.KER_AUTO_CONFIG?.metaKey||'ker-auto-meta-v1', RECOVERY=window.KER_AUTO_CONFIG?.recoveryKey||'ker-auto-local-before-restore-v1';
let adapter,meta={},busy=false,started=false,paused=false,account=null,ready=false,lastPoll=0,files=new Map(),uploaded=new Set(),lastStatus='Vérification de la sauvegarde…';
const originalSet=Storage.prototype.setItem;
const transport=async(path,options={})=>{let timer;try{return await Promise.race([window.KerCloudTransport?window.KerCloudTransport(path,options):fetch(path,options),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connexion indisponible')),20000)})]);}finally{clearTimeout(timer)}};
const setMeta=()=>originalSet.call(localStorage,META,JSON.stringify(meta));
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
async function encode(value){
 if(value instanceof Blob){let bytes=await value.arrayBuffer(),hash=await sha(bytes);files.set(hash,new Blob([bytes]));return {$kerFile:hash,type:value.type,encoding:'blob'};}
 if(typeof value==='string'&&/^data:[^,]*;base64,/.test(value)){let [head,...parts]=value.split(','),raw=atob(parts.join(',')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),hash=await sha(bytes);files.set(hash,new Blob([bytes]));return {$kerFile:hash,type:head.slice(5).split(';')[0],encoding:'dataurl'};}
 if(Array.isArray(value)){let out=[];for(let x of value)out.push(await encode(x));return out;}
 if(value&&typeof value==='object'){let out={};for(let k of Object.keys(value).sort())out[k]=await encode(value[k]);return out;}
 return value;
}
async function decode(value){
 if(value&&typeof value==='object'&&typeof value.$kerFile==='string'){
  let blob=files.get(value.$kerFile);if(!blob){let r=await api('/api/storage/file/'+value.$kerFile);blob=await r.blob();files.set(value.$kerFile,blob);}
  blob=new Blob([blob],{type:value.type||'application/octet-stream'});
  if(value.encoding==='blob')return blob;
  return await new Promise((ok,no)=>{let reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=()=>no(reader.error);reader.readAsDataURL(blob)});
 }
 if(Array.isArray(value)){let out=[];for(let x of value)out.push(await decode(x));return out;}
 if(value&&typeof value==='object'){let out={};for(let k of Object.keys(value))out[k]=await decode(value[k]);return out;}
 return value;
}
function fileHashes(value,out=new Set()){if(value&&typeof value==='object'){if(value.$kerFile)out.add(value.$kerFile);else Object.values(value).forEach(x=>fileHashes(x,out));}return out;}
async function uploadFiles(snapshot){for(let hash of fileHashes(snapshot)){if(uploaded.has(hash))continue;let head=await transport('/api/storage/file/'+hash,{method:'HEAD',cache:'no-store'});if(head.status===401)throw Object.assign(Error('Connexion nécessaire'),{status:401});if(!head.ok){if(head.status!==404)throw Error('Stockage des fichiers indisponible');let blob=files.get(hash);if(!blob)throw Error('Pièce jointe locale introuvable');await api('/api/storage/file/'+hash,{method:'PUT',body:blob});}uploaded.add(hash);}}
async function api(path,options={}){let r=await transport(path,{...options,cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Object.assign(Error('Sauvegarde indisponible'),{status:r.status});return r;}
async function capture(){files=new Map();return {format:'ker-auto-v1',app:adapter.name,data:stable(await encode(await adapter.read()))};}
const digest=snapshot=>sha(JSON.stringify(snapshot));
function empty(snapshot){return adapter.empty(snapshot.data);}
function status(text){lastStatus=text;const label=document.getElementById('ker-cloud-label');if(label)label.textContent=text;}
function ui(){
 if(document.getElementById('ker-cloud'))return;
 let style=document.createElement('style');style.textContent='#ker-cloud{position:fixed;right:12px;bottom:85px;z-index:1000;font:12px system-ui;max-width:calc(100vw - 24px)}#ker-cloud>button{background:#243b32;color:#fff;border:1px solid #7da68d;border-radius:14px;padding:9px 13px;box-shadow:0 3px 15px #0003;font:inherit}#ker-cloud-panel{position:absolute;bottom:45px;right:0;width:300px;max-width:calc(100vw - 24px);max-height:65vh;overflow:auto;background:#fff;color:#243b32;padding:18px;border:1px solid #cbd5ce;border-radius:16px;box-shadow:0 5px 30px #0003}#ker-cloud-panel[hidden]{display:none}#ker-cloud-panel p{font:14px/1.5 system-ui;margin:0 0 12px}#ker-cloud-panel button,#ker-cloud-panel a{display:block;text-align:left;width:100%;margin:8px 0;padding:10px;background:#e8f0ea;color:#243b32;border:0;border-radius:8px;font:14px system-ui;text-decoration:none;box-sizing:border-box}';document.head.append(style);
 let box=document.createElement('div');box.id='ker-cloud';box.innerHTML='<button type="button" id="ker-cloud-toggle"><span id="ker-cloud-label"></span> ▾</button><section id="ker-cloud-panel" hidden></section>';document.body.append(box);
 document.getElementById('ker-cloud-toggle').onclick=()=>{const p=document.getElementById('ker-cloud-panel');p.hidden=!p.hidden;if(!p.hidden)panel();};status(lastStatus);
}
function panel(){let p=document.getElementById('ker-cloud-panel');if(!p)return;p.replaceChildren();let text=document.createElement('p');text.textContent=lastStatus+(account?.email?' · '+account.email:'');p.append(text);
 if(!account){let a=document.createElement('a');a.href='/signin-with-chatgpt?return_to='+encodeURIComponent(location.pathname+location.search);a.target='_top';a.textContent='Connecter ma sauvegarde';if(window.KerCloudConnect){a.href='#';a.onclick=e=>{e.preventDefault();void window.KerCloudConnect()};}p.append(a);}
 else{button(p,'Réessayer la synchronisation',()=>{paused=false;void sync(true)});button(p,'Mes versions sauvegardées',history);}
 if(paused&&lastStatus.startsWith('Compte différent')){let a=document.createElement('a');a.href='/signout-with-chatgpt?return_to=/';a.target='_top';a.textContent='Changer de compte';if(window.KerCloudDisconnect){a.href='#';a.onclick=e=>{e.preventDefault();void window.KerCloudDisconnect()};}p.append(a);}else if(paused)button(p,'Résoudre les différences entre appareils',()=>void resolveCurrent());
}
function button(parent,text,action){let b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;parent.append(b);return b;}
async function push(snapshot,version,path='/api/storage'){await uploadFiles(snapshot);const r=await api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({snapshot,version})});return r.json();}
async function applyRemote(remote,live){
 const before=await adapter.read(),beforeHash=await digest(await capture());await adapter.protect?.(before);
 const data=await decode(remote.snapshot.data);if(await digest(await capture())!==beforeHash)throw Error('Des modifications locales sont en cours');await adapter.replace(data);
 meta={user:remote.user,version:remote.version,hash:await digest(remote.snapshot)};setMeta();status('Sauvegardé en ligne');
 if(live&&adapter.reload)location.reload();
}
async function resolve(local,remote,live){
 paused=true;status('Deux versions à rapprocher');
 // Preserve the local version server-side before allowing either choice.
 await push(local,meta.version||0,'/api/storage/recovery');
 ui();let p=document.getElementById('ker-cloud-panel');p.hidden=false;p.replaceChildren();let t=document.createElement('p');t.textContent='Ce téléphone et votre compte contiennent des données différentes. Les deux copies sont protégées dans l’historique. Quelle version utiliser ?';p.append(t);
 return new Promise(resolve=>{
 button(p,'Utiliser la version de ce téléphone',async()=>{try{const result=await push(local,remote.version);meta={user:remote.user,version:result.version,hash:await digest(local)};setMeta();paused=false;status('Sauvegardé en ligne');p.hidden=true;resolve();}catch(e){status(e.status===409?'Nouvelle modification ailleurs : réessayez':'Synchronisation en attente');}});
 button(p,'Récupérer la version de mon compte',async()=>{try{await applyRemote(remote,live);paused=false;p.hidden=true;resolve();}catch{status('Récupération en attente');}});
 });
}
async function resolveCurrent(){if(busy)return;busy=true;try{const r=await (await api('/api/storage')).json();account=r;await resolve(await capture(),r,true);}catch{status('Synchronisation en attente');}finally{busy=false}}
async function reconcile(live){
 const remote=await (await api('/api/storage')).json();account=remote;
 const local=await capture(),hash=await digest(local);
 if(remote.snapshot?.app!==undefined&&remote.snapshot.app!==adapter.name)throw Error('Format incompatible');
 if(meta.user&&meta.user!==remote.user&&!empty(local)){paused=true;status('Compte différent : reconnectez le compte d’origine');return;}
 if(!remote.snapshot){const result=await push(local,0);meta={user:remote.user,version:result.version,hash};setMeta();status('Sauvegardé en ligne');return;}
 if(hash===await digest(remote.snapshot)){meta={user:remote.user,version:remote.version,hash};setMeta();status('Sauvegardé en ligne');return;}
 if(empty(local)||hash===meta.hash){await applyRemote(remote,live);return;}
 if(meta.user===remote.user&&meta.version===remote.version){const result=await push(local,remote.version);meta={user:remote.user,version:result.version,hash};setMeta();status('Sauvegardé en ligne');return;}
 await resolve(local,remote,live);
}
async function sync(force=false){
 if(!started||busy||paused)return;if(!navigator.onLine){status('Sur cet appareil · en attente de connexion');return;}
 busy=true;
 try{const snapshot=await capture(),hash=await digest(snapshot);if(!account||force||Date.now()-lastPoll>15000){await reconcile(true);lastPoll=Date.now();}
 else if(hash!==meta.hash){status('Enregistrement en ligne…');const result=await push(snapshot,meta.version||0);meta={user:account.user,version:result.version,hash};setMeta();status('Sauvegardé en ligne');}
 }catch(e){if(e.status===401){account=null;status('Sur cet appareil · connexion requise');}else if(e.status===409){paused=false;busy=false;return sync(true);}else status('Sur cet appareil · synchronisation en attente');}finally{busy=false;}
}
async function history(){let p=document.getElementById('ker-cloud-panel');try{const rows=await (await api('/api/storage/history')).json();p.replaceChildren();let t=document.createElement('p');t.textContent='Versions sauvegardées — restaurer protège d’abord vos données actuelles.';p.append(t);for(let row of rows.items){button(p,new Date(row.saved_at).toLocaleString('fr-FR')+' · '+row.label,async()=>{if(!confirm('Restaurer cette version ? La version actuelle sera conservée dans l’historique.'))return;if(busy)return;busy=true;try{let current=await capture();await push(current,meta.version||0,'/api/storage/recovery');const saved=await(await api('/api/storage/history/'+encodeURIComponent(row.id))).json();const decoded=await decode(saved.snapshot.data);await adapter.protect?.(await adapter.read());await adapter.replace(decoded);paused=false;busy=false;await sync(true);if(adapter.reload)location.reload();}catch{status('Restauration impossible. Vos copies sont conservées.');}finally{busy=false;}});}}catch{status('Historique temporairement indisponible');}}
async function start(a){
 if(started)return;adapter=a;started=true;try{meta=JSON.parse(localStorage.getItem(META)||'{}')}catch{meta={};}
 ui();navigator.storage?.persist?.().catch(()=>{});
 busy=true;try{if(navigator.onLine)await reconcile(false);else status('Sur cet appareil · en attente de connexion');}catch(e){status(e.status===401?'Sur cet appareil · connexion requise':'Sur cet appareil · synchronisation en attente');}finally{busy=false;ready=true;}
 setInterval(()=>void sync(),2000);window.addEventListener('online',()=>void sync(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync(true);else void sync();});
}
let scheduled=false;
function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void sync()});}
Storage.prototype.setItem=function(key,value){originalSet.call(this,key,value);if(key!==META&&key!==RECOVERY)schedule();};
const originalRemove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){originalRemove.call(this,key);if(key!==META&&key!==RECOVERY)schedule();};
const originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=originalTransaction.apply(this,args);if(args[1]==='readwrite'&&this.name!=='ker-auto-recovery')tx.addEventListener('complete',schedule);return tx;};
window.KerCloud={start,sync,status};
// Adapter for the original standalone apps. Run their scripts after initial restoration.
function openDb(spec){return new Promise((ok,no)=>{const r=indexedDB.open(spec.name,1);r.onupgradeneeded=()=>{for(let s of spec.stores||[spec.store])if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s,s===spec.store?spec.options:undefined);};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
async function dbRead(spec){let db=await openDb(spec);try{return await new Promise((ok,no)=>{const t=db.transaction(spec.store),s=t.objectStore(spec.store),kr=s.getAllKeys(),vr=s.getAll();t.oncomplete=()=>ok(kr.result.map((k,i)=>[k,vr.result[i]]));t.onerror=()=>no(t.error);});}finally{db.close();}}
async function dbReplace(spec,rows){let db=await openDb(spec);try{await new Promise((ok,no)=>{let t=db.transaction(spec.store,'readwrite'),s=t.objectStore(spec.store);s.clear();for(let [k,v]of rows){if(s.keyPath)s.put(v);else s.put(v,k);}t.oncomplete=ok;t.onabort=()=>no(t.error);t.onerror=()=>no(t.error);});}finally{db.close();}}
function standalone(config){let match=k=>config.keys?config.keys.includes(k):(config.prefixes?config.prefixes.some(prefix=>k.startsWith(prefix)):k.startsWith(config.prefix))&&k!==config.exclude;
 return {name:config.name,reload:true,empty:d=>!Object.keys(d.local||{}).length&&!(d.records||[]).length,
 read:async()=>{let local={};for(let i=0;i<localStorage.length;i++){let k=localStorage.key(i);if(match(k)){let v=localStorage.getItem(k);try{local[k]={json:JSON.parse(v)}}catch{local[k]={text:v}};}}let records=config.database?await dbRead(config.database):[];return {local,records};},
 replace:async d=>{if(!d||typeof d.local!=='object'||!Array.isArray(d.records))throw Error('Données invalides');const previous={};for(let i=0;i<localStorage.length;i++){let k=localStorage.key(i);if(match(k))previous[k]=localStorage.getItem(k);}const records=config.database?await dbRead(config.database):[];const clear=()=>{for(let i=localStorage.length-1;i>=0;i--){let k=localStorage.key(i);if(match(k))localStorage.removeItem(k);}};try{if(config.database)await dbReplace(config.database,d.records);clear();for(let[k,v]of Object.entries(d.local))if(match(k))originalSet.call(localStorage,k,'json'in v?JSON.stringify(v.json):v.text);}catch(error){clear();for(let[k,v]of Object.entries(previous))originalSet.call(localStorage,k,v);if(config.database)await dbReplace(config.database,records);throw error;}},
 protect:async data=>{if(config.database){let db=await new Promise((ok,no)=>{let r=indexedDB.open('ker-auto-recovery',1);r.onupgradeneeded=()=>r.result.createObjectStore('copies');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});await new Promise((ok,no)=>{let t=db.transaction('copies','readwrite');t.objectStore('copies').put(data,config.id+':before-restore');t.oncomplete=ok;t.onabort=()=>no(t.error);});db.close();}else originalSet.call(localStorage,RECOVERY,JSON.stringify(data));}
 };}
if(window.KER_AUTO_CONFIG)document.addEventListener('DOMContentLoaded',async()=>{try{await start(standalone(window.KER_AUTO_CONFIG));for(let old of document.querySelectorAll('script[type="text/ker-app"]')){let script=document.createElement('script');script.async=false;if(old.dataset.src){script.src=old.dataset.src;await new Promise((ok,no)=>{script.onload=ok;script.onerror=no;document.body.append(script);});}else{script.textContent=old.textContent;document.body.append(script);}}window.dispatchEvent(new Event('ker-app-ready'));}catch(e){status('Ouverture impossible. Les données sont conservées.');console.error(e);}});
})();

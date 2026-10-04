// Existing Firebase project; user-scoped data under the project's protected /users rules.
(() => {
const config=window.KER_FIREBASE_CONFIG,app=window.KER_AUTO_CONFIG;
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
let identity=Promise.resolve(null);
if(window.firebase){if(!firebase.apps.length)firebase.initializeApp(config);identity=new Promise(ok=>{let first=true;const timer=setTimeout(()=>{if(first){first=false;ok(firebase.auth().currentUser)}},5000);firebase.auth().onAuthStateChanged(user=>{if(first){first=false;clearTimeout(timer);ok(user)}if(window.KerCloud)void KerCloud.sync(true)});});}
const hex=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
const bytes64=bytes=>{let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out)};
window.KerCloudConnect=async()=>{try{if(!window.firebase)throw Error('Connexion Internet nécessaire.');await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);const provider=new firebase.auth.GoogleAuthProvider();await firebase.auth().signInWithPopup(provider);await KerCloud.sync(true);}catch(error){if(error.code==='auth/popup-blocked'){await firebase.auth().signInWithRedirect(new firebase.auth.GoogleAuthProvider());return;}alert(error.code==='auth/unauthorized-domain'?'La sauvegarde est prête. Le domaine kerlandpok.github.io doit encore être autorisé dans Firebase. Vos données restent conservées sur cet appareil.':'Connexion à la sauvegarde impossible. Réessayez avec une connexion Internet.');}};
window.KerCloudDisconnect=async()=>{if(window.firebase)await firebase.auth().signOut();};
window.KerCloudTransport=async(path,options={})=>{
 try{
  await identity;if(!window.firebase||!firebase.auth().currentUser)return reply({error:'Connexion requise'},401);
  const user=firebase.auth().currentUser,base=firebase.database().ref('users/'+user.uid+'/kerapps/'+app.id),method=options.method||'GET';
  if(path.startsWith('/api/storage/file/')){
   const hash=path.slice('/api/storage/file/'.length);if(!/^[a-f0-9]{64}$/.test(hash))return reply({},400);
   const file=base.child('files/'+hash);
   if(method==='HEAD'){const snap=await file.child('complete').once('value');return new Response(null,{status:snap.val()?200:404});}
   if(method==='PUT'){
    const bytes=new Uint8Array(await options.body.arrayBuffer());if(bytes.length>25*1024*1024)return reply({},413);if(await hex(bytes)!==hash)return reply({},400);
    const data=bytes64(bytes),parts=[];for(let i=0;i<data.length;i+=262144)parts.push(data.slice(i,i+262144));
    for(let i=0;i<parts.length;i++)await file.child('chunks/'+i).set(parts[i]);
    await file.update({count:parts.length,complete:true});return reply({saved:true});
   }
   const metadata=(await file.once('value')).val();if(!metadata?.complete)return reply({},404);
   const raw=atob(Array.from({length:metadata.count},(_,i)=>metadata.chunks[i]||'').join('')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(await hex(bytes)!==hash)return reply({},503);return new Response(bytes);
  }
  if(path==='/api/storage/history'){
   const snap=await base.child('history').orderByChild('savedAt').limitToLast(100).once('value'),items=[];snap.forEach(row=>{const v=row.val();items.push({id:row.key,version:v.version,saved_at:v.savedAt,label:v.label})});return reply({items:items.reverse()});
  }
  if(path.startsWith('/api/storage/history/')){const row=(await base.child('history/'+decodeURIComponent(path.slice('/api/storage/history/'.length))).once('value')).val();return row?reply({snapshot:JSON.parse(row.snapshotJson),version:row.version}):reply({},404);}
  if(method==='GET'){const row=(await base.child('current').once('value')).val();return reply({user:user.uid,email:user.email||'',version:row?.version||0,hash:row?.hash||null,savedAt:row?.savedAt||null,snapshot:row?.snapshotJson?JSON.parse(row.snapshotJson):null});}
  const body=JSON.parse(options.body),snapshotJson=JSON.stringify(body.snapshot),hash=await hex(new TextEncoder().encode(snapshotJson)),now=new Date().toISOString();
  const value={snapshotJson,hash,version:body.version+1,savedAt:now,label:'Sauvegarde automatique'};
  if(path==='/api/storage/recovery'){const row=base.child('history').push();await row.set({...value,version:body.version,label:'Copie protégée avant rapprochement'});return reply({saved:true,id:row.key,hash});}
  const ref=base.child('current');await ref.once('value');
  const result=await ref.transaction(current=>{if(current?.hash===hash)return current;if((current?.version||0)!==body.version)return;return value;},undefined,false);
  if(!result.committed)return reply({},409);
  const saved=result.snapshot.val();await base.child('history/v'+saved.version).set(saved);return reply({saved:true,version:saved.version,hash:saved.hash,savedAt:saved.savedAt});
 }catch(error){console.error('Automatic Firebase storage unavailable',error);return reply({error:'Synchronisation en attente'},503);}
};
})();

export function appNavigation(onBack,onExitUnavailable){
 const key='__pillCounterNavigation';let exiting=false,watcher=null,activated=false,restoring=false;
 const dialogs=[...document.querySelectorAll('dialog')];
 const hasDialog=()=>dialogs.some(d=>d.open);
 function syncWatcher(){
  if(exiting||hasDialog()){watcher?.destroy();watcher=null;return;}
  if(watcher||typeof window.CloseWatcher!=='function')return;
  watcher=new CloseWatcher();
  watcher.addEventListener('close',()=>{watcher=null;onBack();queueMicrotask(syncWatcher);});
 }
 function guard(){
  if(exiting||restoring||history.state?.[key]==='guard')return;
  history.replaceState({...history.state,[key]:'base'},'',location.href);
  history.pushState({...history.state,[key]:'guard'},'',location.href);
 }
 // Create the fallback entry during a real gesture, not only at page load:
 // mobile browsers may skip history entries created without user activation.
 function activate(e){
  if(!e.isTrusted||exiting)return;
  activated=true;guard();syncWatcher();
 }
 for(const event of ['pointerup','click','keydown'])document.addEventListener(event,activate,true);
 window.addEventListener('popstate',()=>{
  if(exiting)return;
  if(history.state?.[key]==='guard'){
   if(restoring){restoring=false;onBack();syncWatcher();}
   return;
  }
  if(history.state?.[key]==='base'){
   // Reuse the entry created by a real tap. Creating another pushState here
   // makes Chromium mark same-document entries skippable on subsequent Back.
   restoring=true;history.forward();
  }
 });
 // A native dialog owns Android Back/Escape while it is open. Never leave a
 // second watcher in its group, which could close both the dialog and screen.
 for(const dialog of dialogs){
  new MutationObserver(syncWatcher).observe(dialog,{attributes:true,attributeFilter:['open']});
  dialog.addEventListener('close',syncWatcher);
 }
 window.addEventListener('beforeunload',e=>{
  if(!exiting&&activated){e.preventDefault();e.returnValue='';}
 });
 window.addEventListener('pagehide',()=>{watcher?.destroy();watcher=null;});
 window.addEventListener('pageshow',()=>{exiting=false;restoring=false;if(activated)guard();syncWatcher();});
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){watcher?.destroy();watcher=null;syncWatcher();}
 });
 syncWatcher();
 return {exit(){
  exiting=true;syncWatcher();
  const guarded=history.state?.[key]==='guard';let left=false;
  const onHide=()=>{left=true;};window.addEventListener('pagehide',onHide,{once:true});
  history.go(guarded?-2:-1);
  setTimeout(()=>{
   window.removeEventListener('pagehide',onHide);
   if(left)return;
   exiting=false;guard();syncWatcher();onExitUnavailable();
  },800);
 }};
}

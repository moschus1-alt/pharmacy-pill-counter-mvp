export function appNavigation(onBack){
 const key='__pillCounterNavigation';
 let exiting=false,watcher=null,activated=false,restoring=false,restoreTimer=null,exitTimer=null,exitRequested=false;
 const dialogs=[...document.querySelectorAll('dialog')];
 const hasDialog=()=>dialogs.some(d=>d.open);
 function syncWatcher(){
  if(exiting||restoring||hasDialog()){watcher?.destroy();watcher=null;return;}
  if(watcher||typeof window.CloseWatcher!=='function')return;
  try{watcher=new CloseWatcher();}catch{return;}
  watcher.addEventListener('close',()=>{watcher=null;if(!restoring&&!exiting)onBack();queueMicrotask(syncWatcher);});
 }
 function guard(){
  if(exiting||restoring||history.state?.[key]==='guard')return;
  history.replaceState({...history.state,[key]:'base'},'',location.href);
  history.pushState({...history.state,[key]:'guard'},'',location.href);
 }
 function finishRestore(){
  clearTimeout(restoreTimer);restoreTimer=null;restoring=false;
  if(exitRequested){exitRequested=false;leave();}else syncWatcher();
 }
 function activate(e){
  if(!e.isTrusted||exiting)return;
  // A real tap may repair a delayed/blocked restore without creating a
  // browser-skippable entry inside popstate. pushState replaces the old forward
  // guard, so a late forward() cannot consume the next Back or duplicate it.
  if(restoring&&history.state?.[key]==='base'){clearTimeout(restoreTimer);restoreTimer=null;restoring=false;}
  activated=true;guard();syncWatcher();
 }
 for(const event of ['pointerup','touchend','click','keydown'])document.addEventListener(event,activate,true);
 window.addEventListener('popstate',()=>{
  if(exiting)return;
  if(history.state?.[key]==='guard'){if(restoring)finishRestore();return;}
  if(history.state?.[key]==='base'&&!restoring){
   restoring=true;syncWatcher();
   // Toolbar Back is a history traversal, not a CloseWatcher request. Show the
   // UI now: Samsung may delay or suppress the forward traversal. Waiting for
   // its second popstate used to make confirmation disappear intermittently.
   history.forward();
   restoreTimer=setTimeout(finishRestore,500);
   onBack();
  }
 });
 for(const dialog of dialogs){
  new MutationObserver(syncWatcher).observe(dialog,{attributes:true,attributeFilter:['open']});
  dialog.addEventListener('close',syncWatcher);
 }
 window.addEventListener('beforeunload',e=>{
  if(!exiting&&activated){e.preventDefault();e.returnValue='';}
 });
 window.addEventListener('pagehide',()=>{
  clearTimeout(restoreTimer);clearTimeout(exitTimer);watcher?.destroy();watcher=null;
 });
 window.addEventListener('pageshow',()=>{
  exiting=false;exitRequested=false;restoring=false;clearTimeout(restoreTimer);clearTimeout(exitTimer);guard();syncWatcher();
 });
 document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){watcher?.destroy();watcher=null;syncWatcher();}
 });
 // Prepare even before the first in-page tap. A browser's anti-trapping policy
 // can still skip unactivated entries; do not claim to override that policy.
 guard();syncWatcher();
 function leave(){
  exiting=true;syncWatcher();
  const distance=history.state?.[key]==='guard'?2:1;
  const end=()=>location.replace(new URL('../exit.html',import.meta.url));
  if(history.length<=distance){end();return;}
  // A real cross-document traversal may wait on a slow previous website.
  // Once it starts, never replace that navigation with our fallback page.
  const onNavigate=e=>{if(e.navigationType==='traverse'&&!e.destination.sameDocument){clearTimeout(exitTimer);window.navigation?.removeEventListener('navigate',onNavigate);}};
  window.navigation?.addEventListener('navigate',onNavigate);
  exitTimer=setTimeout(()=>{window.navigation?.removeEventListener('navigate',onNavigate);end();},1500);
  history.go(-distance);
 }
 return {exit(){
  if(exiting||exitRequested)return;
  // A fast click on "Exit" must wait for the pending history restoration so
  // that the traversal distance is calculated from the entry actually in use.
  if(restoring){exitRequested=true;return;}
  leave();
 }};
}

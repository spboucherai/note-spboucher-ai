/*
  gate-page.ts — access-code page (single owner, no accounts)
  Author: Simon-Pierre Boucher

  Self-contained HTML (inline CSS + a few lines of JS, no external asset). Lock-screen layout with an on-screen
  keypad that has its own Enter key: phone numeric keyboards have no "Go" key, so the form could not be
  submitted from a phone. The real <input type="password"> stays in the form (password managers, hardware
  keyboards, paste); with JavaScript it switches to inputmode="none" so the native keyboard does not cover the
  keypad. Without JavaScript the page is still a plain form with a visible submit button.
  The code length is never revealed (no fixed number of boxes, no auto-submit).
*/
export interface GatePageOptions {
  /** Wordmark, e.g. "spb.chat". The part after the dot is tinted. */
  brand: string;
  lang: "fr" | "en";
  next: string;
  error?: "bad" | "limited" | null;
  /** Two CSS colours of the brand gradient. */
  accent?: [string, string];
}

const TXT = {
  fr: { title: "Accès privé", lead: "Entre ton code d'accès", bad: "Code incorrect.", limited: "Trop de tentatives. Réessaie dans une minute.", label: "Code d'accès", enter: "Entrer", del: "Effacer", show: "Afficher le code", foot: "Espace privé · accès réservé" },
  en: { title: "Private access", lead: "Enter your access code", bad: "Wrong code.", limited: "Too many attempts. Try again in a minute.", label: "Access code", enter: "Enter", del: "Delete", show: "Show the code", foot: "Private space · restricted access" },
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function gatePageHtml(o: GatePageOptions): string {
  const t = TXT[o.lang];
  const [a1, a2] = o.accent ?? ["#6366f1", "#06b6d4"];
  const msg = o.error === "bad" ? t.bad : o.error === "limited" ? t.limited : "";
  const [b1, b2] = o.brand.includes(".") ? [o.brand.slice(0, o.brand.indexOf(".")), o.brand.slice(o.brand.indexOf("."))] : [o.brand, ""];
  const key = (d: string) => `<button type="button" class="k" data-k="${d}">${d}</button>`;
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0b0d14"><title>${esc(t.title)}</title>
<style>
:root{--a1:${a1};--a2:${a2};--fg:#f5f6fa;--mu:#a3a8b8;--er:#ff8a7a;--glass:rgba(255,255,255,.07);--line:rgba(255,255,255,.14)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;margin:0}
body{min-height:100dvh;display:grid;place-items:center;color:var(--fg);background:#0b0d14;font:16px/1.4 ui-sans-serif,system-ui,-apple-system,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));overflow:hidden;-webkit-font-smoothing:antialiased}
.bg{position:fixed;inset:-20%;z-index:0;pointer-events:none;filter:blur(70px) saturate(140%);opacity:.75}
.bg i{position:absolute;border-radius:50%;animation:drift 22s ease-in-out infinite alternate}
.bg i:nth-child(1){width:46vmax;height:46vmax;left:6%;top:4%;background:var(--a1)}
.bg i:nth-child(2){width:40vmax;height:40vmax;right:4%;bottom:2%;background:var(--a2);animation-duration:28s;animation-direction:alternate-reverse}
.bg i:nth-child(3){width:26vmax;height:26vmax;left:44%;top:50%;background:#f472b6;opacity:.45;animation-duration:34s}
@keyframes drift{to{transform:translate3d(6vmax,-5vmax,0) scale(1.12)}}
.grain{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 0%,transparent 0,rgba(11,13,20,.55) 55%,#0b0d14 100%)}
main{position:relative;z-index:1;width:100%;max-width:340px;display:grid;justify-items:center;gap:18px;animation:in .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(14px) scale(.98)}}
.logo{width:62px;height:62px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(135deg,var(--a1),var(--a2));box-shadow:0 14px 40px -10px var(--a1),inset 0 1px 0 rgba(255,255,255,.35)}
.logo svg{width:28px;height:28px;color:#fff}
h1{margin:0;font-size:25px;font-weight:700;letter-spacing:-.02em}
h1 span{background:linear-gradient(90deg,var(--a1),var(--a2));-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{margin:-10px 0 0;color:var(--mu);font-size:14.5px}
form{width:100%;display:grid;gap:14px;justify-items:center}
.field{position:relative;width:100%}
.field input{width:100%;height:58px;border-radius:18px;border:1px solid var(--line);background:var(--glass);color:var(--fg);font:600 26px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.42em;text-align:center;padding:0 52px;outline:none;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transition:border-color .15s,box-shadow .15s;caret-color:var(--a2)}
.field input:focus{border-color:color-mix(in srgb,var(--a2) 70%,white 0%);box-shadow:0 0 0 4px color-mix(in srgb,var(--a2) 22%,transparent)}
.eye{position:absolute;right:8px;top:8px;width:42px;height:42px;border:0;border-radius:12px;background:transparent;color:var(--mu);display:grid;place-items:center;cursor:pointer}
.eye:hover,.eye:focus-visible{color:var(--fg);background:rgba(255,255,255,.08);outline:none}
.eye svg{width:20px;height:20px}
.msg{min-height:20px;margin:-4px 0 -2px;font-size:13.5px;font-weight:600;color:var(--er)}
.pad{display:none;grid-template-columns:repeat(3,1fr);gap:12px;width:100%;max-width:300px}
.js .pad{display:grid}
.k{height:64px;border-radius:20px;border:1px solid var(--line);background:var(--glass);color:var(--fg);font:500 26px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;cursor:pointer;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transition:transform .08s,background .12s,border-color .12s;user-select:none;-webkit-user-select:none;touch-action:manipulation;display:grid;place-items:center}
.k:hover{background:rgba(255,255,255,.12)}
.k:active,.k.on{transform:scale(.94);background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.35)}
.k:focus-visible{outline:2px solid var(--a2);outline-offset:2px}
.k svg{width:26px;height:26px}
.k.del{background:transparent;border-color:transparent;color:var(--mu)}
.k.go{border:0;background:linear-gradient(135deg,var(--a1),var(--a2));color:#fff;box-shadow:0 10px 26px -10px var(--a1)}
.k.go:disabled{opacity:.6}
.plain{width:100%;height:54px;border:0;border-radius:18px;background:linear-gradient(135deg,var(--a1),var(--a2));color:#fff;font:600 17px/1 inherit;cursor:pointer}
.js .plain{display:none}
.foot{margin:2px 0 0;font-size:12px;color:rgba(163,168,184,.75);letter-spacing:.02em}
.shake{animation:shake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-8px)}40%,60%{transform:translateX(8px)}}
.spin{width:24px;height:24px;border-radius:50%;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
@media (max-height:640px){main{gap:12px}.logo{width:48px;height:48px;border-radius:16px}.k{height:54px}.field input{height:52px}h1{font-size:22px}}
@media (min-width:700px){.k{height:60px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<div class="bg" aria-hidden="true"><i></i><i></i><i></i></div><div class="grain" aria-hidden="true"></div>
<main>
<div class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10" rx="3"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/></svg></div>
<h1>${esc(b1)}<span>${esc(b2)}</span></h1>
<p class="lead">${esc(t.lead)}</p>
<form method="post" action="/api/gate" autocomplete="off" id="f"${msg ? ' class="shake"' : ""}>
<input type="hidden" name="next" value="${esc(o.next)}">
<div class="field"><input id="pw" type="password" name="password" inputmode="numeric" enterkeyhint="go" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="128" aria-label="${esc(t.label)}" ${msg ? 'aria-invalid="true" aria-describedby="m" ' : ""}required autofocus>
<button type="button" class="eye" id="eye" aria-label="${esc(t.show)}" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
<p class="msg" id="m" role="status" aria-live="polite">${esc(msg)}</p>
<div class="pad" role="group" aria-label="${esc(t.label)}">
${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(key).join("")}
<button type="button" class="k del" data-k="del" aria-label="${esc(t.del)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9.5l-5 5M12 9.5l5 5"/></svg></button>
${key("0")}
<button type="submit" class="k go" id="go" aria-label="${esc(t.enter)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
</div>
<button type="submit" class="plain">${esc(t.enter)}</button>
</form>
<p class="foot">${esc(t.foot)}</p>
</main>
<script>
(function(){
  var d=document,f=d.getElementById('f'),pw=d.getElementById('pw'),go=d.getElementById('go'),eye=d.getElementById('eye'),m=d.getElementById('m');
  d.documentElement.className='js';
  var touch=matchMedia('(pointer:coarse)').matches;
  if(touch){pw.setAttribute('inputmode','none');}
  function buzz(){try{navigator.vibrate&&navigator.vibrate(8)}catch(e){}}
  function clearMsg(){if(m.textContent){m.textContent='';pw.removeAttribute('aria-invalid')}}
  d.querySelector('.pad').addEventListener('click',function(e){
    var b=e.target.closest('[data-k]');if(!b)return;var k=b.getAttribute('data-k');
    if(k==='del')pw.value=pw.value.slice(0,-1);else if(pw.value.length<128)pw.value+=k;
    clearMsg();buzz();if(!touch)pw.focus();
  });
  pw.addEventListener('input',clearMsg);
  eye.addEventListener('click',function(){var s=pw.type==='password';pw.type=s?'text':'password';eye.setAttribute('aria-pressed',String(s));});
  d.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey)return;
    var b=/^[0-9]$/.test(e.key)?d.querySelector('.k[data-k="'+e.key+'"]'):e.key==='Backspace'?d.querySelector('.k.del'):e.key==='Enter'?go:null;
    if(b){b.classList.add('on');setTimeout(function(){b.classList.remove('on')},130)}
    if(d.activeElement!==pw&&(e.key.length===1||e.key==='Backspace')){pw.focus()}
  });
  f.addEventListener('submit',function(e){
    if(!pw.value){e.preventDefault();f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');return}
    go.disabled=true;go.innerHTML='<span class="spin"></span>';
  });
  addEventListener('pageshow',function(e){if(e.persisted){go.disabled=false;location.reload()}});
})();
</script>
</body></html>`;
}

/* Manual caller-visible light-adoption regression, adapted from the parent bridge scan.
 * Run with an isolated daemon and synthetic task; sampled contrast is not accessibility certification. */
async (page, baseURL) => {
  const c=await page.context().browser().newContext({viewport:{width:1440,height:1000}});
  const p=await c.newPage();
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  try {
    await p.goto(`${baseURL}/dashboard`);await p.waitForSelector('.fc-timegrid-slot');
    const task=await p.evaluate(async()=>(await api.get('/api/tasks?status=all'))[0]);
    if (!task) throw Error('Seed an isolated synthetic task through the public API before this probe.');
    const results=[];
    for(const theme of ['refined','stone','porcelain']) {
      for(const route of ['/dashboard','/tasks','/stats','/habits-view','/revision','/settings/ai',`/task-inspector/${task.id}`]) {
        await p.goto(baseURL+route);await p.waitForSelector('#appearance_toggle');
        await p.locator('#appearance_light_theme').selectOption(theme);
        const sample=await p.evaluate(()=>{
          const rgba=s=>{const n=s.match(/[\d.]+/g)?.map(Number)||[0,0,0,0];return[n[0],n[1],n[2],n[3]??1]};
          const blend=(f,b)=>[0,1,2].map(i=>f[i]*f[3]+b[i]*(1-f[3])).concat(1);
          const lum=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
          const background=el=>{const a=[];for(let n=el;n;n=n.parentElement)a.unshift(n);return a.reduce((b,n)=>blend(rgba(getComputedStyle(n).backgroundColor),b),[255,255,255,1]);};
          let sampled=0;
          const issues=[...document.querySelectorAll('a,button,label,span,strong,h1,h2,h3,h4,p,div,input,select,textarea,td,th')].filter(el=>{
            const r=el.getBoundingClientRect(),s=getComputedStyle(el);
            return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.visibility!=='hidden'&&Number(s.opacity)>0&&([...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||el.matches('input,select,textarea'));
          }).map(el=>{
            sampled++;const s=getComputedStyle(el),b=background(el),f=blend(rgba(s.color),b);const ratio=(Math.max(lum(f),lum(b))+.05)/(Math.min(lum(f),lum(b))+.05);
            const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
            return{id:el.id,text:(el.innerText||el.getAttribute('placeholder')||el.getAttribute('aria-label')||'').trim().slice(0,65),ratio:Math.round(ratio*100)/100,threshold:large?3:4.5,fg:s.color,bg:b.slice(0,3).map(Math.round),classes:String(el.className).slice(0,140)};
          }).filter(x=>x.ratio<x.threshold);
          const nav=document.querySelector('.app-navigation').getBoundingClientRect(),head=document.querySelector('body>header').getBoundingClientRect();
          return{sampled,issues,head:{width:head.width,height:head.height},nav:{width:nav.width,height:nav.height}};
        });results.push({theme,route,...sample});
      }
    }
    const issues=results.filter(result=>result.issues.length);
    if (issues.length || errors.length) throw Error(JSON.stringify({issues,errors}));
    return{results,errors};
  } finally {await c.close();}
}
;

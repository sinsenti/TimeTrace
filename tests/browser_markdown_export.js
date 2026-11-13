/* Existing native runner; real APIs/files. Clipboard permissions and named held/failed HTTP are explicit fakes. */
async (page, baseURL) => {
    const fs = require('node:fs');
    const results = [], downloads = [], measurements = [], errors = [], traffic = [];
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const context = await page.context().browser().newContext({viewport:{width:1440,height:1000},timezoneId:'America/New_York'});
    await context.addInitScript(ownedOrigin => {
        if (location.origin !== ownedOrigin) return;
        localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false}));
        window.clipboardCopies = []; window.clipboardMode = 'ok';
        Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText: text => {
            window.clipboardCopies.push(text);
            if (window.clipboardMode === 'deny') return Promise.reject(Error('Synthetic clipboard permission denied'));
            if (window.clipboardMode === 'hold') return new Promise(resolve => window.releaseClipboard = resolve);
            return Promise.resolve();
        }}});
    }, new URL(baseURL).origin);
    const p = await context.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => {if(new URL(r.url()).origin === baseURL) traffic.push({method:r.method(),path:new URL(r.url()).pathname});});
    const request = async (method,path,data) => {
        const response = await context.request[method](baseURL + path, data === undefined ? {} : {data});
        if (!response.ok()) throw Error(`${method} ${path} ${response.status()} ${await response.text()}`);
        return response.status() === 204 ? null : response.json();
    };
    const ready = async () => p.waitForFunction(() => document.getElementById('export_preview').getAttribute('aria-busy') === 'false' && !document.getElementById('export_download').disabled);
    const open = async () => {await p.locator('button[onclick="openExportModal()"]').click(); await ready();};
    const scope = async mode => {await p.locator('#export_mode_select').selectOption(mode); await ready();};
    const file = async keyboard => {
        const expected = await p.locator('#export_preview').inputValue();
        const downloadEvent = p.waitForEvent('download');
        if (keyboard) await p.locator('#export_preview').press('Control+Enter');
        else await p.locator('#export_download').click();
        const download = await downloadEvent;
        const path = await download.path();
        const actual = fs.readFileSync(path,'utf8');
        const mode = await p.locator('#export_mode_select').inputValue();
        check(actual === expected, `Real downloaded file bytes equal current ${mode} preview`);
        check(download.suggestedFilename() === `timetrace_export_${mode}.md`, `Truthful ${mode} Markdown filename`);
        downloads.push({mode,filename:download.suggestedFilename(),bytes:Buffer.byteLength(actual),content:actual});
        check((await p.locator('#export_status').textContent()).includes('requested'), 'Download says requested, not OS-saved');
    };
    try {
        const stamp = `24-${Date.now()}`;
        const literal = `${stamp} <img src=x onerror="window.exportExecuted=true"> **literal**`;
        await request('post','/api/tasks',{title:literal,description:'Task definition stays unfiltered',assigned_date:'1999-01-01'});
        await request('post','/habits',{name:stamp+' habit definition',habit_type:'boolean'});
        const fixtures = [
            ['2026-11-09T23:59:59.999999Z','2026-11-10T01:00:00Z','excluded overlap'],
            ['2026-11-10T00:00:00Z','2026-11-12T01:00:00Z','included midnight'],
            ['2026-11-10T23:59:59.999999Z','2026-11-11T01:00:00Z','included end microsecond'],
            ['2026-11-11T00:00:00Z','2026-11-11T01:00:00Z','excluded next midnight']
        ];
        for (const [start_time,end_time,notes] of fixtures) await request('post','/sessions',{start_time,end_time,notes:stamp+' '+notes});
        const start = new Date(Date.now()+2*86400000); start.setUTCMilliseconds(0);
        const recurring = await request('post','/api/tasks',{title:stamp+' recurring agenda',is_recurring:true,recurrence_rule:'daily',recurrence_dtstart:start.toISOString()});
        const projected = (await request('get',`/sessions?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(new Date(+start+4*86400000).toISOString())}`)).filter(row=>row.task_id === recurring.id);
        check(projected.length === 4 && projected.every(row=>row.id.startsWith('virt:')), 'Real API returns virtual recurrence without pre-generation');
        await request('delete',`/sessions/${projected[0].id}`);
        const movedStart = new Date(+start+86400000+7200000);
        const moved = await request('put',`/sessions/${projected[1].id}`,{start_time:movedStart.toISOString(),end_time:new Date(+movedStart+1800000).toISOString(),notes:stamp+' moved'});
        await request('put',`/api/tasks/${recurring.id}`,{description:'Unrelated edit retains exceptions'});
        const merged = (await request('get',`/sessions?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(new Date(+start+4*86400000).toISOString())}`)).filter(row=>row.task_id === recurring.id);
        check(merged.length === 3 && merged.some(row=>row.id === moved.id) && merged.filter(row=>row.is_virtual).length === 2, 'Skip/move survive unrelated task edit in merged read');
        await p.goto(baseURL+'/dashboard?date=2026-11-10&view=timeGridThreeDay'); await p.waitForSelector('.fc-timegrid-slot');
        const calendarBefore = await p.evaluate(()=>[calendar.getDate().toISOString(),calendar.view.type,location.href]);
        const beforeExport = traffic.length;
        await open();
        check(await p.evaluate(()=>document.activeElement.id) === 'export_mode_select','Initial focus is scope, without deferred focus theft');
        const modes = ['sessions','tasks_short','tasks_full','habits','all','all_date_range'];
        const labels = ['Sessions','Tasks—compact','Tasks—detailed','Habit definitions','Everything','Everything—with session date range'];
        check(JSON.stringify(await p.locator('#export_mode_select option').allTextContents()) === JSON.stringify(labels),'Six exact approved labels in order');
        const headings = ['# TimeTrace Session Agenda','# TimeTrace Task Agenda Summary','# TimeTrace Complete Task Dossier','# TimeTrace Habits Briefing','# TimeTrace System-Wide Export','# TimeTrace System-Wide Export'];
        for (let i=0;i<modes.length;i++) {
            if (i) await scope(modes[i]);
            if (modes[i] === 'all_date_range') {
                await p.locator('#export_start_date').fill('2026-11-10');
                await p.locator('#export_end_date').fill('2026-11-10');
                await p.locator('#export_generate').click(); await ready();
            }
            const content = await p.locator('#export_preview').inputValue();
            check(content.includes(headings[i]), `Real endpoint generates ${modes[i]} Markdown`);
            if (['tasks_short','tasks_full','all','all_date_range'].includes(modes[i])) check(content.includes(literal),'Task definitions remain literal and unfiltered');
            if (['habits','all','all_date_range'].includes(modes[i])) check(content.includes(stamp+' habit definition'),'Habit definitions remain unfiltered');
            if (modes[i] === 'sessions') check(content.includes(stamp+' recurring agenda'),'Agenda includes real merged upcoming projections');
            if (modes[i] === 'all_date_range') {
                check(content.includes(stamp+' included midnight') && content.includes(stamp+' included end microsecond'),'Inclusive UTC start/end day preserves last microsecond and long rows');
                check(!content.includes(stamp+' excluded overlap') && !content.includes(stamp+' excluded next midnight'),'UTC start dates, not overlap/end times, determine inclusion');
            }
            await file(i===5);
        }
        check(!await p.evaluate(()=>window.exportExecuted),'Generated Markdown is inert, never interpreted');
        check(await p.locator('#export_preview img').count() === 0,'Preview has no interpreted HTML nodes');
        check(JSON.stringify(await p.evaluate(()=>[calendar.getDate().toISOString(),calendar.view.type,location.href])) === JSON.stringify(calendarBefore),'Downloads preserve Calendar date/view and page URL');
        check(traffic.slice(beforeExport).every(row=>row.method === 'GET'),'Export workflow performs reads only');
        const preview = await p.locator('#export_preview').inputValue();
        await p.locator('#export_copy').click();
        await p.waitForFunction(()=>document.getElementById('export_status').textContent.startsWith('Copied'));
        check(await p.evaluate(()=>window.clipboardCopies.at(-1)) === preview,'Explicit clipboard success fake receives exact current Markdown');
        await p.evaluate(()=>window.clipboardMode='deny'); await p.locator('#export_copy').click();
        await p.waitForFunction(()=>document.getElementById('export_status').textContent.includes('Copy failed'));
        check(await p.locator('#export_preview').inputValue() === preview,'Clipboard permission fake failure retains preview');
        await p.evaluate(()=>window.clipboardMode='hold'); await p.locator('#export_copy').click();
        check(await p.locator('#export_copy').isDisabled(),'Pending Copy prevents double activation');
        await p.keyboard.press('Escape'); await open(); await p.evaluate(()=>window.releaseClipboard());
        check(!(await p.locator('#export_status').textContent()).startsWith('Copied'),'Late clipboard success cannot replace reopened owner');
        check(await p.locator('#export_start_date').inputValue() === '2026-11-10' && await p.locator('#export_end_date').inputValue() === '2026-11-10','Close/reopen retains scope and dates');
        await p.evaluate(()=>window.clipboardMode='ok');

        // HTTP boundary: hold the obsolete owner's request, reopen with a real newer request, then reject old.
        let release, entered;
        const held = new Promise(resolve=>release=resolve), boundary = new Promise(resolve=>entered=resolve);
        let holdOnce = true;
        await context.route('**/api/agenda/export?*', async route=>{
            if (holdOnce) {holdOnce=false;entered();await held;await route.fulfill({status:503,json:{detail:'obsolete export owner'}});}
            else await route.continue();
        });
        await p.locator('#export_generate').click(); await boundary;
        check(await p.locator('#export_download').isDisabled() && await p.locator('#export_copy').isDisabled(),'Pending read disables stale Copy and Download');
        const readCount = traffic.filter(r=>r.path === '/api/agenda/export').length;
        await p.locator('#export_preview').press('Control+Enter');
        check((await p.locator('#export_status').textContent()).includes('loading'),'Ctrl+Enter while pending honestly waits');
        check(traffic.filter(r=>r.path === '/api/agenda/export').length === readCount,'Pending shortcut never regenerates or downloads stale preview');
        await p.keyboard.press('Escape'); await open();
        const currentPreview = await p.locator('#export_preview').inputValue();
        const oldReply = p.waitForResponse(r=>r.url().includes('/api/agenda/export') && r.status()===503);
        release(); await oldReply; await p.evaluate(()=>new Promise(requestAnimationFrame));
        check(await p.locator('#export_preview').inputValue() === currentPreview && !(await p.locator('#export_status').textContent()).includes('obsolete'),'Closed owner late error cannot replace current preview/status');
        await context.unroute('**/api/agenda/export?*');
        await context.route('**/api/agenda/export?*',route=>route.fulfill({status:503,json:{detail:'Current synthetic read failure <img>'}}));
        await p.locator('#export_generate').click();
        await p.waitForFunction(()=>document.getElementById('export_status').textContent.includes('Current synthetic read failure'));
        check(await p.locator('#export_copy').isDisabled() && await p.locator('#export_download').isDisabled(),'Current failure invalidates old preview and offers read-only Retry');
        await context.unroute('**/api/agenda/export?*');
        await p.locator('#export_generate').click(); await ready();
        await context.route('**/api/agenda/export?*',route=>route.fulfill({contentType:'text/markdown',body:''}));
        await p.locator('#export_generate').click();
        await p.waitForFunction(()=>document.getElementById('export_status').textContent.includes('empty Markdown'));
        check(await p.locator('#export_download').isDisabled(),'Empty endpoint response is honest, not downloadable stale data');
        await context.unroute('**/api/agenda/export?*'); await p.locator('#export_generate').click(); await ready();
        const expectedDates = ['2026-11-10','2026-11-10'];
        for (const width of [390,768,1024,1440]) {
            await p.setViewportSize({width,height:900});
            for (const theme of ['refined','stone','porcelain','dark']) {
                await p.evaluate(theme=>{if(theme==='dark')setAppearancePreference('appearance','dark');else{setAppearancePreference('lightTheme',theme);setAppearancePreference('appearance','light');}},theme);
                await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                const snapshot = await p.locator('#export_modal').evaluate(el=>{
                    const panel = el.querySelector('.export-panel').getBoundingClientRect();
                    const samples = [...el.querySelectorAll('h3,p,label,button,select,input,textarea')].filter(x=>x.getClientRects().length).map(x=>{
                        const s=getComputedStyle(x); let parent=x,background=s.backgroundColor;
                        while(background==='rgba(0, 0, 0, 0)' && parent.parentElement){parent=parent.parentElement;background=getComputedStyle(parent).backgroundColor;}
                        return {tag:x.tagName,id:x.id,text:x.textContent.slice(0,80),color:s.color,background,border:s.borderColor,opacity:s.opacity,disabled:x.disabled||false};
                    });
                    return {panel:{x:panel.x,right:panel.right},pageWidth:document.documentElement.scrollWidth,samples};
                });
                check(snapshot.panel.x>=8 && snapshot.panel.right<=width-8 && snapshot.pageWidth<=width, `Export fits ${width}px ${theme} without page overflow`);
                const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
                const ratio=(a,b)=>{a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
                for(const sample of snapshot.samples){sample.contrast=ratio(sample.color,sample.background);if(!sample.disabled)check(sample.contrast>=4.5,`Export text contrast ${width}/${theme}/${sample.id||sample.tag}`);if(['BUTTON','INPUT','SELECT','TEXTAREA'].includes(sample.tag)){sample.controlContrast=ratio(sample.border,sample.background);check(sample.controlContrast>=3,`Export control contrast ${width}/${theme}/${sample.id||sample.tag}`);}}
                measurements.push({width,theme,...snapshot});
                check(JSON.stringify([await p.locator('#export_start_date').inputValue(),await p.locator('#export_end_date').inputValue()]) === JSON.stringify(expectedDates),'Themes/layout retain range inputs');
                const close = p.getByRole('button',{name:'Close export',exact:true});
                await close.focus(); await p.keyboard.press('Shift+Tab');
                check(await p.evaluate(()=>document.activeElement.id)==='export_download','Shift+Tab wraps within export');
                await p.keyboard.press('Tab'); check(await close.evaluate(el=>document.activeElement===el),'Tab wraps back to first control');
            }
        }
        await p.keyboard.press('Escape');
        check(await p.locator('#export_modal').getAttribute('aria-hidden') === 'true','Closed Export is hidden from other dialog focus owners');
        check(await p.locator('button[onclick="openExportModal()"]').evaluate(el=>document.activeElement===el),'Cancel restores connected Export launcher');
        await p.setViewportSize({width:1440,height:1000});
        // Public entries can coexist; opening Export must never mutate a retained Session draft.
        await p.locator('button[onclick="createPlanningSession()"]').click();
        await p.locator('#session_modal_notes').fill('Export must preserve\nSession draft');
        const sessionBefore = await p.evaluate(()=>[document.getElementById('session_modal_notes').value,document.getElementById('session_modal_start').value,document.getElementById('session_modal_end').value]);
        await p.evaluate(()=>openExportModal()); await ready();
        await p.keyboard.press('Escape');
        check(JSON.stringify(await p.evaluate(()=>[document.getElementById('session_modal_notes').value,document.getElementById('session_modal_start').value,document.getElementById('session_modal_end').value]))===JSON.stringify(sessionBefore),'Export leaves Session fields/timestamps/draft untouched');
        await p.keyboard.press('Escape');
        check(errors.length===0,'No native page errors');
        return {results,downloads,measurements,errors,traffic,fakes:['provider catalog','clipboard success/denied/held permissions boundary (not OS clipboard certification)','held obsolete agenda 503','current agenda 503','empty agenda body'],limits:['Chromium only; no physical touch/screen reader/exhaustive zoom-motion audit','Sampled export contrast is not a global accessibility certificate; existing Task4.33 and AI3.98986 remain unwaived']};
    } finally {await context.close();}
}

/* Manual real-renderer contrast regression. Only isolated synthetic CRUD; catalog/instructions faked.
 * Optional baselineCSS lets the bridge measure the reviewed CSS before the repair (red evidence). */
async (page, baseURL, baselineCSS = null) => {
    const context = await page.context().browser().newContext({viewport:{width:1440,height:1000}});
    const p = await context.newPage();
    const errors = [], writes = [];
    p.on('pageerror', error => errors.push(error.message));
    p.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
    const conversationId = '019a4070-0000-7000-8000-000000000001';
    const untrusted = '<img src=x onerror="window.syntheticExecuted=true"> synthetic';
    let provider;
    try {
        await context.route('**/api/ai/providers/catalog', route => route.fulfill({json:{}}));
        await context.route('**/api/ai/conversations', route => route.fulfill({json:[{id:conversationId,title:'Synthetic proposal'}]}));
        await context.route(`**/api/ai/conversations/${conversationId}`, route => route.fulfill({json:{
            messages:[{role:'assistant',content:untrusted}],
            instruction_proposals:[{id:'019a4070-0000-7000-8000-000000000002',status:'proposed',
                before_instructions:'Synthetic existing instruction',proposed_instruction:untrusted,
                after_instructions:'Synthetic resulting instruction'}]
        }}));
        if (baselineCSS) await context.route('**/static/css/appearance.css', route => route.fulfill({contentType:'text/css',body:baselineCSS}));
        const response = await context.request.post(`${baseURL}/api/ai/providers`, {data:{name:untrusted,provider:'ollama',model:'synthetic-no-inference',base_url:'http://127.0.0.1:9'}});
        if (!response.ok()) throw Error(`Provider fixture: ${response.status()} ${await response.text()}`);
        provider = await response.json();
        await p.goto(`${baseURL}/settings/ai`);
        await p.waitForSelector('.ai-provider-card-name');
        await p.locator('#ai_launcher_btn').click();
        await p.waitForSelector('.ai-instruction-proposal-heading');
        const results = [];
        for (const choice of ['refined','stone','porcelain','dark']) {
            await p.evaluate(choice => {
                setAppearancePreference('appearance',choice === 'dark' ? 'dark' : 'light');
                if (choice !== 'dark') setAppearancePreference('lightTheme',choice);
            }, choice);
            const samples = await p.evaluate(() => {
                const rgba = s => { const n = s.match(/[\d.]+/g).map(Number); return [...n.slice(0,3),n[3] ?? 1]; };
                const blend = (f,b) => [0,1,2].map(i => f[i]*f[3]+b[i]*(1-f[3])).concat(1);
                const luminance = c => c.slice(0,3).map(x => x/255).map(x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((a,x,i) => a+x*[.2126,.7152,.0722][i],0);
                return [...document.querySelectorAll('.ai-provider-card-name,.ai-provider-card-meta,.ai-provider-card button,.ai-instruction-proposal-heading,.ai-instruction-proposal-label,.ai-instruction-proposal-explanation,.ai-instruction-proposal-text,.ai-instruction-proposal-editor,.ai-instruction-proposal button')].map(el => {
                    const ancestors = []; for (let n=el;n;n=n.parentElement) ancestors.unshift(n);
                    const bg = ancestors.reduce((b,n) => blend(rgba(getComputedStyle(n).backgroundColor),b),[255,255,255,1]);
                    const fg = blend(rgba(getComputedStyle(el).color),bg);
                    const contrast = (Math.max(luminance(fg),luminance(bg))+.05)/(Math.min(luminance(fg),luminance(bg))+.05);
                    return {className:el.className,contrast};
                });
            });
            if (samples.length < 12) throw Error('Populated renderer was not exercised');
            results.push({choice,samples,issues:samples.filter(s => s.contrast < 4.5)});
        }
        const inert = await p.evaluate(() => !window.syntheticExecuted && !document.querySelector('.ai-provider-card img,.ai-instruction-proposal img,.ai-msg-assistant img'));
        if (!inert || errors.length || writes.length) throw Error(JSON.stringify({inert,errors,writes}));
        return {results,errors,writes,inert,fakes:['catalog','conversation detail and instruction proposals'],real:'Provider POST/GET/DELETE via daemon; no activation/test/inference'};
    } finally {
        if (provider) await context.request.delete(`${baseURL}/api/ai/providers/${provider.id}`);
        await context.close();
    }
};

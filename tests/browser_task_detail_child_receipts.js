/* Bounded native receipt continuation. Real ACKs/rows; only tree faults and ACK delivery are faked. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext({viewport:{width:1024,height:1000}}),p=await context.newPage();
    const results=[],errors=[],writes=[],rows=[],mutationReceipts=[];
    const check=(ok,label)=>{if(!ok)throw Error(label);results.push(label);};
    const get=async path=>{const r=await context.request.get(baseURL+path);if(!r.ok())throw Error(`GET ${path}: ${r.status()}`);return r.json();};
    const response=await context.request.post(baseURL+'/api/tasks',{data:{title:`05-null-receipts-${Date.now()}`,category:'',tags:'#saved-parent'}});
    if(response.status()!==201)throw Error(`Fixture POST: ${response.status()}`);
    const fixtureReceipt={method:'POST',path:'/api/tasks',status:response.status(),rawResponse:await response.text()};
    const parent=JSON.parse(fixtureReceipt.rawResponse);
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(r.url().startsWith(baseURL)&&['POST','PUT'].includes(r.method()))writes.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postDataJSON()});});
    try {
        await p.goto(`${baseURL}/task-inspector/${parent.id}`);
        await p.waitForFunction(()=>document.getElementById('task_properties_editor').disabled===false);
        for(const [requestedEstimate,input,createEstimate] of [[0,'0m',0],[null,'-',15],[-60,'-60m',-60]]) {
            let release,observed;const held=new Promise(r=>release=r),seen=new Promise(r=>observed=r);
            await context.route('**/api/tasks',async route=>{
                if(route.request().method()!=='POST')return route.continue();
                const ack=await route.fetch();
                mutationReceipts.push({method:'POST',path:'/api/tasks',request:route.request().postDataJSON(),status:ack.status(),rawResponse:await ack.text()});
                observed();await held;await route.fulfill({response:ack});
            });
            await context.route(`**/api/tasks/${parent.id}/tree`,route=>route.fulfill({status:503,json:{detail:'Synthetic unavailable display tree'}}));
            await p.getByRole('button',{name:'+ Add Subtask',exact:true}).click();
            await p.locator('#modal_subtask_title').fill(`Receipt ${requestedEstimate}`);
            await p.locator('#modal_subtask_est').fill(input);
            const before=writes.length;
            await p.locator('#modal_subtask_title').press('Control+Enter');await seen;
            check(await p.locator('#subtask_save_btn').isDisabled(),'Pending child Save is visibly disabled');
            await p.locator('#modal_subtask_title').fill(`Concurrent ${requestedEstimate}`);
            await p.locator('#modal_subtask_title').press('Control+Enter');
            release();
            await p.waitForFunction(()=>!!document.getElementById('edit_subtask_id').value);
            await p.locator('#subtask_save_btn:enabled').waitFor({state:'visible'});
            const childId=await p.locator('#edit_subtask_id').inputValue();
            const createReceipt=mutationReceipts[mutationReceipts.length-1],createAck=JSON.parse(createReceipt.rawResponse);
            const created=await get(`/api/tasks/${childId}`);rows.push({phase:'create-readback',row:created});
            check(createReceipt.status===201&&createAck.id===childId&&createAck.estimated_minutes===createEstimate&&created.estimated_minutes===createEstimate&&createAck.category===''&&created.category===''&&createAck.parent_id===parent.id&&created.parent_id===parent.id,'Raw CREATE ACK and GET preserve zero/negative or canonical null-request default15, empty category and captured parent');
            check(createReceipt.request.estimated_minutes===requestedEstimate,'CREATE request retains the exact requested estimate, including explicit null');
            check(await p.locator('#modal_subtask_est').inputValue()===(createEstimate===-60?'-60m':createEstimate===15?'15m':'-'),'Canonical CREATE estimate representation is adopted without inventing null storage');
            check(await p.locator('#modal_subtask_title').inputValue()===`Concurrent ${requestedEstimate}`&&await p.evaluate(()=>hasSettingsDrafts(['subtask_modal'])),'Concurrent child title remains dirty against canonical detached receipt');
            const retry=p.waitForResponse(r=>r.url().endsWith(`/api/tasks/${parent.id}/tree`)&&r.status()===503);
            await p.locator('#subtask_modal').getByRole('button',{name:'Retry refresh',exact:true}).click();await retry;
            check(writes.slice(before).filter(w=>w.path.startsWith('/api/tasks')).length===1,'Failed-tree Retry is read-only and pending activation created no duplicate');
            await context.unroute('**/api/tasks');

            let finalTitle=`Concurrent ${requestedEstimate}`;
            if(requestedEstimate===null) {
                let releaseNull,observedNull;const heldNull=new Promise(r=>releaseNull=r),seenNull=new Promise(r=>observedNull=r);
                await context.route(`**/api/tasks/${childId}`,async route=>{
                    if(route.request().method()!=='PUT')return route.continue();
                    const ack=await route.fetch();
                    mutationReceipts.push({method:'PUT',path:`/api/tasks/${childId}`,request:route.request().postDataJSON(),status:ack.status(),rawResponse:await ack.text()});
                    observedNull();await heldNull;await route.fulfill({response:ack});
                });
                // Establish genuine NULL through this same reachable private child editor, not CREATE.
                await p.locator('#modal_subtask_est').fill('-');
                await p.locator('#modal_subtask_title').press('Control+Enter');await seenNull;
                check(await p.locator('#subtask_save_btn').isDisabled(),'Explicit NULL PUT visibly pending');
                finalTitle='Concurrent genuine null';
                await p.locator('#modal_subtask_title').fill(finalTitle);
                await p.locator('#modal_subtask_title').press('Control+Enter');
                releaseNull();
                await p.locator('#subtask_save_btn:enabled').waitFor({state:'visible'});
                const nullReceipt=mutationReceipts[mutationReceipts.length-1],nullAck=JSON.parse(nullReceipt.rawResponse);
                const nullRow=await get(`/api/tasks/${childId}`);rows.push({phase:'genuine-null-readback',row:nullRow});
                check(nullReceipt.status===200&&nullReceipt.request.estimated_minutes===null&&nullAck.id===childId&&nullAck.estimated_minutes===null&&nullRow.estimated_minutes===null&&nullAck.category===''&&nullRow.category===''&&nullAck.parent_id===parent.id&&nullRow.parent_id===parent.id,'Real explicit PUT ACK and GET establish genuine NULL with exact canonical ID/category/parent');
                check(await p.locator('#modal_subtask_est').inputValue()==='-'&&await p.locator('#modal_subtask_title').inputValue()===finalTitle&&await p.evaluate(()=>hasSettingsDrafts(['subtask_modal'])),'Genuine NULL receipt keeps concurrent title dirty and unchanged estimate sentinel');
                const nullRetry=p.waitForResponse(r=>r.url().endsWith(`/api/tasks/${parent.id}/tree`)&&r.status()===503);
                await p.locator('#subtask_modal').getByRole('button',{name:'Retry refresh',exact:true}).click();await nullRetry;
                check(writes.slice(before).filter(w=>w.path.startsWith('/api/tasks')).length===2,'Genuine NULL failed-tree Retry performs zero mutations; pending PUT activation was suppressed');
                await context.unroute(`**/api/tasks/${childId}`);
            }
            const finalResponse=p.waitForResponse(r=>r.url()===`${baseURL}/api/tasks/${childId}`&&r.request().method()==='PUT');
            await p.locator('#modal_subtask_title').press('Control+Enter');
            const finalAckResponse=await finalResponse;
            const finalReceipt={method:'PUT',path:`/api/tasks/${childId}`,request:finalAckResponse.request().postDataJSON(),status:finalAckResponse.status(),rawResponse:await finalAckResponse.text()};
            mutationReceipts.push(finalReceipt);
            await p.waitForFunction(()=>document.getElementById('subtask_modal').classList.contains('hidden'));
            const finalAck=JSON.parse(finalReceipt.rawResponse),saved=await get(`/api/tasks/${childId}`);rows.push({phase:'final-readback',row:saved});
            check(finalReceipt.status===200&&finalReceipt.request.estimated_minutes===requestedEstimate&&finalAck.id===childId&&finalAck.estimated_minutes===requestedEstimate&&saved.title===finalTitle&&saved.estimated_minutes===requestedEstimate&&saved.category===''&&saved.parent_id===parent.id,'Later explicit canonical-ID PUT ACK and GET preserve acknowledged zero/negative/genuine NULL despite missing child tree');
            const mutations=writes.slice(before).filter(w=>w.path.startsWith('/api/tasks')),expectedCount=requestedEstimate===null?3:2;
            check(mutations.length===expectedCount&&mutations[0].method==='POST'&&mutations.slice(1).every(w=>w.method==='PUT'&&w.path===`/api/tasks/${childId}`),'Exactly one CREATE plus explicit user UPDATE(s), never a replayed CREATE');
            await context.unroute(`**/api/tasks/${parent.id}/tree`);
            const recovered=p.waitForResponse(r=>r.url().endsWith(`/api/tasks/${parent.id}/tree`)&&r.status()===200);
            await p.getByRole('main').getByRole('button',{name:'Retry refresh',exact:true}).click();await recovered;
            await p.locator('#subtasks_tree_container').getByRole('link',{name:finalTitle,exact:true}).waitFor();
            check(writes.slice(before).filter(w=>w.path.startsWith('/api/tasks')).length===expectedCount,'Successful recovery Retry also performs zero mutations');
        }
        check(errors.length===0,'No unexpected pageerrors');
        return {assertions:results.length,results,errors,writes,rows,fixtureReceipt,mutationReceipts,counts:{fixtureCreates:1,userCreates:3,userUpdates:4},fakes:['provider catalog','held real POST/PUT ACK delivery','tree GET503'],limits:['No native RED claimed; prior Node real-utils RED remains historical','CREATE null defaults15; genuine NULL established only by real user PUT','No physical touch/other engines/screen reader']};
    } catch(error) {console.log(JSON.stringify({partialResults:results,errors,writes,rows,fixtureReceipt,mutationReceipts}));throw error;}
    finally {await context.close();}
}

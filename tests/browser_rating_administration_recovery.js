/* Authored for the current post-15 candidate; unrun until the parent native guard. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const origin = new URL(baseURL).origin;
    await context.addInitScript(({origin}) => {
        if (location.protocol !== 'http:' || location.origin !== origin) return;
        localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false, enableVimMotions:false}));
    }, {origin});
    const p = await context.newPage(), requests = [], readbacks = [], errors = [];
    p.on('pageerror', error => errors.push(error.message));
    const check = (value, message) => {if (!value) throw Error(message);};
    const gate = () => {let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve};};
    const list = async () => (await p.request.get(baseURL + '/rating-definitions')).json();
    let hold = null, received = null, failRead = false, rejectWrite = false, holdInitial = null, initialReceived = null;
    await context.route('**/rating-definitions{,/*}', async route => {
        const request = route.request(), method = request.method();
        requests.push({method, url:new URL(request.url()).pathname, body:request.postDataJSON()});
        if (method === 'GET') {
            if (failRead) return route.fulfill({status:503,json:{detail:'Synthetic refresh failure'}});
            if (holdInitial) {
                const pending = holdInitial; holdInitial = null;
                const response = await route.fetch(); initialReceived.resolve();
                await pending.promise; return route.fulfill({response});
            }
            return route.continue();
        }
        if (rejectWrite) return route.fulfill({status:400,json:{detail:'Synthetic rejected write'}});
        if (hold) {
            const pending = hold; hold = null;
            const response = await route.fetch(); received.resolve();
            await pending.promise; return route.fulfill({response});
        }
        return route.continue();
    });
    const synthetic = 'Rating18 native recovery';
    try {
        await p.goto(baseURL + '/revision#ratings');
        await p.waitForFunction(() => document.getElementById('rating_defs_card_list').getAttribute('aria-busy') === 'false');
        hold = gate(); received = gate(); const ack = hold;
        await p.locator('#rating_defs_new_btn').click();
        await p.locator('#modal_rating_name').fill(synthetic);
        await p.locator('#modal_rating_save_btn').click(); await received.promise;
        const submitted = (await list()).find(d => d.name === synthetic); check(submitted, 'Native POST did not reach actual DB');
        readbacks.push({phase:'server committed before held ACK', row:submitted});
        await p.locator('#modal_rating_name').fill(synthetic + ' concurrent');
        await p.locator('#modal_rating_target_type').selectOption('day');
        await p.locator('#modal_rating_min').fill('-10'); await p.locator('#modal_rating_max').fill('0');
        await p.keyboard.press('Control+Enter');
        check(requests.filter(r => r.method === 'POST').length === 1, 'Pending Save duplicated POST');
        check(await p.locator('#modal_rating_save_btn').isDisabled(), 'Pending Save not guarded');
        failRead = true; ack.resolve();
        await p.locator('#rating_def_status').filter({hasText:'Newer edits remain unsaved'}).waitFor();
        await p.locator('#rating_defs_retry_btn').waitFor({state:'visible'});
        check(await p.locator('#edit_rating_def_id').inputValue() === submitted.id, 'ACK did not adopt definition ID');
        check(await p.locator('#modal_rating_name').inputValue() === synthetic + ' concurrent', 'ACK erased concurrent name');
        check(await p.locator('#modal_rating_target_type').inputValue() === 'day', 'ACK erased concurrent context');
        check(await p.evaluate(() => hasSettingsDrafts(['rating_def_modal'])), 'Concurrent edits incorrectly checkpointed');
        failRead = false; await p.locator('#rating_def_refresh_btn').click();
        await p.locator('#rating_def_refresh_btn').waitFor({state:'hidden'});
        check(requests.filter(r => r.method === 'POST').length === 1, 'Read retry replayed POST');
        check((await list()).find(d => d.id === submitted.id).name === synthetic, 'Read retry saved newer draft');
        await p.locator('#modal_rating_save_btn').click();
        await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        const updated = (await list()).find(d => d.id === submitted.id); readbacks.push({phase:'explicit concurrent Save',row:updated});
        check(updated.name.endsWith(' concurrent') && updated.target_type === 'day' && updated.max_score === 0, 'Explicit second Save lost concurrent fields');
        // A different editor opened before ACK owns its fields and draft baseline.
        await p.getByRole('button', {name:new RegExp(synthetic + ' concurrent')}).click();
        await p.locator('#modal_rating_desc').fill('Old owner submitted');
        hold = gate(); received = gate(); const oldAck = hold;
        await p.locator('#modal_rating_save_btn').click(); await received.promise;
        await p.getByRole('button', {name:/^Cancel/}).click();
        await p.locator('#rating_defs_new_btn').click(); await p.locator('#modal_rating_name').fill('New owner unsaved');
        oldAck.resolve();
        await p.waitForFunction(() => document.getElementById('rating_defs_status').textContent.includes('saved'));
        check(await p.locator('#edit_rating_def_id').inputValue() === '', 'Old ACK adopted its ID into new editor');
        check(await p.locator('#modal_rating_name').inputValue() === 'New owner unsaved', 'Old ACK overwrote new editor');
        check(await p.evaluate(() => hasSettingsDrafts(['rating_def_modal'])), 'Old ACK checkpointed new editor');
        check(await p.locator('#rating_def_status').textContent() === '', 'Old ACK changed new editor status');
        rejectWrite = true;
        await p.locator('#modal_rating_save_btn').click();
        await p.locator('#rating_def_status').filter({hasText:'Save was not confirmed'}).waitFor();
        check(await p.locator('#modal_rating_name').inputValue() === 'New owner unsaved', 'Rejected write erased draft');
        check(!await p.locator('#modal_rating_save_btn').isDisabled(), 'Rejected Save remained locked');
        check(!(await list()).some(d => d.name === 'New owner unsaved'), 'Rejected fixture unexpectedly wrote');
        rejectWrite = false; await p.keyboard.press('Escape');
        // A late initial GET with a pre-write snapshot cannot erase the acknowledged list.
        holdInitial = gate(); initialReceived = gate(); const oldList = holdInitial;
        await p.reload(); await initialReceived.promise;
        await p.locator('#rating_defs_new_btn').click(); await p.locator('#modal_rating_name').fill(synthetic + ' generation');
        await p.locator('#modal_rating_save_btn').click();
        await p.getByRole('button', {name:new RegExp(synthetic + ' generation')}).waitFor();
        oldList.resolve();
        await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        check(await p.getByRole('button', {name:new RegExp(synthetic + ' generation')}).count() === 1, 'Late initial GET erased saved list');
        check(errors.length === 0, 'Unexpected page errors: ' + errors.join('; '));
        return {requests,readbacks,errors,passed:['native held POST/PUT ACK','pending duplicate suppression','concurrent context/bounds drafts','ACK then failed refresh','read-only retry','new-editor ownership','rejected write retains draft','late initial list generation'],fakes:['503 list read','400 rejected write','held responses after actual daemon writes']};
    } finally {
        hold?.resolve(); holdInitial?.resolve();
        for (const row of await list()) if (row.name.startsWith(synthetic)) await p.request.delete(`${baseURL}/rating-definitions/${row.id}`);
        await context.close();
    }
}

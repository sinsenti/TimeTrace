/* Clear-only focus lifecycle. Real rows; explicit rejected write/held or failed GET boundaries. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/providers/catalog', r => r.fulfill({json:{}}));
    const p = await context.newPage(), checks = [], errors = [], writes = [], ids = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (r.method() !== 'GET') writes.push({url:r.url(), method:r.method(), body:r.postDataJSON()}); });
    const assert = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
    const focused = locator => locator.evaluate(el => el === document.activeElement && !el.disabled && el.isConnected);
    const settle = () => p.waitForFunction(() => ![...habitEntryDrafts.values()].some(d => d.pending));
    let a, b, date, card, clear, amount;
    const record = async () => (await (await context.request.get(`${baseURL}/habits/${a.id}/stats`)).json()).history.find(l => l.date === date);
    const seed = async () => {
        await context.request.post(`${baseURL}/habits/${a.id}/log`, {data:{date_str:date, set_value:0}});
        await p.goto(`${baseURL}/habits-view`); await clear.waitFor();
    };
    const launch = async () => { await clear.focus(); await p.keyboard.press('Enter'); await p.locator('#custom_confirm_modal').waitFor({state:'visible'}); };
    try {
        a = await (await context.request.post(`${baseURL}/habits`, {data:{name:'Clear focus numeric',habit_type:'numeric',target_value:0}})).json(); ids.push(a.id);
        b = await (await context.request.post(`${baseURL}/habits`, {data:{name:'Clear focus other'}})).json(); ids.push(b.id);
        await p.goto(`${baseURL}/habits-view`);
        card = p.locator(`[data-habit-id="${a.id}"]`); await card.waitFor();
        date = await card.locator('time').getAttribute('datetime');
        clear = card.getByRole('button', {name:'Clear',exact:true}); amount = card.getByRole('spinbutton');
        await context.request.post(`${baseURL}/habits/${b.id}/log`, {data:{date_str:date,status:'completed'}});
        await seed();
        let count = writes.length;
        await launch(); await p.keyboard.press('Escape'); await settle();
        assert(await focused(clear), 'keyboard Clear → Escape restores live enabled Clear after pending clears');
        assert(writes.length === count && (await record()).status === 'pending', 'Escape sends no erase and retains recorded zero Pending');

        const cancel = p.locator('#confirm_modal_cancel_btn'), proceed = p.locator('#confirm_modal_proceed_btn');
        await launch(); assert(await focused(cancel), 'Clear confirmation initially focuses Cancel');
        await p.keyboard.press('Shift+Tab'); assert(await focused(proceed), 'Shift+Tab wraps Cancel to Proceed');
        await p.keyboard.press('Tab'); assert(await focused(cancel), 'Tab wraps Proceed to Cancel');
        await p.keyboard.press('Tab'); assert(await focused(proceed), 'Tab reaches Proceed');
        await p.keyboard.press('Tab'); await p.keyboard.press('Enter'); await settle();
        assert(await focused(clear) && writes.length === count, 'Cancel Enter cancels, never generic-helper Proceed');
        await launch(); await p.keyboard.press('Space'); await settle();
        assert(await focused(clear) && writes.length === count, 'Cancel Space cancels without erase');
        await launch(); await cancel.click(); await settle();
        assert(await focused(clear) && writes.length === count, 'mouse Cancel restores live Clear without erase');

        await launch(); await p.keyboard.press('Tab'); await p.keyboard.press('Enter'); await settle();
        assert(await clear.isDisabled() && await focused(amount), 'accepted erase disables Clear and focuses reachable same-card Amount');
        assert(!(await record()) && writes.length === count + 1, 'accepted keyboard Proceed erases exactly selected date once');
        const other = (await (await context.request.get(`${baseURL}/habits/${b.id}/stats`)).json()).history;
        assert(other.some(l => l.date === date && l.status === 'completed'), 'other habit record retained');

        await seed(); await amount.fill('7'); count = writes.length;
        await context.route(`**/habits/${a.id}/log`, r => r.fulfill({status:503,json:{detail:'Synthetic rejected Clear'}}));
        await launch(); await proceed.click(); await settle(); await context.unroute(`**/habits/${a.id}/log`);
        assert(await focused(clear) && await amount.inputValue() === '7', 'rejected erase restores Clear and retains concurrent draft');
        assert((await record()).value === 0 && writes.length === count + 1, 'rejected erase keeps persisted zero without replay');
        assert((await card.locator('[role="status"]').textContent()).includes('not acknowledged'), 'rejected erase visibly distinguished from ACK');

        await seed(); count = writes.length;
        await context.route('**/habits', r => r.fulfill({status:503,json:{detail:'Synthetic ACK refresh failure'}}));
        await launch(); await proceed.click(); await settle();
        assert(await focused(amount) && await clear.isDisabled(), 'ACK + GET failure uses enabled same-card fallback');
        assert(!(await record()) && await p.evaluate(({id,date}) => habitLogReceipts.get(habitEntryKey(id,date)) === null && !habitEntryDraft(id,date).pending, {id:a.id,date}), 'ACK receipt and pending cleanup delivered despite failed GET');
        await context.unroute('**/habits'); await p.locator('#habit_retry_load').click(); await p.locator('#habit_retry_load').waitFor({state:'hidden'});
        assert(writes.length === count + 1 && !(await record()), 'Retry refresh reads only; successful erase never repeated');

        // A new Definition owner during the real post-ACK read must retain focus and its draft.
        await seed(); count = writes.length;
        let release, entered;
        const held = new Promise(r => release = r), started = new Promise(r => entered = r);
        await context.route('**/habits', async r => { entered(); await held; await r.continue(); });
        await launch(); await proceed.click(); await started;
        await p.getByRole('button', {name:'+ New Habit',exact:true}).click();
        await p.locator('#modal_habit_name').fill('New definition draft owns focus');
        release(); await settle(); await context.unroute('**/habits');
        assert(await focused(p.locator('#modal_habit_name')) && await p.locator('#modal_habit_name').inputValue() === 'New definition draft owns focus', 'late Clear refresh never steals new Definition focus/draft');
        assert(!(await record()) && writes.length === count + 1 && await p.evaluate(({id,date}) => habitLogReceipts.get(habitEntryKey(id,date)) === null && !habitEntryDraft(id,date).pending, {id:a.id,date}), 'new owner does not skip ACK receipt or pending cleanup');
        await p.locator('#modal_habit_name').press('Escape');

        await seed(); count = writes.length; await launch();
        await p.evaluate(() => openNewHabitModal()); await settle();
        assert(await focused(p.locator('#modal_habit_name')) && !(await p.locator('#custom_confirm_modal').isVisible()), 'new Definition focus cancels old Clear confirmation and releases its listeners');
        assert(writes.length === count && (await record()).value === 0, 'new pre-confirmation owner sends zero erase');
        await p.locator('#modal_habit_name').press('Escape');

        // Public caller transition while confirmation is open: stale date cannot erase or steal.
        await seed(); count = writes.length; await launch();
        await p.evaluate(id => selectHabitDay(id, '2020-01-01'), a.id);
        await proceed.click(); await settle();
        assert(writes.length === count && (await record()).value === 0, 'changed-date stale confirmation sends zero erase');
        assert(await card.locator('time').getAttribute('datetime') === '2020-01-01' && !(await focused(clear)), 'stale confirmation does not restore old-date Clear');

        // Moving to another real input while a read is held revokes optional restoration.
        await seed();
        let releaseOther, enteredOther;
        const heldOther = new Promise(r => releaseOther = r), startedOther = new Promise(r => enteredOther = r);
        await context.route('**/habits', async r => { enteredOther(); await heldOther; await r.continue(); });
        await launch(); await proceed.click(); await startedOther;
        const otherDone = p.locator(`[data-habit-id="${b.id}"]`).getByRole('button', {name:'Done',exact:true});
        await otherDone.focus(); releaseOther(); await settle(); await context.unroute('**/habits');
        assert(await focused(otherDone), 'late Clear does not steal another habit control focus');
        assert(!(await record()), 'other focused owner does not suppress acknowledged erase');

        // A second Clear can own the reused confirmation while the first ACK read is pending.
        await seed();
        let releaseFirst, enteredFirst;
        const heldFirst = new Promise(r => releaseFirst = r), startedFirst = new Promise(r => enteredFirst = r);
        await context.route('**/habits', async r => { enteredFirst(); await heldFirst; await r.continue(); });
        await launch(); await proceed.click(); await startedFirst;
        const otherCard = p.locator(`[data-habit-id="${b.id}"]`), otherClear = otherCard.getByRole('button', {name:'Clear',exact:true});
        await otherClear.focus(); await p.keyboard.press('Enter'); await cancel.waitFor({state:'visible'});
        releaseFirst(); await p.waitForFunction(({id,date}) => !habitEntryDraft(id,date).pending, {id:a.id,date});
        await context.unroute('**/habits');
        assert(await focused(cancel), 'older pending Clear never steals newer Clear confirmation focus');
        const beforeCancel = writes.length;
        await p.keyboard.press('Enter'); await settle();
        assert(await focused(otherClear) && writes.length === beforeCancel, 'newer Clear Cancel Enter stays cancellation after older cleanup');
        assert(!(await record()) && (await (await context.request.get(`${baseURL}/habits/${b.id}/stats`)).json()).history.length === 1, 'both pending owners clean up with only first acknowledged erase');
        await otherClear.click(); await proceed.click(); await settle();
        assert(await otherClear.isDisabled() && await focused(otherCard.getByRole('button', {name:'Edit definition',exact:true})), 'boolean erased record restores enabled same-card fallback');
        assert(errors.length === 0, 'no Clear focus pageerrors');
        return {checks, errors, writes, fakes:['provider catalog','one rejected Clear POST','one failed post-ACK list GET','three held real post-ACK list GETs'], limits:['changed-date uses public caller; no forced/background clicks','Chromium only; no physical touch/screenreader certification']};
    } finally { for (const id of ids) await context.request.delete(`${baseURL}/habits/${id}`); await context.close(); }
};

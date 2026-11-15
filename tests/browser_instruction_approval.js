'use strict';

const assert = require('node:assert/strict');

function isSettingsTimerReady(state = null) {
    if (!state) {
        const notice = document.querySelector('#timer_recovery_notice');
        state = {
            statusFresh: typeof timerStatusFresh !== 'undefined' && timerStatusFresh === true,
            statusData: typeof lastTimerData !== 'undefined' ? lastTimerData : null,
            recoveryNoticeHidden: Boolean(notice && notice.classList.contains('hidden')),
        };
    }
    return state.statusFresh === true
        && state.statusData?.is_running === false
        && state.statusData?.is_frozen_idle === false
        && state.statusData?.pending_idle_gap == null
        && state.recoveryNoticeHidden === true;
}

function verifySettingsTimerReadinessControl() {
    let recoveryNoticeVisible = false;
    const settingsDom = {
        querySelector(selector) {
            if (selector === '#timer_status_label') return null;
            if (selector === '#timer_recovery_notice') {
                return {classList: {contains: name => name === 'hidden' && !recoveryNoticeVisible}};
            }
            return null;
        },
    };
    assert.equal(settingsDom.querySelector('#timer_status_label'), null, 'Settings-shaped fixture has no dashboard timer label');
    const idleData = {is_running: false, is_frozen_idle: false, pending_idle_gap: null};
    const readyState = {
        statusFresh: true,
        statusData: idleData,
        recoveryNoticeHidden: settingsDom.querySelector('#timer_recovery_notice').classList.contains('hidden'),
    };
    assert.equal(isSettingsTimerReady(readyState), true, 'fresh idle status with no recovery notice is ready without a dashboard label');
    recoveryNoticeVisible = true;
    assert.equal(isSettingsTimerReady({...readyState, recoveryNoticeHidden: false}), false, 'visible recovery notice blocks the workflow');
    assert.equal(isSettingsTimerReady({...readyState, statusFresh: false, recoveryNoticeHidden: true}), false, 'stale status blocks even when no recovery notice is visible');
    assert.equal(isSettingsTimerReady({...readyState, statusFresh: false, recoveryNoticeHidden: false}), false, 'failed or stale status with a visible recovery notice blocks the workflow');
    return {settingsShapeHasTimerLabel: false, readyIdleStateAccepted: true, visibleRecoveryNoticeBlocked: true, staleStatusWithoutNoticeBlocked: true, staleStatusWithNoticeBlocked: true};
}

module.exports = async function browserInstructionApproval({page, baseURL, fixture, ledger, faults}) {
    const response = await page.goto(`${baseURL}/settings/ai`);
    assert.equal(response.status(), 200, 'real AI Settings route loads from the scratch daemon');
    await page.waitForFunction(() => typeof aiBehaviorReady !== 'undefined' && aiBehaviorReady);
    await page.waitForFunction(isSettingsTimerReady, null, {timeout: 10000});
    const timerReadState = await page.evaluate(() => {
        const notice = document.querySelector('#timer_recovery_notice');
        return {
            statusFresh: typeof timerStatusFresh !== 'undefined' && timerStatusFresh === true,
            statusData: typeof lastTimerData !== 'undefined' ? lastTimerData : null,
            recoveryNoticeHidden: Boolean(notice && notice.classList.contains('hidden')),
            timerStatusLabelPresent: Boolean(document.querySelector('#timer_status_label')),
        };
    });
    assert.equal(timerReadState.timerStatusLabelPresent, false, 'AI Settings does not render the dashboard timer label');
    assert.equal(isSettingsTimerReady(timerReadState), true, 'a fresh idle timer read and absent recovery notice unblock proposal actions');
    await page.locator('#ai_setting_custom_instructions').fill('Unsaved local instruction draft');
    await page.locator('#ai_setting_scheduling_window_days').fill('21');

    await page.locator('#ai_launcher_btn').click();
    await page.locator('#ai_history_toggle_btn').click();
    await page.locator('#ai_conversation_select').waitFor();
    await page.locator('#ai_conversation_select').selectOption(fixture.conversationId);
    await page.locator('#ai_history_toggle_btn').click();

    const cardFor = id => page.locator(`.ai-instruction-proposal[data-proposal-id="${id}"]`);
    const measureProposalCard = card => card.evaluate(element => {
        const describe = node => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            return {
                id: node.id || null,
                className: typeof node.className === 'string' ? node.className : null,
                width: box.width,
                height: box.height,
                clientWidth: node.clientWidth,
                scrollWidth: node.scrollWidth,
                display: style.display,
                visibility: style.visibility,
                overflowX: style.overflowX,
                overflowWrap: style.overflowWrap,
                whiteSpace: style.whiteSpace,
                minWidth: style.minWidth,
                maxWidth: style.maxWidth,
                boxSizing: style.boxSizing,
            };
        };
        const ancestors = [];
        for (let node = element, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) ancestors.push(describe(node));
        const text = element.querySelector('.ai-instruction-proposal-text');
        const editor = element.querySelector('.ai-instruction-proposal-editor');
        const animations = element.getAnimations({subtree: true}).map(animation => ({
            playState: animation.playState,
            currentTime: Number.isFinite(animation.currentTime) ? animation.currentTime : null,
            target: animation.effect?.target?.id || animation.effect?.target?.className || null,
        }));
        return {connected: element.isConnected, card: describe(element), text: text ? describe(text) : null, editor: editor ? describe(editor) : null, ancestors, animations};
    });
    await cardFor(fixture.saveProposalId).waitFor();
    const saveCard = cardFor(fixture.saveProposalId);
    const literal = '<script>window.__ticket23Injected=true</script>';
    assert.equal(await saveCard.locator('script, img').count(), 0, 'proposal text is inert DOM text');
    assert.ok((await saveCard.textContent()).includes(literal), 'literal markup is visible as text');
    await saveCard.locator('textarea').fill(fixture.acceptedInstruction);
    faults.failNextStatus = true;
    const save = saveCard.getByRole('button', {name: 'Save to custom instructions', exact: true});
    await save.click();
    await page.waitForFunction(id => {
        const card = document.querySelector(`.ai-instruction-proposal[data-proposal-id="${id}"]`);
        return card?.textContent.includes('Retry reads only');
    }, fixture.saveProposalId);
    assert.match(await saveCard.textContent(), /Saved to custom instructions/);
    assert.equal(await saveCard.getByRole('button', {name: 'Save to custom instructions', exact: true}).count(), 0);

    const canonicalAfterSave = await page.evaluate(async () => (await (await fetch('/api/ai/settings')).json()).custom_instructions);
    assert.equal(canonicalAfterSave, `${literal}\n\n${fixture.acceptedInstruction}`);
    assert.equal(await page.locator('#ai_setting_custom_instructions').inputValue(), 'Unsaved local instruction draft');
    assert.equal(await page.locator('#ai_setting_scheduling_window_days').inputValue(), '21');
    assert.equal(await page.evaluate(() => hasSettingsDrafts(['ai_behavior_settings'])), true);

    await saveCard.getByRole('button', {name: 'Retry status refresh', exact: true}).click();
    await page.waitForFunction(id => document.querySelector(`.ai-instruction-proposal[data-proposal-id="${id}"] .ai-instruction-proposal-status`)?.textContent === 'Status refreshed.', fixture.saveProposalId);
    assert.equal(ledger.mutations.filter(entry => entry.path.endsWith('/accept')).length, 1, 'refresh retry did not replay Save');
    assert.equal(faults.statusFailures, 1);

    const dismissCard = cardFor(fixture.dismissProposalId);
    await dismissCard.waitFor();
    await dismissCard.getByRole('button', {name: 'Dismiss', exact: true}).click();
    await page.waitForFunction(id => document.querySelector(`.ai-instruction-proposal[data-proposal-id="${id}"]`)?.textContent.includes('Dismissed; custom instructions were not changed'), fixture.dismissProposalId);
    assert.equal(await page.evaluate(async () => (await (await fetch('/api/ai/settings')).json()).custom_instructions), canonicalAfterSave);

    const conflictCardBefore = cardFor(fixture.conflictProposalId);
    await conflictCardBefore.locator('textarea').fill(fixture.conflictInstruction);
    faults.failNextSettingsRead = true;
    await conflictCardBefore.getByRole('button', {name: 'Save to custom instructions', exact: true}).click();
    await page.waitForFunction(id => document.querySelector(`.ai-instruction-proposal[data-proposal-id="${id}"] .ai-instruction-proposal-status`)?.textContent.includes('could not be loaded'), fixture.conflictProposalId);
    const conflictCard = cardFor(fixture.conflictProposalId);
    const conflictInput = conflictCard.locator('textarea');
    assert.equal(await conflictInput.inputValue(), fixture.conflictInstruction);
    assert.equal(await conflictInput.isDisabled(), false);
    assert.ok(await conflictInput.getAttribute('readonly') !== null, 'terminal conflict remains selectable/copyable and read-only');
    assert.equal(await conflictCard.getByRole('button', {name: 'Save to custom instructions', exact: true}).count(), 0);
    assert.equal(await conflictCard.getByRole('link', {name: 'Open AI settings', exact: true}).getAttribute('href'), '/settings/ai');
    await conflictCard.getByRole('button', {name: 'Retry Settings read', exact: true}).click();
    await page.waitForFunction(id => document.querySelector(`.ai-instruction-proposal[data-proposal-id="${id}"]`)?.textContent.includes('Current Settings were loaded'), fixture.conflictProposalId);
    assert.equal(ledger.mutations.filter(entry => entry.path.endsWith('/accept')).length, 2, 'conflict read did not replay either acceptance');

    await page.locator('#ai_drafts_toggle_btn').click();
    const hiddenProposalMetrics = {
        saved: await measureProposalCard(saveCard),
        longConflict: await measureProposalCard(conflictCard),
    };
    const batch = page.locator(`#ai_batches_list [data-batch-id="${fixture.taskBatchId}"]`);
    await batch.waitFor();
    await batch.getByRole('button', {name: 'Accept', exact: true}).click();
    await batch.getByRole('button', {name: 'Undo', exact: true}).waitFor();
    await batch.getByRole('button', {name: 'Undo', exact: true}).click();
    await batch.getByRole('button', {name: 'Reapply', exact: true}).waitFor();
    await batch.getByRole('button', {name: 'Reapply', exact: true}).click();
    await batch.getByRole('button', {name: 'Undo', exact: true}).waitFor();
    const tasks = await page.evaluate(async () => (await (await fetch('/api/tasks?status=all')).json()));
    assert.ok(tasks.some(task => task.title === fixture.taskTitle), 'separate domain proposal remains a real task after reapply');
    const status = await page.evaluate(async id => (await (await fetch(`/api/ai/instruction-proposals/${id}`)).json()).status, fixture.dismissProposalId);
    assert.equal(status, 'rejected', 'domain approval does not alter instruction state');
    const conflictStatus = await page.evaluate(async id => (await (await fetch(`/api/ai/instruction-proposals/${id}`)).json()).status, fixture.conflictProposalId);
    assert.equal(conflictStatus, 'conflict');

    await page.locator('#ai_drafts_toggle_btn').click();
    await page.locator('#ai_drawer_body').waitFor({state: 'visible'});
    await conflictCard.waitFor({state: 'visible'});
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const narrow = await measureProposalCard(conflictCard);
    assert.ok(narrow.card.width > 0
        && narrow.card.scrollWidth <= narrow.card.clientWidth + 1
        && narrow.editor?.scrollWidth <= narrow.editor?.clientWidth + 1,
    `visible long conflict instruction does not overflow the narrow card/editor: ${JSON.stringify({hiddenProposalMetrics, narrow})}`);
    await page.evaluate(() => {
        const settings = getUserSettings();
        settings.appearance = 'dark';
        saveUserSettings(settings);
        applyAppearance(settings);
    });
    assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark');
    assert.equal(await page.locator('.ai-instruction-proposal').count(), 3);

    return {
        passed: true,
        assertions: [
            'real HTTP-backed Save and Dismiss', 'post-ACK GET-only status retry', 'exactly-once instruction accept',
            'field-scoped Settings draft preservation', 'terminal conflict and Settings-only retry',
            'domain draft accept/undo/reapply isolation', 'inert long text', 'pointer Save', 'narrow dark view',
        ],
        mutationLedger: structuredClone(ledger.mutations),
        faultLedger: structuredClone(faults),
        hiddenProposalMetrics,
        narrow,
    };
};

module.exports.verifySettingsTimerReadinessControl = verifySettingsTimerReadinessControl;

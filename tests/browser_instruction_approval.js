'use strict';

const assert = require('node:assert/strict');

module.exports = async function browserInstructionApproval({page, baseURL, fixture, ledger, faults}) {
    const response = await page.goto(`${baseURL}/settings/ai`);
    assert.equal(response.status(), 200, 'real AI Settings route loads from the scratch daemon');
    await page.waitForFunction(() => typeof aiBehaviorReady !== 'undefined' && aiBehaviorReady);
    await page.waitForFunction(() => document.querySelector('#timer_status_label')?.textContent === 'Timer idle');
    assert.equal(await page.locator('#timer_recovery_notice').isVisible(), false, 'the real scratch timer status read clears recovery notice before proposal actions');
    await page.locator('#ai_setting_custom_instructions').fill('Unsaved local instruction draft');
    await page.locator('#ai_setting_scheduling_window_days').fill('21');

    await page.locator('#ai_launcher_btn').click();
    await page.locator('#ai_history_toggle_btn').click();
    await page.locator('#ai_conversation_select').waitFor();
    await page.locator('#ai_conversation_select').selectOption(fixture.conversationId);
    await page.locator('#ai_history_toggle_btn').click();

    const cardFor = id => page.locator(`.ai-instruction-proposal[data-proposal-id="${id}"]`);
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

    await page.setViewportSize({width: 390, height: 844});
    const narrow = await cardFor(fixture.saveProposalId).evaluate(card => ({
        width: card.getBoundingClientRect().width,
        clientWidth: card.clientWidth,
        scrollWidth: card.scrollWidth,
        overflowX: getComputedStyle(card).overflowX,
    }));
    assert.ok(narrow.width > 0 && narrow.scrollWidth <= narrow.clientWidth + 1, 'long proposal text does not overflow the narrow card');
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
        narrow,
    };
};

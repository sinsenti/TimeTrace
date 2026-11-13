/**
 * TimeTrace AI Assistant -- drawer state, conversation switching, streaming chat consumption.
 *
 * All model-generated text renders via `textContent`, never `innerHTML`/Markdown (spec S9.5).
 * Ids are UUIDv7 strings: `addEventListener` + `dataset`, never `parseInt` or an unquoted
 * `onclick` (spec S9.6). Toggled by the navbar launcher and Ctrl+Shift+A only (spec S9.4) --
 * NOT Ctrl+K, which vim_engine.js already binds.
 */

let aiCurrentConversationId = null;
let aiConversationsCache = [];
let aiConversationsLoadPromise = null;
let aiConversationsLoaded = false;
let aiConversationsListGeneration = 0;
let aiConversationCreatePromise = null;
let aiConversationCreateIntent = null;
let aiConversationDeleteOwner = null;
let aiStreamInFlight = false;
let aiInstructionEditorSequence = 0;
let aiComposerRevision = 0;
let aiConversationGeneration = 0;
let aiTurnOwner = null;
let aiConversationReadPromise = null;
let aiDrawerLauncher = null;

function aiNotice(text) {
    const notice = document.getElementById('ai_assistant_notice');
    if (notice) notice.textContent = text;
}

function aiThreadHasDrafts() {
    const root = document.getElementById('ai_thread');
    return aiRootHasDrafts(root);
}

function aiRootHasDrafts(root) {
    if (!root || typeof hasSettingsDrafts !== 'function') return false;
    const owners = Array.from(root.querySelectorAll('.ai-inline-edit-box, .ai-instruction-proposal')).map(node => node.id);
    if (root.id) owners.push(root.id);
    return hasSettingsDrafts(owners);
}

function aiCanChangeConversation() {
    if (!aiStreamInFlight && !aiThreadHasDrafts() && !aiRootHasDrafts(document.getElementById('ai_batches_list'))) return true;
    aiNotice('Finish the current response or save/cancel the proposal edit before changing conversations.');
    const select = document.getElementById('ai_conversation_select');
    if (select) select.value = aiCurrentConversationId || '';
    return false;
}

function aiSetQuickActionsDisabled(disabled) {
    const quickActions = document.getElementById('ai_quick_actions');
    if (quickActions) {
        quickActions.classList.toggle('ai-quick-actions-loading', disabled);
        quickActions.querySelectorAll('button').forEach((button) => {
            button.disabled = disabled;
            button.setAttribute('aria-disabled', String(disabled));
        });
    }
    const askButton = document.getElementById('ai_weekly_review_ask_btn');
    if (askButton) {
        askButton.disabled = disabled;
        askButton.setAttribute('aria-disabled', String(disabled));
    }
}

function aiSelectedConversationDeleting() {
    return aiConversationDeleteOwner && aiConversationDeleteOwner.id === aiCurrentConversationId;
}

function aiSyncComposerAvailability() {
    const disabled = aiStreamInFlight || Boolean(aiSelectedConversationDeleting());
    const send = document.getElementById('ai_composer_send');
    if (send) send.disabled = disabled;
    aiSetQuickActionsDisabled(disabled);
}

function isAiDrawerOpen() {
    const el = document.getElementById('ai_drawer');
    return Boolean(el && el.classList.contains('ai-drawer-open'));
}

function openAiDrawer() {
    const el = document.getElementById('ai_drawer');
    if (!el || isAiDrawerOpen()) return;
    aiDrawerLauncher = document.activeElement;
    el.inert = false;
    el.classList.add('ai-drawer-open');
    if (aiConversationsCache.length === 0) {
        aiLoadConversations();
    }
    const input = document.getElementById('ai_composer_input');
    if (input) input.focus();
}

function closeAiDrawer() {
    if (isAiFullscreenActive()) aiExitFullscreen(); // never leave the calendar stranded in a hidden drawer
    const el = document.getElementById('ai_drawer');
    if (el) { el.classList.remove('ai-drawer-open'); el.inert = true; }
    if (aiDrawerLauncher && aiDrawerLauncher.isConnected) aiDrawerLauncher.focus();
}

function toggleAiDrawer() {
    if (isAiDrawerOpen()) closeAiDrawer();
    else openAiDrawer();
}
window.closeAiDrawer = closeAiDrawer;
window.openAiDrawer = openAiDrawer;

// -- Full screen (calendar + chat side by side) --------------------------------------------

// Where the page's own #calendar element normally lives, so aiExitFullscreen can put it back
// exactly where it came from instead of guessing.
let aiCalendarHomeParent = null;
let aiCalendarHomeNextSibling = null;
const aiCalendarControlHomes = [];

function isAiFullscreenActive() {
    const el = document.getElementById('ai_drawer');
    return Boolean(el && el.classList.contains('ai-drawer-fullscreen'));
}

function aiPageHasCalendar() {
    // `calendar` is dashboard.js's top-level FullCalendar instance -- only defined (and only a
    // real object, not just `undefined`) on the dashboard page. Checking both the JS variable
    // and the DOM element it's bound to guards against a page that has one but not the other.
    // NOTE: only safe to call from user-triggered handlers after dashboard.js has run -- never
    // from early/module-top-level/DOMContentLoaded-race code (the `calendar` `let` binding may
    // not exist yet, which throws a ReferenceError rather than evaluating falsy).
    return typeof calendar !== 'undefined' && calendar && Boolean(document.getElementById('calendar'));
}

// Reads the page header's rendered height (0 if there's no `body > header`) and publishes it as
// a CSS variable so the fullscreen drawer can sit below page chrome instead of covering it.
function aiMeasureFullscreenTop() {
    const header = document.querySelector('body > header');
    const h = header ? header.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--ai-fullscreen-top', `${h}px`);
}

function aiHandleFullscreenResize() {
    if (!isAiFullscreenActive()) return;
    aiMeasureFullscreenTop();
    // Window narrowed since the chat width was set/dragged/restored -- re-clamp against the new
    // viewport so the (flex-shrink:0) chat column can't overflow past the drawer's right edge
    // while the calendar pane collapses to nothing.
    const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ai-chat-width'));
    aiApplyFullscreenChatWidth(Number.isFinite(current) ? current : 420);
}

window.addEventListener('resize', aiHandleFullscreenResize);

function aiEnterFullscreen() {
    const drawer = document.getElementById('ai_drawer');
    const pane = document.getElementById('ai_drawer_calendar_pane');
    if (!drawer || !pane || isAiFullscreenActive()) return;
    aiMeasureFullscreenTop();
    aiRestoreFullscreenChatWidth();
    if (!isAiDrawerOpen()) openAiDrawer();

    drawer.classList.add('ai-drawer-no-transition');
    drawer.classList.add('ai-drawer-fullscreen');

    if (aiPageHasCalendar()) {
        const calendarEl = document.getElementById('calendar');
        aiCalendarHomeParent = calendarEl.parentElement;
        aiCalendarHomeNextSibling = calendarEl.nextSibling;
        for (const control of document.querySelectorAll('.planning-header > .calendar-tools, .planning-header > .calendar-panel-controls, .planning-header > #breakdown_filter_chip')) {
            const marker = document.createComment('Calendar control home');
            control.parentNode.insertBefore(marker, control);
            aiCalendarControlHomes.push({control, marker});
            pane.appendChild(control);
        }
        pane.appendChild(calendarEl);
        pane.classList.remove('hidden');
    }

    // FullCalendar sizes itself off its container's rendered dimensions at the moment of the
    // move; ask it to recompute once the new layout has actually painted rather than in the
    // same frame as the reparent/class toggle (which may still be mid-CSS-transition).
    requestAnimationFrame(() => {
        if (aiPageHasCalendar()) calendar.updateSize();
        drawer.classList.remove('ai-drawer-no-transition');
    });

    const btn = document.getElementById('ai_fullscreen_toggle_btn');
    if (btn) { btn.textContent = 'Exit Fullscreen'; btn.title = 'Exit full screen'; }
}

function aiExitFullscreen() {
    const drawer = document.getElementById('ai_drawer');
    const pane = document.getElementById('ai_drawer_calendar_pane');
    if (!drawer) return;

    drawer.classList.add('ai-drawer-no-transition');
    drawer.classList.remove('ai-drawer-fullscreen');

    if (aiCalendarHomeParent) {
        const calendarEl = document.getElementById('calendar');
        if (calendarEl) {
            aiCalendarHomeParent.insertBefore(calendarEl, aiCalendarHomeNextSibling);
        }
        aiCalendarHomeParent = null;
        aiCalendarHomeNextSibling = null;
    }
    for (const {control, marker} of aiCalendarControlHomes) {
        if (marker.isConnected) marker.parentNode.insertBefore(control, marker);
        marker.remove();
    }
    aiCalendarControlHomes.length = 0;
    if (pane) pane.classList.add('hidden');

    requestAnimationFrame(() => {
        if (typeof calendar !== 'undefined' && calendar) calendar.updateSize();
        drawer.classList.remove('ai-drawer-no-transition');
    });

    const btn = document.getElementById('ai_fullscreen_toggle_btn');
    if (btn) { btn.textContent = 'Fullscreen'; btn.title = 'Toggle full screen'; }
}

function aiToggleFullscreen() {
    if (isAiFullscreenActive()) aiExitFullscreen();
    else aiEnterFullscreen();
}
window.toggleAiDrawer = toggleAiDrawer;

function aiAppendThreadNode(node) {
    const thread = document.getElementById('ai_thread');
    if (!thread) return null;
    thread.appendChild(node);
    const body = document.getElementById('ai_drawer_body');
    if (body) body.scrollTop = body.scrollHeight;
    return node;
}

function aiAppendMessageBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `ai-msg ai-msg-${role}`;
    bubble.textContent = text; // spec S9.5: textContent only, never innerHTML/markdown
    return aiAppendThreadNode(bubble);
}

function aiAppendStatusLine(text) {
    const line = document.createElement('div');
    line.className = 'ai-msg-status';
    line.textContent = text;
    return aiAppendThreadNode(line);
}

function aiClearThread() {
    const thread = document.getElementById('ai_thread');
    if (thread) thread.textContent = '';
}

function aiRenderEmptyThreadHint() {
    const hint = document.createElement('div');
    hint.className = 'ai-thread-empty';
    hint.textContent = 'No messages yet. Ask about rescheduling, quick-add, or planning your week.';
    aiAppendThreadNode(hint);
}

function aiLoadConversations() {
    if (aiConversationsLoadPromise) return aiConversationsLoadPromise;

    const generation = ++aiConversationsListGeneration;
    const loading = (async () => {
        try {
            const loadedConversations = await api.get('/api/ai/conversations');
            if (generation !== aiConversationsListGeneration) return;
            aiConversationsLoaded = true;
            aiConversationsCache = Array.isArray(loadedConversations) ? loadedConversations : [];
            const select = document.getElementById('ai_conversation_select');
            if (select) {
                select.textContent = '';
                aiConversationsCache.forEach((conv) => {
                    const opt = document.createElement('option');
                    opt.value = conv.id;
                    opt.textContent = conv.title || '(untitled conversation)';
                    select.appendChild(opt);
                });
            }
            if (aiConversationsCache.length > 0) {
                const targetId = aiCurrentConversationId || aiConversationsCache[0].id;
                if (select) select.value = targetId;
                if (!aiCurrentConversationId) await aiSelectConversation(targetId);
            } else if (!aiCurrentConversationId && !aiThreadHasDrafts() && !aiRootHasDrafts(document.getElementById('ai_batches_list'))) {
                aiClearThread();
                aiRenderEmptyThreadHint();
            }
        } catch (err) {
            if (generation !== aiConversationsListGeneration) return;
            aiNotice('Could not load conversations. Open Conversations and Refresh to retry.');
        }
    })();
    aiConversationsLoadPromise = loading;
    return loading.finally(() => {
        if (aiConversationsLoadPromise === loading) aiConversationsLoadPromise = null;
    });
}

function aiSelectConversation(conversationId) {
    if (!conversationId) return;
    if ((aiCurrentConversationId || aiThreadHasDrafts() || aiRootHasDrafts(document.getElementById('ai_batches_list'))) && !aiCanChangeConversation()) return;
    aiRestoreHistoryCards();
    aiHistoryHasLoaded = false;
    const generation = ++aiConversationGeneration;
    aiCurrentConversationId = conversationId;
    aiSyncComposerAvailability();
    const select = document.getElementById('ai_conversation_select');
    if (select) select.value = conversationId;

    aiClearThread();
    const reading = (async () => {
        try {
            const detail = await api.get(`/api/ai/conversations/${encodeURIComponent(conversationId)}`);
            if (generation !== aiConversationGeneration) return;
            const messages = detail.messages || [];
            if (messages.length === 0) {
                aiRenderEmptyThreadHint();
            }
            for (const msg of messages) {
                if (msg.role === 'user') {
                    aiAppendMessageBubble('user', msg.content);
                } else if (msg.role === 'assistant') {
                    if (msg.content) aiAppendMessageBubble('assistant', msg.content);
                    if (msg.draft_batch_id) {
                        await aiRenderDraftBatchById(msg.draft_batch_id, generation);
                        if (generation !== aiConversationGeneration) return;
                    }
                }
            }
            for (const proposal of (detail.instruction_proposals || [])) {
                aiAppendInstructionProposal(proposal);
            }
        } catch (err) {
            if (generation !== aiConversationGeneration) return;
            aiAppendMessageBubble('error', 'Failed to load this conversation.');
        }
    })();
    aiConversationReadPromise = reading;
    return reading.finally(() => {
        if (aiConversationReadPromise === reading) aiConversationReadPromise = null;
    });
}

async function aiRenderDraftBatchById(batchId, generation = aiConversationGeneration) {
    try {
        const batch = await api.get(`/api/ai/drafts/batches/${encodeURIComponent(batchId)}`);
        if (generation !== aiConversationGeneration) return;
        aiAppendChatBatch(batch);
    } catch (err) {
        if (generation === aiConversationGeneration) aiNotice('Could not load a proposal. Open Proposals & history to retry.');
    }
}

let aiHistoryReadGeneration = 0;
let aiHistoryInteractionGeneration = 0;
let aiHistoryUndoPending = false;
let aiHistoryHasLoaded = false;
const aiHistoryCardHomes = new Map();

function aiAssistantCardChanged() {
    aiNotice('Action saved. Refresh history if its card is out of date; Refresh reads only.');
    refreshAiStatusBadge();
}

function aiAppendChatBatch(batch) {
    const existing = document.querySelector(`.ai-draft-batch[data-batch-id="${CSS.escape(batch.id)}"]`);
    if (existing) return existing;
    return aiAppendThreadNode(aiBuildDraftBatchNode(batch, {onChanged: aiAssistantCardChanged}));
}

function aiMountChatHistoryCards() {
    const list = document.getElementById('ai_batches_list');
    if (!list) return;
    document.querySelectorAll('#ai_thread > .ai-draft-batch').forEach(card => {
        const marker = document.createComment('Assistant proposal home');
        card.parentNode.insertBefore(marker, card);
        aiHistoryCardHomes.set(card.dataset.batchId, {marker, generation: aiConversationGeneration});
        list.appendChild(card);
    });
}

function aiRestoreHistoryCards() {
    ++aiHistoryReadGeneration;
    const list = document.getElementById('ai_batches_list');
    for (const [id, home] of aiHistoryCardHomes) {
        const card = list && list.querySelector(`[data-batch-id="${CSS.escape(id)}"]`);
        if (card && home.marker.isConnected && home.generation === aiConversationGeneration) {
            home.marker.parentNode.insertBefore(card, home.marker);
        }
        home.marker.remove();
    }
    aiHistoryCardHomes.clear();
}

async function aiLoadAssistantHistory() {
    const list = document.getElementById('ai_batches_list');
    if (!list) return;
    const request = ++aiHistoryReadGeneration;
    const conversation = aiConversationGeneration;
    const interaction = aiHistoryInteractionGeneration;
    aiNotice('Loading proposals and action history…');
    try {
        const batches = await api.get('/api/ai/drafts/batches?limit=50');
        const details = await Promise.all((batches || []).map(batch => api.get(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}`)));
        if (request !== aiHistoryReadGeneration || conversation !== aiConversationGeneration || document.getElementById('ai_drafts_panel')?.classList.contains('hidden')) return;
        for (const batch of details) {
            let existing = document.querySelector(`.ai-draft-batch[data-batch-id="${CSS.escape(batch.id)}"]`);
            if (existing && !list.contains(existing)) {
                const marker = document.createComment('Assistant proposal home');
                existing.parentNode.insertBefore(marker, existing);
                aiHistoryCardHomes.set(batch.id, {marker, generation: conversation});
                list.appendChild(existing);
            } else if (!existing) {
                list.appendChild(aiBuildDraftBatchNode(batch, {onChanged: aiAssistantCardChanged}));
            } else if (interaction === aiHistoryInteractionGeneration && !aiRootHasDrafts(existing) && !existing.contains(document.activeElement)) {
                const selection = new Map(Array.from(existing.querySelectorAll('.ai-item-checkbox')).map(input => [input.dataset.itemId, input.checked]));
                const replacement = aiBuildDraftBatchNode(batch, {onChanged: aiAssistantCardChanged});
                replacement.querySelectorAll('.ai-item-checkbox').forEach(input => {
                    if (selection.has(input.dataset.itemId)) input.checked = selection.get(input.dataset.itemId);
                });
                existing.replaceWith(replacement);
            }
        }
        aiHistoryHasLoaded = true;
        aiNotice(details.length ? '' : 'No proposals or action history yet.');
        return true;
    } catch (_err) {
        if (request === aiHistoryReadGeneration) aiNotice('Could not refresh history. Existing cards and edits are kept. Refresh retries reads only.');
        return false;
    }
}

async function aiUndoAssistantHistory() {
    if (aiHistoryUndoPending) return;
    if (aiThreadHasDrafts() || aiRootHasDrafts(document.getElementById('ai_batches_list'))) {
        aiNotice('Save or cancel proposal edits before Undo all.');
        return;
    }
    aiHistoryUndoPending = true;
    const button = document.getElementById('ai_undo_all_btn');
    if (button) button.disabled = true;
    try {
        await api.post('/api/ai/drafts/undo', {});
    } catch (_err) {
        aiNotice('Could not confirm Undo all. Refresh history to review before trying again.');
        aiHistoryUndoPending = false;
        if (button) button.disabled = false;
        return;
    }
    // The write is acknowledged. Every remaining operation is an independent read, never a replay.
    aiNotice('Undo all saved. Refreshing views…');
    try {
        await taskKnowledge.changed();
        if (typeof loadAiDraftOverlay === 'function') loadAiDraftOverlay();
        refreshAiStatusBadge();
        const refreshed = await aiLoadAssistantHistory();
        if (refreshed === false) aiNotice('Undo all saved; history could not refresh. Refresh retries reads only.');
    } catch (_err) {
        aiNotice('Undo all saved; views could not refresh. Refresh history to retry reads only.');
    } finally {
        aiHistoryUndoPending = false;
        if (button) button.disabled = false;
    }
}

function aiInstructionTextBlock(label, value, className = 'ai-instruction-proposal-text') {
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-instruction-proposal-section';
    const heading = document.createElement('div');
    heading.className = 'ai-instruction-proposal-label';
    heading.textContent = label;
    wrapper.appendChild(heading);
    const text = document.createElement('div');
    text.className = className;
    text.textContent = value || '(empty)';
    wrapper.appendChild(text);
    return wrapper;
}

function aiSyncCustomInstructions(settings) {
    if (!settings || typeof settings.custom_instructions !== 'string') return;
    const textarea = document.getElementById('ai_setting_custom_instructions');
    if (!textarea) return;
    if (typeof aiBehaviorInstructionsAcknowledged !== 'undefined') aiBehaviorInstructionsAcknowledged = true;
    const selector = '#ai_setting_custom_instructions';
    const draft = typeof hasSettingsDrafts === 'function' && hasSettingsDrafts(['ai_behavior_settings'], selector)
        ? textarea.value : null;
    textarea.value = settings.custom_instructions;
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('ai_behavior_settings', selector);
    if (draft !== null) textarea.value = draft;
}

function aiBuildInstructionProposalNode(proposal, options = {}) {
    const card = document.createElement('section');
    card.className = 'ai-instruction-proposal';
    card.id = `ai_instruction_editor_${++aiInstructionEditorSequence}`;
    card.dataset.proposalId = proposal.id;

    const heading = document.createElement('div');
    heading.className = 'ai-instruction-proposal-heading';
    heading.textContent = 'Standing instruction proposal';
    card.appendChild(heading);

    const explanation = document.createElement('div');
    explanation.className = 'ai-instruction-proposal-explanation';
    explanation.textContent = proposal.status === 'pending'
        ? 'I proposed this standing instruction. Save it to use it in future conversations.'
        : (proposal.status === 'accepted'
            ? 'Saved to custom instructions.'
            : proposal.status === 'rejected' ? 'Dismissed; custom instructions were not changed.' : `Status: ${proposal.status}`);
    card.appendChild(explanation);

    card.appendChild(aiInstructionTextBlock('Existing custom instructions', proposal.before_instructions));

    const proposedSection = document.createElement('div');
    proposedSection.className = 'ai-instruction-proposal-section';
    const proposedLabel = document.createElement('div');
    proposedLabel.className = 'ai-instruction-proposal-label';
    proposedLabel.textContent = 'Proposed standing instruction';
    proposedSection.appendChild(proposedLabel);
    const input = document.createElement('textarea');
    input.className = 'ai-instruction-proposal-editor';
    input.rows = 3;
    input.maxLength = 4000;
    input.value = proposal.proposed_instruction || '';
    input.disabled = proposal.status !== 'pending';
    proposedSection.appendChild(input);
    card.appendChild(proposedSection);

    card.appendChild(aiInstructionTextBlock('Resulting custom instructions', proposal.after_instructions));

    const status = document.createElement('div');
    status.className = 'ai-instruction-proposal-status';
    card.appendChild(status);

    if (proposal.status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'ai-instruction-proposal-actions';
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'ai-btn ai-btn-accept';
        saveButton.dataset.proposalId = proposal.id;
        saveButton.textContent = 'Save to custom instructions';
        const dismissButton = document.createElement('button');
        dismissButton.type = 'button';
        dismissButton.className = 'ai-btn ai-btn-reject';
        dismissButton.dataset.proposalId = proposal.id;
        dismissButton.textContent = 'Dismiss';
        actions.appendChild(dismissButton);
        actions.appendChild(saveButton);
        card.appendChild(actions);

        const setBusy = (busy) => {
            saveButton.disabled = busy;
            dismissButton.disabled = busy;
            input.disabled = busy;
        };
        saveButton.addEventListener('click', async () => {
            setBusy(true);
            try {
                const result = await api.post(`/api/ai/instruction-proposals/${encodeURIComponent(proposal.id)}/accept`, {
                    instruction: input.value
                });
                aiSyncCustomInstructions(result.settings);
                card.replaceWith(aiBuildInstructionProposalNode(result.proposal, options));
                if (typeof options.onChanged === 'function') options.onChanged();
            } catch (err) {
                if (/changed|conflict|review/i.test(err.message || '')) {
                    setBusy(true);
                    try {
                        const settings = await api.get('/api/ai/settings');
                        aiSyncCustomInstructions(settings);
                        status.textContent = 'Settings changed since this proposal. Review the current custom instructions and decide again.';
                    } catch (_reloadErr) {
                        status.textContent = 'Settings changed. Reload the AI settings page and review again.';
                    }
                } else {
                    setBusy(false);
                    status.textContent = `Save failed: ${err.message || err}`;
                }
            }
        });
        dismissButton.addEventListener('click', async () => {
            setBusy(true);
            try {
                const result = await api.post(`/api/ai/instruction-proposals/${encodeURIComponent(proposal.id)}/reject`, {});
                card.replaceWith(aiBuildInstructionProposalNode(result.proposal, options));
                if (typeof options.onChanged === 'function') options.onChanged();
            } catch (err) {
                setBusy(false);
                status.textContent = `Dismiss failed: ${err.message || err}`;
            }
        });
    }
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(card);
    return card;
}

function aiAppendInstructionProposal(proposal) {
    if (!proposal || !proposal.id) return;
    const existing = document.querySelector(`.ai-instruction-proposal[data-proposal-id="${CSS.escape(proposal.id)}"]`);
    if (existing) return; // Retain this card's independent edit/pending owner.
    const node = aiBuildInstructionProposalNode(proposal, { onChanged: refreshAiStatusBadge });
    if (existing) existing.replaceWith(node);
    else aiAppendThreadNode(node);
}

function aiCreateConversation() {
    if (aiConversationCreatePromise) {
        const intent = aiConversationCreateIntent;
        // The first Send may join New while its empty-history creation is still pending.
        // Transfer that same intent only before any selection, cancellation or newer turn.
        if (!intent.conversationId && !aiCurrentConversationId && !intent.owner &&
                intent.generation === aiConversationGeneration && aiTurnOwner && !aiTurnOwner.canceled) {
            intent.owner = aiTurnOwner;
        }
        return aiConversationCreatePromise;
    }
    if ((aiCurrentConversationId || aiThreadHasDrafts() || aiRootHasDrafts(document.getElementById('ai_batches_list'))) && !aiCanChangeConversation()) return Promise.resolve(null);

    const intent = {generation: aiConversationGeneration, owner: aiTurnOwner, conversationId: aiCurrentConversationId};
    aiConversationCreateIntent = intent;
    const ownsSelection = () => intent.generation === aiConversationGeneration &&
        intent.owner === aiTurnOwner && !intent.owner?.canceled;
    aiConversationCreatePromise = (async () => {
        try {
            const conv = await api.post('/api/ai/conversations', {});
            ++aiConversationsListGeneration;
            aiConversationsLoaded = true;
            aiConversationsCache.unshift(conv);
            const select = document.getElementById('ai_conversation_select');
            if (select) {
                const opt = document.createElement('option');
                opt.value = conv.id;
                opt.textContent = conv.title || '(untitled conversation)';
                select.insertBefore(opt, select.firstChild);
            }
            if (select) select.value = aiCurrentConversationId || '';
            // The row exists even if a newer selection/turn superseded this request.
            // Reconcile metadata independently; only its captured owner may select it.
            if (!ownsSelection()) return null;
            await aiSelectConversation(conv.id);
            return aiCurrentConversationId === conv.id && !intent.owner?.canceled ? conv.id : null;
        } catch (err) {
            if (!ownsSelection()) return null;
            console.error('Failed to create AI conversation:', err);
            alert('Failed to start a new conversation: ' + (err.message || err));
            return null;
        }
    })().finally(() => {
        aiConversationCreatePromise = null;
        aiConversationCreateIntent = null;
    });
    return aiConversationCreatePromise;
}

async function aiRenameCurrentConversation() {
    if (!aiCurrentConversationId) return;
    const conversationId = aiCurrentConversationId;
    const current = aiConversationsCache.find((c) => c.id === conversationId);
    const nextTitle = prompt('Rename conversation', (current && current.title) || '');
    if (nextTitle === null) return; // cancelled
    const trimmed = nextTitle.trim();
    if (!trimmed) return;

    try {
        const updated = await api.request(`/api/ai/conversations/${encodeURIComponent(conversationId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: trimmed }),
        });
        if (current) current.title = updated.title;
        const select = document.getElementById('ai_conversation_select');
        const opt = select && select.querySelector(`option[value="${CSS.escape(conversationId)}"]`);
        if (opt) opt.textContent = updated.title || '(untitled conversation)';
    } catch (err) {
        console.error('Failed to rename AI conversation:', err);
        alert('Failed to rename conversation: ' + (err.message || err));
    }
}

async function aiDeleteCurrentConversation() {
    if (aiConversationDeleteOwner || !aiCurrentConversationId || !aiCanChangeConversation()) return;
    const id = aiCurrentConversationId;
    if (!window.confirm('Delete this conversation? Applied changes and their action history are kept.')) return;
    const owner = {id};
    aiConversationDeleteOwner = owner;
    aiSyncComposerAvailability();
    aiNotice('Deleting conversation. Sending here is paused until deletion finishes.');
    try {
        await api.delete(`/api/ai/conversations/${encodeURIComponent(id)}`);
        ++aiConversationsListGeneration;
        aiConversationsCache = aiConversationsCache.filter(c => c.id !== id);
        const select = document.getElementById('ai_conversation_select');
        const option = select && Array.from(select.children).find(option => option.value === id);
        if (option) option.remove();
        if (aiCurrentConversationId === id) {
            ++aiConversationGeneration;
            aiCurrentConversationId = null;
            aiConversationReadPromise = null;
            if (select) select.value = '';
            // Retire the deleted identity independently of the retained local proposal cards.
            if (aiThreadHasDrafts() || aiRootHasDrafts(document.getElementById('ai_batches_list'))) {
                aiNotice('Conversation deleted. Proposal edits are retained here; save or cancel them before changing conversations.');
                return;
            }
            aiClearThread();
        }
        if (aiConversationsLoadPromise) await aiConversationsLoadPromise;
        await aiLoadConversations();
    } catch (_err) {
        aiNotice('Could not confirm deletion. Refresh conversations before trying again.');
    } finally {
        if (aiConversationDeleteOwner === owner) aiConversationDeleteOwner = null;
        aiSyncComposerAvailability();
    }
}

function aiCancelMessage() {
    if (!aiTurnOwner) return;
    aiTurnOwner.canceled = true;
    aiTurnOwner.controller.abort();
    // Reads may remain unresolved after abort. Release their ownership immediately and fence
    // their late callbacks, without promising that server work was canceled.
    ++aiConversationsListGeneration;
    ++aiConversationGeneration;
    aiConversationsLoadPromise = null;
    aiConversationReadPromise = null;
    aiTurnOwner = null;
    aiStreamInFlight = false;
    document.getElementById('ai_composer_cancel')?.classList.add('hidden');
    aiSyncComposerAvailability();
    aiNotice('Stopped receiving. Server work may have persisted; refresh this conversation to review before sending again.');
}

async function aiEnsureConversation(owner) {
    if (aiConversationReadPromise) await aiConversationReadPromise;
    if (owner.canceled) return null;
    if (aiCurrentConversationId) return aiCurrentConversationId;

    // A preset can be clicked immediately after opening the drawer. Wait for the initial list
    // request before deciding that there are no conversations, otherwise two rapid clicks can
    // each create a new conversation while the list is still loading.
    if (aiConversationsLoadPromise) {
        await aiConversationsLoadPromise;
    } else if (aiConversationsCache.length === 0) {
        await aiLoadConversations();
    }
    if (aiCurrentConversationId) return aiCurrentConversationId;
    if (owner.canceled || !aiConversationsLoaded) return null;

    if (aiConversationsCache.length > 0) {
        await aiSelectConversation(aiConversationsCache[0].id);
        return aiCurrentConversationId;
    }
    return aiCreateConversation();
}

function aiShowChat() {
    aiRestoreHistoryCards();
    document.getElementById('ai_drafts_panel')?.classList.add('hidden');
    document.getElementById('ai_drawer_body')?.classList.remove('hidden');
    document.getElementById('ai_drafts_toggle_btn')?.setAttribute('aria-expanded', 'false');
}

async function aiSendMessage(prompt = null) {
    if (aiSelectedConversationDeleting()) {
        aiNotice('Deleting conversation. Sending here is paused until deletion finishes.');
        return;
    }
    if (aiStreamInFlight) return;
    if (!aiCurrentConversationId && (aiThreadHasDrafts() || aiRootHasDrafts(document.getElementById('ai_batches_list')))) {
        aiCanChangeConversation();
        return;
    }
    const input = document.getElementById('ai_composer_input');
    if (!input) return;
    const composerText = input.value;
    const composerRevision = aiComposerRevision;
    const text = prompt === null ? composerText.trim() : String(prompt).trim();
    if (!text) return;

    // Set the in-flight guard before the first await. This covers both the conversation lookup
    // and the actual stream, so rapid preset clicks cannot race through aiEnsureConversation().
    aiStreamInFlight = true;
    const owner = {controller: new AbortController(), canceled: false};
    aiTurnOwner = owner;
    const cancelBtn = document.getElementById('ai_composer_cancel');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    const sendBtn = document.getElementById('ai_composer_send');
    if (sendBtn) sendBtn.disabled = true;
    aiSetQuickActionsDisabled(true);

    let statusNode = null;
    let assistantBubble = null;
    let assistantText = '';
    let sendFailed = false;
    let terminal = false;

    const consumeSubmittedComposer = () => {
        if (prompt === null && aiComposerRevision === composerRevision && input.value === composerText) {
            input.value = '';
            aiAutoGrowComposer(input);
        }
    };
    const setStatus = (label) => {
        if (!statusNode) {
            statusNode = aiAppendStatusLine(label);
        } else {
            statusNode.textContent = label;
        }
    };

    try {
        const conversationId = await aiEnsureConversation(owner);
        if (owner.canceled) return;
        if (!conversationId) {
            aiAppendMessageBubble('error', 'Failed to start an assistant conversation.');
            return;
        }

        aiShowChat();
        const emptyHint = document.querySelector('#ai_thread .ai-thread-empty');
        if (emptyHint) emptyHint.remove();
        aiAppendMessageBubble('user', text);

        const generation = ++aiConversationGeneration;
        const onEvent = (evt) => {
            if (aiTurnOwner !== owner || owner.canceled || generation !== aiConversationGeneration) return;
            switch (evt.event) {
                case 'message_start':
                    consumeSubmittedComposer();
                    setStatus('thinking...');
                    break;
                case 'status': {
                    const label = (evt.data && (evt.data.message || evt.data.label || evt.data.status)) || 'working...';
                    setStatus(String(label));
                    break;
                }
                case 'token': {
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    const piece = (evt.data && (evt.data.token !== undefined ? evt.data.token : evt.data.text)) || '';
                    assistantText += piece;
                    if (!assistantBubble) {
                        assistantBubble = document.createElement('div');
                        assistantBubble.className = 'ai-msg ai-msg-assistant';
                        aiAppendThreadNode(assistantBubble);
                    }
                    assistantBubble.textContent = assistantText; // textContent only -- spec S9.5
                    const body = document.getElementById('ai_drawer_body');
                    if (body) body.scrollTop = body.scrollHeight;
                    break;
                }
                case 'draft': {
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    const batch = evt.data;
                    if (batch && batch.id) {
                        aiAppendChatBatch(batch);
                        if (typeof loadAiDraftOverlay === 'function') loadAiDraftOverlay();
                    }
                    break;
                }
                case 'instruction_proposal':
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    aiAppendInstructionProposal(evt.data);
                    break;
                case 'message_end':
                    terminal = true;
                    if (evt.data && evt.data.error) {
                        sendFailed = true;
                        aiAppendMessageBubble('error', String(evt.data.error));
                    }
                    if (evt.data && typeof evt.data.content === 'string') {
                        if (!assistantBubble && evt.data.content) assistantBubble = aiAppendMessageBubble('assistant', evt.data.content);
                        else if (assistantBubble) assistantBubble.textContent = evt.data.content;
                    }
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    break;
                case 'error': {
                    terminal = true;
                    sendFailed = true;
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    const msg = (evt.data && (evt.data.error || evt.data.message)) || 'The assistant hit an error.';
                    aiAppendMessageBubble('error', String(msg));
                    break;
                }
                default:
                    break;
            }
        };
        const result = await api.stream(`/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
            { text, stream: true }, onEvent, {}, {signal: owner.controller.signal});
        if (aiTurnOwner !== owner || owner.canceled || generation !== aiConversationGeneration) return;
        if (result) {
            if (!result.message || typeof result.message.content !== 'string') throw new Error('Invalid assistant response.');
            if (result.draft_batch) onEvent({event:'draft', data:result.draft_batch});
            if (result.instruction_proposal) onEvent({event:'instruction_proposal', data:result.instruction_proposal});
            consumeSubmittedComposer();
            onEvent({event:'message_end', data:result.message});
        }
        if (!terminal && !owner.canceled) throw new Error('Response interrupted. Refresh the conversation to review saved messages/proposals before retrying.');
    } catch (err) {
        sendFailed = true;
        if (owner.canceled) return;
        if (statusNode) { statusNode.remove(); statusNode = null; }
        aiAppendMessageBubble('error', 'Failed to reach the assistant: ' + (err.message || err));
    } finally {
        if (statusNode) statusNode.remove();
        if (sendFailed && !owner.canceled) aiNotice('The response failed. Messages or proposals may have persisted; refresh this conversation before retrying.');
        if (sendFailed && !owner.canceled && prompt === null && aiComposerRevision === composerRevision && !input.value) {
            input.value = composerText;
            aiAutoGrowComposer(input);
        }
        if (aiTurnOwner === owner) {
            aiTurnOwner = null;
            aiStreamInFlight = false;
            if (cancelBtn) cancelBtn.classList.add('hidden');
            aiSyncComposerAvailability();
            refreshAiStatusBadge();
        }
    }
}

function aiRunPresetPrompt(prompt) {
    return aiSendMessage(prompt);
}
window.aiRunPresetPrompt = aiRunPresetPrompt;

let aiStatusBadgeGeneration = 0;

// Existing callers may ignore the result; Settings uses false to offer read-only retry.
// Report each read outcome, but only the newest request may repaint the shared badge.
async function refreshAiStatusBadge() {
    const generation = ++aiStatusBadgeGeneration;
    const badge = document.getElementById('ai_launcher_badge');
    try {
        const status = await api.get('/api/ai/status');
        if (generation !== aiStatusBadgeGeneration) return true;
        const count = (status.pending_draft_count || 0) + (status.undoable_batch_count || 0);
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
        return true;
    } catch {
        // Non-fatal for ordinary callers: retain the last known badge state.
        console.error('Failed to refresh AI status badge.');
        return false;
    }
}

const AI_DRAWER_WIDTH_STORAGE_KEY = 'tt_ai_drawer_width_px';
const AI_DRAWER_MIN_WIDTH = 320;
const AI_FULLSCREEN_CHAT_WIDTH_STORAGE_KEY = 'tt_ai_fullscreen_chat_width_px';

function aiDrawerMaxWidth() {
    // Leave at least ~280px of calendar/content visible rather than letting the drawer
    // swallow the whole viewport on a narrow window.
    return Math.max(AI_DRAWER_MIN_WIDTH, window.innerWidth - 280);
}

function aiApplyDrawerWidth(widthPx) {
    const el = document.getElementById('ai_drawer');
    if (!el) return;
    const clamped = Math.min(Math.max(widthPx, AI_DRAWER_MIN_WIDTH), aiDrawerMaxWidth());
    el.style.width = `${clamped}px`;
    aiSetResizeValues(clamped, aiDrawerMaxWidth());
    return clamped;
}

function aiRestoreDrawerWidth() {
    const stored = window.localStorage ? window.localStorage.getItem(AI_DRAWER_WIDTH_STORAGE_KEY) : null;
    if (!stored) return;
    const widthPx = parseInt(stored, 10);
    if (Number.isFinite(widthPx) && widthPx > 0) aiApplyDrawerWidth(widthPx);
}

// -- Full-screen chat/calendar split width (separate from the normal-mode drawer width above) --

function aiFullscreenChatMaxWidth() {
    // Mirror aiDrawerMaxWidth's reasoning: never let the chat column swallow the whole viewport
    // and leave the calendar pane with nothing.
    return Math.max(AI_DRAWER_MIN_WIDTH, window.innerWidth - 320);
}

function aiApplyFullscreenChatWidth(widthPx) {
    const clamped = Math.min(Math.max(widthPx, AI_DRAWER_MIN_WIDTH), aiFullscreenChatMaxWidth());
    document.documentElement.style.setProperty('--ai-chat-width', `${clamped}px`);
    aiSetResizeValues(clamped, aiFullscreenChatMaxWidth());
    return clamped;
}

function aiRestoreFullscreenChatWidth() {
    const stored = window.localStorage
        ? window.localStorage.getItem(AI_FULLSCREEN_CHAT_WIDTH_STORAGE_KEY)
        : null;
    if (!stored) return;
    const widthPx = parseInt(stored, 10);
    if (Number.isFinite(widthPx) && widthPx > 0) aiApplyFullscreenChatWidth(widthPx);
}

function aiSetResizeValues(value, maximum) {
    const handle = document.getElementById('ai_drawer_resize_handle');
    if (!handle) return;
    handle.setAttribute('aria-valuemin', String(AI_DRAWER_MIN_WIDTH));
    handle.setAttribute('aria-valuemax', String(maximum));
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
}

function aiSetupDrawerResize() {
    const handle = document.getElementById('ai_drawer_resize_handle');
    const drawer = document.getElementById('ai_drawer');
    if (!handle || !drawer) return;

    aiSetResizeValues(drawer.getBoundingClientRect().width, aiDrawerMaxWidth());
    let dragging = false;

    const onMove = (e) => {
        if (!dragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        if (isAiFullscreenActive()) {
            aiApplyFullscreenChatWidth(window.innerWidth - clientX);
        } else {
            aiApplyDrawerWidth(window.innerWidth - clientX);
        }
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('ai-drawer-resize-active');
        drawer.classList.remove('ai-drawer-resizing');
        document.body.style.userSelect = '';
        try {
            if (isAiFullscreenActive()) {
                const chatWidth = getComputedStyle(document.documentElement).getPropertyValue('--ai-chat-width');
                const widthPx = parseInt(chatWidth, 10);
                if (Number.isFinite(widthPx) && widthPx > 0) {
                    window.localStorage.setItem(AI_FULLSCREEN_CHAT_WIDTH_STORAGE_KEY, String(widthPx));
                }
            } else {
                window.localStorage.setItem(AI_DRAWER_WIDTH_STORAGE_KEY, String(parseInt(drawer.style.width, 10)));
            }
        } catch (_err) {
            // localStorage can throw in a private/blocked context -- resizing still works this session.
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
    };

    const onDown = (e) => {
        dragging = true;
        handle.classList.add('ai-drawer-resize-active');
        drawer.classList.add('ai-drawer-resizing');
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        e.preventDefault();
    };

    handle.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const current = isAiFullscreenActive()
            ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ai-chat-width')) || 420
            : drawer.getBoundingClientRect().width;
        const width = current + (e.key === 'ArrowLeft' ? 24 : -24);
        if (isAiFullscreenActive()) aiApplyFullscreenChatWidth(width);
        else aiApplyDrawerWidth(width);
        dragging = true;
        onUp();
    });
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });

    window.addEventListener('resize', () => aiApplyDrawerWidth(drawer.getBoundingClientRect().width));
}

function aiAutoGrowComposer(el) {
    // Grow the textarea to fit its content as the user types multiline text, up to the
    // `max-height` set in ai.css -- the browser itself enforces that cap and switches to an
    // internal scrollbar once `scrollHeight` exceeds it, so this only needs to ask for
    // "as tall as the content wants to be" each time, not compute the limit itself.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}

function aiSetupDrawer() {
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('ai_drawer', '#ai_composer_input');
    aiRestoreDrawerWidth();
    aiSetupDrawerResize();
    const drawer = document.getElementById('ai_drawer');
    if (drawer) {
        drawer.addEventListener('input', () => ++aiHistoryInteractionGeneration, true);
        drawer.addEventListener('click', () => ++aiHistoryInteractionGeneration, true);
    }

    const closeBtn = document.getElementById('ai_drawer_close_btn');
    if (closeBtn) closeBtn.addEventListener('click', closeAiDrawer);

    const newConvBtn = document.getElementById('ai_new_conversation_btn');
    if (newConvBtn) newConvBtn.addEventListener('click', aiCreateConversation);

    const renameConvBtn = document.getElementById('ai_rename_conversation_btn');
    if (renameConvBtn) renameConvBtn.addEventListener('click', aiRenameCurrentConversation);
    const deleteBtn = document.getElementById('ai_delete_conversation_btn');
    if (deleteBtn) deleteBtn.addEventListener('click', aiDeleteCurrentConversation);
    const historyRefresh = document.getElementById('ai_history_refresh_btn');
    if (historyRefresh) historyRefresh.addEventListener('click', () => {
        if (!aiCanChangeConversation()) return;
        aiLoadConversations();
        if (aiCurrentConversationId) aiSelectConversation(aiCurrentConversationId);
    });
    for (const [buttonId, panelId] of [['ai_history_toggle_btn','ai_history_panel'], ['ai_insights_toggle_btn','ai_insights_panel']]) {
        const button = document.getElementById(buttonId);
        const panel = document.getElementById(panelId);
        if (button && panel) button.addEventListener('click', () => {
            const showing = panel.classList.toggle('hidden');
            button.setAttribute('aria-expanded', String(!showing));
        });
    }

    const fullscreenBtn = document.getElementById('ai_fullscreen_toggle_btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', aiToggleFullscreen);
        // Safe here (user-triggered setup after page load), unlike inside aiPageHasCalendar's
        // own early-call guard -- a plain DOM check is enough to decide whether this page can
        // ever go fullscreen with a calendar pane.
        if (!document.getElementById('calendar')) fullscreenBtn.classList.add('hidden');
    }

    const calendarPaneEl = document.getElementById('ai_drawer_calendar_pane');
    if (calendarPaneEl && typeof ResizeObserver !== 'undefined') {
        let resizeDebounce = null;
        const observer = new ResizeObserver(() => {
            if (resizeDebounce) clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(() => {
                if (aiPageHasCalendar()) calendar.updateSize();
            }, 50);
        });
        observer.observe(calendarPaneEl);
    }

    const select = document.getElementById('ai_conversation_select');
    if (select) select.addEventListener('change', (e) => aiSelectConversation(e.target.value));

    const sendBtn = document.getElementById('ai_composer_send');
    if (sendBtn) sendBtn.addEventListener('click', () => aiSendMessage());
    const cancelBtn = document.getElementById('ai_composer_cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', aiCancelMessage);

    const input = document.getElementById('ai_composer_input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                aiSendMessage();
            }
        });
        input.addEventListener('input', () => { ++aiComposerRevision; aiAutoGrowComposer(input); });
        aiAutoGrowComposer(input);
    }

    const draftsToggleBtn = document.getElementById('ai_drafts_toggle_btn');
    const draftsPanel = document.getElementById('ai_drafts_panel');
    const drawerBody = document.getElementById('ai_drawer_body');
    if (draftsToggleBtn && draftsPanel && drawerBody) {
        draftsToggleBtn.addEventListener('click', () => {
            const showing = !draftsPanel.classList.contains('hidden');
            if (showing) {
                aiRestoreHistoryCards();
                draftsPanel.classList.add('hidden');
                drawerBody.classList.remove('hidden');
                draftsToggleBtn.setAttribute('aria-expanded', 'false');
            } else {
                draftsPanel.classList.remove('hidden');
                drawerBody.classList.add('hidden');
                draftsToggleBtn.setAttribute('aria-expanded', 'true');
                const list = document.getElementById('ai_batches_list');
                aiMountChatHistoryCards();
                if (list && !aiHistoryHasLoaded) aiLoadAssistantHistory();
            }
        });
    }

    const batchesRefresh = document.getElementById('ai_batches_refresh_btn');
    if (batchesRefresh) batchesRefresh.addEventListener('click', () => {
        if (aiRootHasDrafts(document.getElementById('ai_batches_list'))) {
            aiNotice('Save or cancel proposal edits before refreshing history.');
            return;
        }
        aiLoadAssistantHistory();
    });

    const undoAllBtn = document.getElementById('ai_undo_all_btn');
    if (undoAllBtn) undoAllBtn.addEventListener('click', aiUndoAssistantHistory);

    const launcherBtn = document.getElementById('ai_launcher_btn');
    if (launcherBtn) launcherBtn.addEventListener('click', toggleAiDrawer);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
            e.preventDefault();
            toggleAiDrawer();
        }
    });

    refreshAiStatusBadge();
}

document.addEventListener('DOMContentLoaded', aiSetupDrawer);

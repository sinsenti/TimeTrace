/** Custom ratings shared by Day, Session Review and Task Inspector. */
function ratingEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

async function renderCustomRatingsInputs(targetType, targetId, containerId, existingEntries = [], isCurrent = () => true, editorRoot = null, preserveDrafts = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const generation = (container.ratingRenderGeneration || 0) + 1;
    container.ratingRenderGeneration = generation;
    container.ratingTarget = `${targetType}:${targetId}`;
    const defs = await api.get(`/rating-definitions?target_type=${targetType}`) || [];
    if (!isCurrent() || document.getElementById(containerId) !== container || container.ratingRenderGeneration !== generation) return;
    const previous = preserveDrafts ? Array.from(container.querySelectorAll('[data-rating-def-id]')) : [];
    const dirty = new Map(previous.filter(card => {
        const input = card.querySelector('.custom-rating-input');
        return container.ratingBaselines?.get(input.id) !== JSON.stringify([input.value, input.disabled]);
    }).map(card => [card.getAttribute('data-rating-def-id'), card]));
    const prefix = editorRoot ? `${container.id}_` : '';
    const html = defs.map(d => {
        const entry = existingEntries.find(e => e.rating_definition_id === d.id);
        const dismissed = entry?.dismissed === true;
        const score = entry?.score ?? Math.ceil((d.min_score + d.max_score) / 2);
        const key = `${prefix}${d.id}`;
        const color = typeof getGradeColorClasses === 'function' ? getGradeColorClasses(score, d.min_score, d.max_score).text : 'text-purple-400';
        return `<div class="rev-card space-y-2" data-rating-def-id="${ratingEscape(d.id)}" data-required="${!!d.is_required}">
            <div class="flex justify-between gap-2 text-xs"><span class="font-bold">${ratingEscape(d.name)}${d.is_required ? ' *' : ''}</span>
            <span id="score_label_${key}" class="font-mono ${color}">${dismissed ? 'Dismissed' : `${score} / ${d.max_score}`}</span>
            <button type="button" id="dismiss_btn_${key}" onclick="toggleDismissRatingInput('${key}', ${d.min_score}, ${d.max_score})">${dismissed ? 'Undismiss' : 'Dismiss'}</button></div>
            <p class="text-xs">${ratingEscape(d.description)}</p>
            <div class="custom-rating-band ${color}"><input type="range" min="${d.min_score}" max="${d.max_score}" value="${score}" ${dismissed ? 'disabled' : ''}
                id="rating_range_input_${key}" oninput="onRatingRangeInput('${key}', ${d.min_score}, ${d.max_score})" aria-label="${ratingEscape(d.name)}" class="custom-rating-input w-full"></div>
        </div>`;
    }).join('');
    if (preserveDrafts && container.ratingHTML === html && !container.ratingUnavailable) return true;
    container.innerHTML = html;
    container.ratingHTML = html;
    container.ratingUnavailable = false;
    container.ratingBaselines ||= new Map();
    for (const card of preserveDrafts ? container.querySelectorAll('[data-rating-def-id]') : []) {
        const id = card.getAttribute('data-rating-def-id');
        let input = card.querySelector('.custom-rating-input');
        const old = dirty.get(id);
        if (old) {
            const retained = old.querySelector('.custom-rating-input');
            // Range inputs clamp on bounds changes. Keep an invalid draft visible and editable.
            retained.type = 'number';
            retained.min = input.min; retained.max = input.max;
            retained.setAttribute('oninput', input.getAttribute('oninput'));
            if (Number(retained.value) >= Number(input.min) && Number(retained.value) <= Number(input.max)) retained.type = 'range';
            input.replaceWith(retained); input = retained;
            const key = input.id.replace('rating_range_input_', '');
            const button = card.querySelector('button');
            if (button) button.innerText = input.disabled ? 'Undismiss' : 'Dismiss';
            onRatingRangeInput(key, Number(input.min), Number(input.max));
            dirty.delete(id);
        } else {
            container.ratingBaselines.set(input.id, JSON.stringify([input.value, input.disabled]));
            if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(container.id, `#${input.id}`);
        }
    }
    for (const card of dirty.values()) {
        const wasUnavailable = card.getAttribute('data-rating-unavailable') === 'true';
        card.setAttribute('data-rating-unavailable', 'true');
        const message = document.createElement('p');
        message.textContent = 'This rating definition is unavailable. Discard drafts to remove it, or restore the definition and Refresh.';
        if (!wasUnavailable) card.appendChild(message);
        container.appendChild(card); container.ratingUnavailable = true;
    }
    // Preserve known ACKs across definition refreshes for this retained owner.
    if (!preserveDrafts) container.ratingAcknowledged = new Map();
    return true;
}

function onRatingRangeInput(key, minScore, maxScore) {
    const input = document.getElementById(`rating_range_input_${key}`);
    const label = document.getElementById(`score_label_${key}`);
    if (!input || !label) return;
    label.innerText = input.disabled ? 'Dismissed' : `${input.value} / ${maxScore}`;
    const color = typeof getGradeColorClasses === 'function'
        ? getGradeColorClasses(input.value, minScore, maxScore).text : 'text-purple-400';
    label.className = `font-mono ${color}`;
    const band = input.parentElement;
    if (band?.classList.contains('custom-rating-band')) band.className = `custom-rating-band ${color}`;
}

function toggleDismissRatingInput(key, minScore, maxScore) {
    const input = document.getElementById(`rating_range_input_${key}`);
    const button = document.getElementById(`dismiss_btn_${key}`);
    if (!input || !button) return;
    input.disabled = !input.disabled;
    button.innerText = input.disabled ? 'Undismiss' : 'Dismiss';
    onRatingRangeInput(key, minScore, maxScore);
}

function customRatingsRoot(targetType, editorRoot) {
    return editorRoot || document.getElementById(`${targetType}_custom_ratings_container`);
}

function validateRequiredCustomRatings(targetType, targetId, editorRoot = null) {
    const root = customRatingsRoot(targetType, editorRoot);
    for (const card of root?.querySelectorAll('[data-rating-def-id]') || []) {
        const input = card.querySelector('.custom-rating-input');
        if (card.getAttribute('data-rating-unavailable') === 'true') {
            window.appDialogs.alert({message:'A rating definition is unavailable. Discard drafts or restore it and Refresh before saving.'});
            return false;
        }
        if (input && !input.disabled && (Number(input.value) < Number(input.min) || Number(input.value) > Number(input.max)
            || input.type === 'number' && (input.value === '' || !Number.isInteger(Number(input.value))))) {
            window.appDialogs.alert({message:'A rating draft is outside its current scale. Adjust the value or dismiss it before saving.'});
            return false;
        }
        if (card.getAttribute('data-required') === 'true' && input && !input.disabled && input.value === '') {
            window.appDialogs.alert({message:'Please complete essential rating.'});
            return false;
        }
    }
    return true;
}

function snapshotCustomRatings(targetType, targetId, editorRoot = null) {
    const root = customRatingsRoot(targetType, editorRoot);
    if (root?.ratingTarget && root.ratingTarget !== `${targetType}:${targetId}`) return [];
    const owner = editorRoot?.id || (targetType === 'task' ? 'task_inspector_body'
        : targetType === 'session' ? 'session_review_modal' : 'day_custom_ratings_container');
    return Array.from(root?.querySelectorAll('[data-rating-def-id]') || []).flatMap(card => {
        const input = card.querySelector('.custom-rating-input');
        if (!input) return [];
        const parsed = Number.parseInt(input.value);
        const body = {rating_definition_id:card.getAttribute('data-rating-def-id'), target_type:targetType,
            target_id:String(targetId), score:input.disabled || Number.isNaN(parsed) ? 0 : parsed, dismissed:input.disabled};
        return [{root, input, rawValue:input.value, body, signature:JSON.stringify(body), checkpoint:typeof settingsDraftCheckpoint === 'function'
            ? settingsDraftCheckpoint(owner, `#${input.id}`) : () => {}}];
    });
}

async function submitCustomRatings(targetType, targetId, isCurrent = () => true, editorRoot = null, submitted = null) {
    const entries = submitted || snapshotCustomRatings(targetType, targetId, editorRoot);
    for (const entry of entries) {
        if (!isCurrent()) return;
        const {root, input, rawValue, body, signature, checkpoint} = entry;
        if (root.ratingTarget && root.ratingTarget !== `${body.target_type}:${body.target_id}`) return;
        root.ratingAcknowledged ||= new Map();
        if (root.ratingAcknowledged.get(body.rating_definition_id) === signature) continue;
        await api.post('/rating-entries', body);
        if (!isCurrent() || document.getElementById(input.id) !== input ||
            root.ratingTarget && root.ratingTarget !== `${body.target_type}:${body.target_id}`) return;
        root.ratingAcknowledged.set(body.rating_definition_id, signature);
        root.ratingBaselines ||= new Map();
        root.ratingBaselines.set(input.id, JSON.stringify([String(rawValue), body.dismissed]));
        checkpoint();
    }
}

let allRatingDefinitions = [];
let ratingDefinitionsGeneration = 0;
let ratingDefinitionsNotice = '';
let ratingDefinitionEditor = null;

function ratingAdminStatus(id, message) {
    const status = document.getElementById(id);
    if (status) status.textContent = message;
}

async function loadRatingDefinitionsList() {
    const container = document.getElementById('rating_defs_card_list');
    if (!container) return;
    const generation = ++ratingDefinitionsGeneration;
    const retry = document.getElementById('rating_defs_retry_btn');
    if (retry) retry.hidden = true;
    const editorRetry = document.getElementById('rating_def_refresh_btn');
    if (editorRetry) editorRetry.hidden = true;
    ratingAdminStatus('rating_defs_status', `${ratingDefinitionsNotice}Loading rating scales…`);
    container.setAttribute('aria-busy', 'true');
    try {
        const definitions = await api.get('/rating-definitions') || [];
        if (generation !== ratingDefinitionsGeneration) return;
        allRatingDefinitions = definitions;
        container.replaceChildren();
        if (!definitions.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No rating scales yet. Create a scale for sessions, tasks, or days.';
            container.appendChild(empty);
        }
        for (const definition of definitions) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'rating-admin-card';
            const title = document.createElement('strong');
            title.textContent = definition.name;
            const context = document.createElement('span');
            context.className = 'rating-admin-meta';
            context.textContent = `${definition.target_type} · ${definition.is_required ? 'Essential' : 'Optional'} · ${definition.min_score} to ${definition.max_score}`;
            const description = document.createElement('span');
            description.textContent = definition.description || 'No description provided';
            card.append(title, context, description);
            card.addEventListener('click', () => openEditRatingDefModal(definition.id));
            container.appendChild(card);
        }
        ratingAdminStatus('rating_defs_status', ratingDefinitionsNotice);
        ratingDefinitionsNotice = '';
    } catch (error) {
        if (generation !== ratingDefinitionsGeneration) return;
        ratingAdminStatus('rating_defs_status', `${ratingDefinitionsNotice}Could not refresh rating scales. Last loaded scales are retained. Retry refresh reads only.`);
        if (retry) retry.hidden = false;
        if (editorRetry) editorRetry.hidden = false;
    } finally {
        if (generation === ratingDefinitionsGeneration) container.setAttribute('aria-busy', 'false');
    }
}

function ratingDefinitionFields() {
    return ['name', 'target_type', 'min', 'max', 'required', 'desc'].map(name => document.getElementById(`modal_rating_${name}`));
}

function ratingDefinitionSnapshot() {
    return JSON.stringify(ratingDefinitionFields().map(field => field.type === 'checkbox' ? field.checked : field.value));
}

function setRatingDefinitionPending(owner, pending) {
    owner.pending = pending;
    if (ratingDefinitionEditor !== owner) return;
    for (const id of ['modal_rating_save_btn', 'modal_rating_delete_btn']) {
        const button = document.getElementById(id);
        if (button) button.disabled = pending;
    }
}

function openNewRatingDefModal() {
    openRatingDefinitionEditor(null);
}

function openEditRatingDefModal(id) {
    const definition = allRatingDefinitions.find(item => item.id === id);
    if (definition) openRatingDefinitionEditor(definition);
}

function openRatingDefinitionEditor(definition) {
    const modal = document.getElementById('rating_def_modal');
    const launcher = modal.contains(document.activeElement)
        ? ratingDefinitionEditor?.launcher : document.activeElement;
    const owner = {launcher, pending: false};
    ratingDefinitionEditor = owner;
    document.getElementById('edit_rating_def_id').value = definition?.id || '';
    document.getElementById('rating_modal_title').innerText = definition ? 'Edit Rating Scale' : 'Configure Rating Scale';
    document.getElementById('modal_rating_name').value = definition?.name || '';
    const context = document.getElementById('modal_rating_target_type');
    if (context.ratingTemporaryOption) {
        context.removeChild(context.ratingTemporaryOption);
        context.ratingTemporaryOption = null;
    }
    // Preserve a context created by another existing API consumer; do not silently replace it.
    if (definition && !['session', 'task', 'day'].includes(definition.target_type)) {
        const option = document.createElement('option');
        option.value = definition.target_type;
        option.textContent = definition.target_type;
        context.appendChild(option);
        context.ratingTemporaryOption = option;
    }
    context.value = definition?.target_type ?? 'session';
    document.getElementById('modal_rating_min').value = definition?.min_score ?? '1';
    document.getElementById('modal_rating_max').value = definition?.max_score ?? '10';
    document.getElementById('modal_rating_required').checked = definition?.is_required || false;
    document.getElementById('modal_rating_desc').value = definition?.description || '';
    const deleteButton = document.getElementById('modal_rating_delete_btn');
    if (definition) deleteButton.classList.remove('hidden');
    else deleteButton.classList.add('hidden');
    modal.classList.remove('hidden');
    setRatingDefinitionPending(owner, false);
    ratingAdminStatus('rating_def_status', '');
    const editorRetry = document.getElementById('rating_def_refresh_btn');
    if (editorRetry) editorRetry.hidden = document.getElementById('rating_defs_retry_btn')?.hidden !== false;
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('rating_def_modal');
    // Synchronous focus cannot run later over typing or a newer editor.
    document.getElementById('modal_rating_name').focus();
}

function closeRatingDefModal(stableFocus = false) {
    const owner = ratingDefinitionEditor;
    if (!owner) return;
    ratingDefinitionEditor = null;
    document.getElementById('rating_def_modal').classList.add('hidden');
    const candidates = [stableFocus ? null : owner.launcher, document.getElementById('rating_defs_new_btn'),
        document.getElementById('rev_tab_btn_ratings_config')];
    const target = candidates.find(element => element?.isConnected && !element.closest?.('.hidden'));
    if (target) target.focus();
}

async function saveRatingDefinition() {
    const owner = ratingDefinitionEditor;
    if (!owner || owner.pending) return;
    const id = document.getElementById('edit_rating_def_id').value;
    const payload = {
        name: document.getElementById('modal_rating_name').value.trim(),
        target_type: document.getElementById('modal_rating_target_type').value,
        min_score: Number(document.getElementById('modal_rating_min').value),
        max_score: Number(document.getElementById('modal_rating_max').value),
        is_required: document.getElementById('modal_rating_required').checked,
        description: document.getElementById('modal_rating_desc').value.trim()
    };
    if (!payload.name || !['min', 'max'].every(bound => {
        const input = document.getElementById(`modal_rating_${bound}`);
        return input.value.trim() !== '' && Number.isInteger(payload[`${bound}_score`]);
    })) {
        ratingAdminStatus('rating_def_status', 'Enter a name and whole-number bounds. Zero and negative bounds are supported.');
        return;
    }
    const snapshot = ratingDefinitionSnapshot();
    const checkpoint = typeof settingsDraftCheckpoint === 'function'
        ? settingsDraftCheckpoint('rating_def_modal') : () => {};
    setRatingDefinitionPending(owner, true);
    ratingAdminStatus('rating_def_status', 'Saving… You can keep editing; only submitted fields will be saved.');
    let saved;
    try {
        saved = id ? await api.put(`/rating-definitions/${encodeURIComponent(id)}`, payload)
            : await api.post('/rating-definitions', payload);
    } catch (error) {
        if (ratingDefinitionEditor === owner) {
            ratingAdminStatus('rating_def_status', 'Save was not confirmed. Your draft is retained. If the connection was lost, refresh the list and check before retrying Save.');
            const retry = document.getElementById('rating_def_refresh_btn');
            if (retry) retry.hidden = false;
        }
        return;
    } finally {
        setRatingDefinitionPending(owner, false);
    }
    ratingDefinitionsGeneration++;
    if (ratingDefinitionEditor === owner) {
        const unchanged = ratingDefinitionSnapshot() === snapshot;
        checkpoint();
        if (!id && saved?.id) {
            document.getElementById('edit_rating_def_id').value = saved.id;
            if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('rating_def_modal', '#edit_rating_def_id');
            document.getElementById('modal_rating_delete_btn').classList.remove('hidden');
            document.getElementById('rating_modal_title').innerText = 'Edit Rating Scale';
        }
        if (unchanged) closeRatingDefModal(true);
        else ratingAdminStatus('rating_def_status', 'Submitted changes saved. Newer edits remain unsaved.');
    }
    ratingDefinitionsNotice = 'Rating scale saved. ';
    await loadRatingDefinitionsList();
}

async function deleteRatingDefinition() {
    const owner = ratingDefinitionEditor;
    const id = document.getElementById('edit_rating_def_id').value;
    if (!id || !owner || owner.pending) return;
    setRatingDefinitionPending(owner, true);
    try {
        const confirmed = await showCustomConfirm('Delete Rating Definition', 'Are you sure you want to delete this custom rating scale? Attached rating entries will also be removed.');
        if (!confirmed || ratingDefinitionEditor !== owner) return;
        await api.delete(`/rating-definitions/${encodeURIComponent(id)}`);
    } catch (error) {
        if (ratingDefinitionEditor === owner) {
            ratingAdminStatus('rating_def_status', 'Deletion was not confirmed. Refresh the list and check before retrying.');
            const retry = document.getElementById('rating_def_refresh_btn');
            if (retry) retry.hidden = false;
        }
        return;
    } finally {
        setRatingDefinitionPending(owner, false);
    }
    ratingDefinitionsGeneration++;
    if (ratingDefinitionEditor === owner) closeRatingDefModal(true);
    ratingDefinitionsNotice = 'Rating scale deleted. ';
    await loadRatingDefinitionsList();
}

// Capture dialog shortcuts before Revision or shared handlers can reach an underlying editor.
document.addEventListener?.('keydown', event => {
    const modal = document.getElementById('rating_def_modal');
    const higherPrompt = ['custom_confirm_modal', 'recurring_resize_modal', 'idle_resolution_modal',
        'completion_policy_modal', 'recurring_delete_modal'].some(id => {
        const prompt = document.getElementById(id);
        return prompt && !prompt.classList.contains('hidden');
    });
    const focusedEditor = ['task_modal', 'session_modal'].some(id => {
        const editor = document.getElementById(id);
        return editor && !editor.classList.contains('hidden') && editor.contains(document.activeElement);
    });
    if (!ratingDefinitionEditor || modal.classList.contains('hidden') || higherPrompt || focusedEditor) return;
    if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRatingDefModal();
    } else if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveRatingDefinition();
    } else if (event.key === 'Tab') {
        const fields = [...modal.querySelectorAll('button:not(:disabled), input:not([type="hidden"]), select, textarea')]
            .filter(field => !field.closest('.hidden, [hidden]'));
        const index = fields.indexOf(document.activeElement);
        if (fields.length && (index < 0 || (event.shiftKey ? index === 0 : index === fields.length - 1))) {
            event.preventDefault();
            fields[event.shiftKey ? fields.length - 1 : 0].focus();
        }
    }
}, true);

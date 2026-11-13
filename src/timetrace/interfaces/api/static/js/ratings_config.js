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
            <input type="range" min="${d.min_score}" max="${d.max_score}" value="${score}" ${dismissed ? 'disabled' : ''}
                id="rating_range_input_${key}" oninput="onRatingRangeInput('${key}', ${d.min_score}, ${d.max_score})" class="custom-rating-input w-full accent-purple-600">
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
    label.className = typeof getGradeColorClasses === 'function'
        ? getGradeColorClasses(input.value, minScore, maxScore).text : 'text-purple-400';
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
            alert('A rating definition is unavailable. Discard drafts or restore it and Refresh before saving.');
            return false;
        }
        if (input && !input.disabled && (Number(input.value) < Number(input.min) || Number(input.value) > Number(input.max)
            || input.type === 'number' && (input.value === '' || !Number.isInteger(Number(input.value))))) {
            alert('A rating draft is outside its current scale. Adjust the value or dismiss it before saving.');
            return false;
        }
        if (card.getAttribute('data-required') === 'true' && input && !input.disabled && input.value === '') {
            alert('Please complete essential rating.');
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

async function loadRatingDefinitionsList() {
    const container = document.getElementById('rating_defs_card_list');
    if (!container) return;

    try {
        allRatingDefinitions = await api.get('/rating-definitions') || [];

        if (allRatingDefinitions.length === 0) {
            container.innerHTML = '<div class="text-xs text-slate-500 text-center py-8">No custom rating definitions created yet. Click "+ New Rating Scale" to create your first evaluation metric!</div>';
            return;
        }

        container.innerHTML = allRatingDefinitions.map(d => `
            <div onclick="openEditRatingDefModal('${d.id}')" class="rev-card flex items-center justify-between hover:border-purple-500 cursor-pointer transition">
                <div class="space-y-1">
                    <div class="flex items-center space-x-2">
                        <span class="font-bold text-sm text-white">${d.name}</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-900/60 text-purple-300 border border-purple-800">${d.target_type}</span>
                        ${d.is_required ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-950/80 text-red-400 border border-red-800">Essential</span>' : '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400">Optional</span>'}
                    </div>
                    <p class="text-xs text-slate-400">${d.description || 'No description provided'}</p>
                </div>
                <div class="flex items-center space-x-4">
                    <span class="font-mono text-xs font-bold text-purple-300 bg-[#0f1016] px-2.5 py-1 rounded border border-[var(--border-muted)]">Scale: ${d.min_score} - ${d.max_score}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error("Failed to load rating definitions:", e);
    }
}

function openNewRatingDefModal() {
    document.getElementById('edit_rating_def_id').value = '';
    document.getElementById('rating_modal_title').innerText = 'Configure Rating Scale';
    document.getElementById('modal_rating_name').value = '';
    document.getElementById('modal_rating_target_type').value = 'session';
    document.getElementById('modal_rating_min').value = '1';
    document.getElementById('modal_rating_max').value = '10';
    document.getElementById('modal_rating_required').checked = false;
    document.getElementById('modal_rating_desc').value = '';
    document.getElementById('modal_rating_delete_btn').classList.add('hidden');
    document.getElementById('rating_def_modal').classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('rating_def_modal');

    setTimeout(() => {
        const nameInput = document.getElementById('modal_rating_name');
        if (nameInput) nameInput.focus();
    }, 50);
}

function openEditRatingDefModal(id) {
    const d = allRatingDefinitions.find(item => item.id === id);
    if (!d) return;

    document.getElementById('edit_rating_def_id').value = d.id;
    document.getElementById('rating_modal_title').innerText = 'Edit Rating Scale';
    document.getElementById('modal_rating_name').value = d.name;
    document.getElementById('modal_rating_target_type').value = d.target_type;
    document.getElementById('modal_rating_min').value = d.min_score;
    document.getElementById('modal_rating_max').value = d.max_score;
    document.getElementById('modal_rating_required').checked = d.is_required;
    document.getElementById('modal_rating_desc').value = d.description || '';
    document.getElementById('modal_rating_delete_btn').classList.remove('hidden');
    document.getElementById('rating_def_modal').classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('rating_def_modal');

    setTimeout(() => {
        const nameInput = document.getElementById('modal_rating_name');
        if (nameInput) nameInput.focus();
    }, 50);
}

function closeRatingDefModal() {
    document.getElementById('rating_def_modal').classList.add('hidden');
}

async function saveRatingDefinition() {
    const id = document.getElementById('edit_rating_def_id').value;
    const payload = {
        name: document.getElementById('modal_rating_name').value.trim(),
        target_type: document.getElementById('modal_rating_target_type').value,
        min_score: parseInt(document.getElementById('modal_rating_min').value) || 1,
        max_score: parseInt(document.getElementById('modal_rating_max').value) || 10,
        is_required: document.getElementById('modal_rating_required').checked,
        description: document.getElementById('modal_rating_desc').value.trim()
    };

    if (!payload.name) return;

    if (id) {
        await api.put(`/rating-definitions/${id}`, payload);
    } else {
        await api.post('/rating-definitions', payload);
    }

    closeRatingDefModal();
    loadRatingDefinitionsList();
}

async function deleteRatingDefinition() {
    const id = document.getElementById('edit_rating_def_id').value;
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Rating Definition", "Are you sure you want to delete this custom rating scale? Attached rating entries will also be removed.");
    if (confirmed) {
        await api.delete(`/rating-definitions/${id}`);
        closeRatingDefModal();
        loadRatingDefinitionsList();
    }
}

/**
 * Custom Rating Definitions & Entry Binding Engine
 */

async function renderCustomRatingsInputs(targetType, targetId, containerId, existingEntries = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const defs = await api.get(`/api/v1/rating-definitions?target_type=${targetType}`) || [];

    if (!defs || defs.length === 0) {
        container.innerHTML = '';
        return;
    }

    const existingMap = {};
    const dismissedMap = {};
    if (existingEntries) {
        existingEntries.forEach(e => {
            existingMap[e.rating_definition_id] = e.score;
            dismissedMap[e.rating_definition_id] = e.dismissed === true;
        });
    }

    container.innerHTML = `
        <div class="text-xs font-bold text-slate-300 mb-2 border-b border-[var(--border-muted)] pb-1">Custom Ratings (${targetType.toUpperCase()})</div>
        ${defs.map(d => {
            const isDismissed = dismissedMap[d.id] === true;
            const currentScore = existingMap[d.id] !== undefined && existingMap[d.id] !== null ? existingMap[d.id] : Math.ceil((d.min_score + d.max_score) / 2);
            return `
                <div class="bg-[#0f1016] p-2.5 rounded-lg border border-[var(--border-muted)] space-y-1.5" data-rating-def-id="${d.id}" data-required="${d.is_required}">
                    <div class="flex justify-between items-center text-xs">
                        <span class="font-bold text-slate-200">${d.name} ${d.is_required ? '<span class="text-red-400">*</span>' : ''}</span>
                        <div class="flex items-center space-x-2">
                            <span id="score_label_${d.id}" class="font-mono ${isDismissed ? 'text-slate-500' : 'text-purple-400'} font-bold">${isDismissed ? 'Dismissed' : `${currentScore} / ${d.max_score}`}</span>
                            <button type="button" onclick="toggleDismissRatingInput(${d.id}, ${d.max_score})" id="dismiss_btn_${d.id}" class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDismissed ? 'bg-purple-900/60 text-purple-300 border border-purple-700' : 'bg-slate-800 text-slate-400 hover:text-white'}">${isDismissed ? 'Undismiss' : 'Dismiss'}</button>
                        </div>
                    </div>
                    ${d.description ? `<p class="text-[10px] text-slate-400">${d.description}</p>` : ''}
                    <input type="range" min="${d.min_score}" max="${d.max_score}" value="${currentScore}" ${isDismissed ? 'disabled' : ''} id="rating_range_input_${d.id}" oninput="document.getElementById('score_label_${d.id}').innerText = this.value + ' / ${d.max_score}'; if(typeof markDayFormDirty === 'function') markDayFormDirty();" class="custom-rating-input w-full accent-purple-600 ${isDismissed ? 'opacity-30 cursor-not-allowed' : ''}">
                </div>
            `;
        }).join('')}
    `;
}

function toggleDismissRatingInput(defId, maxScore) {
    const input = document.getElementById(`rating_range_input_${defId}`);
    const label = document.getElementById(`score_label_${defId}`);
    const btn = document.getElementById(`dismiss_btn_${defId}`);
    if (!input || !label || !btn) return;

    const isCurrentlyDismissed = input.disabled;
    if (isCurrentlyDismissed) {
        input.disabled = false;
        input.classList.remove('opacity-30', 'cursor-not-allowed');
        label.innerText = `${input.value} / ${maxScore}`;
        label.className = "font-mono text-purple-400 font-bold";
        btn.innerText = "Dismiss";
        btn.className = "px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 hover:text-white";
    } else {
        input.disabled = true;
        input.classList.add('opacity-30', 'cursor-not-allowed');
        label.innerText = "Dismissed";
        label.className = "font-mono text-slate-500 font-bold";
        btn.innerText = "Undismiss";
        btn.className = "px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-900/60 text-purple-300 border border-purple-700";
    }

    if (typeof markDayFormDirty === 'function') markDayFormDirty();
}

function validateRequiredCustomRatings(targetType, targetId) {
    const inputs = document.querySelectorAll(`[data-rating-def-id]`);
    for (let el of inputs) {
        const isReq = el.getAttribute('data-required') === 'true';
        const input = el.querySelector('.custom-rating-input');
        const isDismissed = input ? input.disabled : false;
        if (isReq && !isDismissed && input && (!input.value || input.value === '')) {
            alert(`Please complete essential rating: ${el.querySelector('.font-bold').innerText}`);
            return false;
        }
    }
    return true;
}

async function submitCustomRatings(targetType, targetId) {
    const cards = document.querySelectorAll(`[data-rating-def-id]`);
    for (let card of cards) {
        const defId = parseInt(card.getAttribute('data-rating-def-id'));
        const input = card.querySelector('.custom-rating-input');
        if (input) {
            const isDismissed = input.disabled;
            const parsedScore = parseInt(input.value);
            await api.post('/api/v1/rating-entries', {
                rating_definition_id: defId,
                target_type: targetType,
                target_id: String(targetId),
                score: isDismissed || isNaN(parsedScore) ? 0 : parsedScore,
                dismissed: isDismissed
            });
        }
    }
}

async function loadRatingDefinitionsList() {
    const container = document.getElementById('rating_defs_card_list');
    if (!container) return;

    try {
        allRatingDefinitions = await api.get('/api/v1/rating-definitions') || [];

        if (allRatingDefinitions.length === 0) {
            container.innerHTML = '<div class="text-xs text-slate-500 text-center py-8">No custom rating definitions created yet. Click "+ New Rating Scale" to create your first evaluation metric!</div>';
            return;
        }

        container.innerHTML = allRatingDefinitions.map(d => `
            <div onclick="openEditRatingDefModal(${d.id})" class="rev-card flex items-center justify-between hover:border-purple-500 cursor-pointer transition">
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
        await api.put(`/api/v1/rating-definitions/${id}`, payload);
    } else {
        await api.post('/api/v1/rating-definitions', payload);
    }

    closeRatingDefModal();
    loadRatingDefinitionsList();
}

async function deleteRatingDefinition() {
    const id = document.getElementById('edit_rating_def_id').value;
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Rating Definition", "Are you sure you want to delete this custom rating scale? Attached rating entries will also be removed.");
    if (confirmed) {
        await api.delete(`/api/v1/rating-definitions/${id}`);
        closeRatingDefModal();
        loadRatingDefinitionsList();
    }
}

function roundVal(val, decimals) {
    return Number(Math.round(val + 'e' + decimals) + 'e-' + decimals);
}

/**
 * TimeTrace AI Assistant -- draft batch / item rendering + accept/reject/undo/reapply.
 *
 * Every string that could have come from the model (titles, notes, rationale, error text) is
 * set via `textContent`, never `innerHTML` (spec S9.5) -- this is the one prompt-injectable
 * surface in the app. Ids are UUIDv7 strings: no parseInt, no numeric sort, no unquoted id in an
 * inline onclick -- every handler here is wired with addEventListener + dataset (spec S9.6).
 */

const AI_UI_KIND_LABELS = {
    move: 'MOVE',
    resize: 'RESIZE',
    split: 'SPLIT',
    add: 'ADD',
    remove: 'REMOVE',
    review: 'REVIEW'
};

function aiFormatLocalDt(raw) {
    if (!raw) return '';
    try {
        const dt = typeof parseApiDateTime === 'function' ? parseApiDateTime(raw) : new Date(raw);
        if (!dt || isNaN(dt.getTime())) return String(raw);
        const pad = (n) => String(n).padStart(2, '0');
        return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    } catch (e) {
        return String(raw);
    }
}

function aiDescribeDraftItem(item) {
    const proposed = item.proposed || {};
    const baseline = item.baseline || {};
    const parts = [];

    if (item.entity_type === 'session') {
        // Prefer the server-computed display_title (resolves the session's real task title);
        // fall back to the old tag/notes chain (tags before notes, matching the real calendar's
        // convention in static/js/calendar.js: `s.tags || s.notes || 'Session'`) if absent.
        const title = item.display_title || proposed.tags || proposed.notes || baseline.tags || baseline.notes || '(untitled session)';
        parts.push(title);
        const start = proposed.start_time || baseline.start_time;
        const end = proposed.end_time || baseline.end_time;
        if (start) {
            parts.push(`${aiFormatLocalDt(start)}${end ? ' -> ' + aiFormatLocalDt(end) : ''}`);
        }
    } else if (item.entity_type === 'task') {
        parts.push(item.display_title || proposed.title || baseline.title || '(untitled task)');
    } else if (item.entity_type === 'day_review') {
        const date = proposed.date_str || baseline.date_str || item.target_id || 'Day review';
        const rating = proposed.rating == null ? '' : `rating ${proposed.rating}/5`;
        parts.push(date);
        if (rating) parts.push(rating);
        const highlights = typeof proposed.highlights === 'string' ? proposed.highlights.trim() : '';
        const friction = typeof proposed.friction === 'string' ? proposed.friction.trim() : '';
        if (highlights) parts.push(`Highlights: ${highlights}`);
        if (friction) parts.push(`Friction: ${friction}`);
    } else {
        parts.push(item.entity_type || 'item');
    }
    return parts;
}

function aiBadgeForItem(item) {
    const kind = item.entity_type === 'day_review' ? 'review' : (item.ui_kind || item.op);
    const badge = document.createElement('span');
    const cls = AI_UI_KIND_LABELS[kind] ? kind : (item.op || 'add');
    badge.className = `ai-badge ai-badge-${cls}`;
    badge.textContent = AI_UI_KIND_LABELS[kind] || (item.op || '').toUpperCase();
    return badge;
}

function aiBuildDraftItemNode(item, batch, options) {
    const opts = options || {};
    const row = document.createElement('div');
    row.className = 'ai-draft-item';
    if (item.status === 'failed') row.classList.add('ai-draft-item-failed');
    else if (item.is_stale) row.classList.add('ai-draft-item-stale');
    if (item.status === 'applied') row.classList.add('ai-draft-item-applied');
    if (item.group_key && opts.tieGroups && opts.tieGroups.has(item.group_key)) {
        row.classList.add('ai-group-tie');
    }
    row.dataset.itemId = item.id;

    if (opts.selectable && item.status === 'pending') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ai-item-checkbox mt-0.5';
        checkbox.dataset.itemId = item.id;
        checkbox.checked = true;
        row.appendChild(checkbox);
    }

    const body = document.createElement('div');
    body.className = 'ai-draft-item-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center gap-1.5';
    titleRow.appendChild(aiBadgeForItem(item));
    const titleSpan = document.createElement('span');
    titleSpan.className = 'ai-draft-item-title';
    const descriptionParts = aiDescribeDraftItem(item);
    const [titleText] = descriptionParts;
    titleSpan.textContent = titleText;
    titleRow.appendChild(titleSpan);
    body.appendChild(titleRow);

    const metaText = descriptionParts.slice(1).join(' · ');
    if (metaText) {
        const meta = document.createElement('div');
        meta.className = 'ai-draft-item-meta';
        meta.textContent = metaText;
        body.appendChild(meta);
    }

    if (item.rationale) {
        const rationale = document.createElement('div');
        rationale.className = 'ai-draft-item-rationale';
        rationale.textContent = item.rationale;
        body.appendChild(rationale);
    }

    if (item.is_stale && item.status === 'pending') {
        const flag = document.createElement('div');
        flag.className = 'ai-draft-item-flag ai-draft-item-flag-stale';
        flag.textContent = 'Stale -- underlying item changed since this was proposed';
        body.appendChild(flag);
    }
    if (item.error) {
        const flag = document.createElement('div');
        flag.className = 'ai-draft-item-flag ai-draft-item-flag-error';
        flag.textContent = item.error;
        body.appendChild(flag);
    }

    if (opts.showItemActions && item.status === 'pending') {
        const actions = document.createElement('div');
        actions.className = 'flex gap-1 mt-1';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'ai-btn-item';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => aiToggleInlineEdit(row, item, batch));
        actions.appendChild(editBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'ai-btn-item';
        rejectBtn.textContent = 'Reject';
        rejectBtn.addEventListener('click', async () => {
            if (aiPendingDraftActions.has(batch.id)) return;
            aiPendingDraftActions.add(batch.id);
            rejectBtn.disabled = true;
            try {
                const result = await api.post(`/api/ai/drafts/items/${encodeURIComponent(item.id)}/reject`, {});
                const actionResult = {items: [{
                    item_id: result.id || item.id,
                    status: result.status || 'rejected',
                    error: result.error || null,
                    applied_entity_id: result.applied_entity_id || null
                }]};
                aiDraftActionResults.set(batch.id, actionResult);
                aiRenderDraftActionResults(row.closest?.('.ai-draft-batch') || row.parentNode, actionResult);
                const reads = [];
                const startRead = read => reads.push(Promise.resolve().then(read));
                startRead(() => aiRefreshCurrentBatchView(batch.id));
                if (typeof loadAiDraftOverlay === 'function') startRead(() => loadAiDraftOverlay());
                if (typeof refreshAiStatusBadge === 'function') startRead(() => refreshAiStatusBadge());
                if (typeof options.onChanged === 'function') startRead(() => options.onChanged());
                await Promise.allSettled(reads);
            } catch (err) {
                console.error('Failed to reject draft item:', err);
                aiUnconfirmedDraftActions.add(batch.id);
                let batchCard = row;
                while (batchCard && !batchCard.classList.contains('ai-draft-batch')) batchCard = batchCard.parentNode;
                if (batchCard) aiSetDraftReadFailure(batchCard, batch.id);
            }
        });
        actions.appendChild(rejectBtn);

        body.appendChild(actions);
    }

    row.appendChild(body);
    return row;
}

/** ISO datetime (possibly with a +00:00/Z suffix) -> the local-time string a `datetime-local`
 * input expects (`YYYY-MM-DDTHH:MM`, no timezone -- the browser treats that as local wall-clock,
 * matching how the rest of this app displays times, e.g. `aiFormatLocalDt`). */
function aiIsoToDatetimeLocalValue(iso) {
    if (!iso) return '';
    const dt = typeof parseApiDateTime === 'function' ? parseApiDateTime(iso) : new Date(iso);
    if (!dt || isNaN(dt.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** The reverse: a `datetime-local` input's local-time value -> a UTC ISO string for the API. */
function aiDatetimeLocalValueToIso(value) {
    if (!value) return null;
    const dt = new Date(value); // no timezone suffix -> the browser parses this as local time
    return isNaN(dt.getTime()) ? null : dt.toISOString();
}

function aiAddEditField(container, label, inputEl) {
    const field = document.createElement('label');
    field.className = 'ai-edit-field';
    const span = document.createElement('span');
    span.textContent = label;
    field.appendChild(span);
    field.appendChild(inputEl);
    container.appendChild(field);
}

let aiDraftEditorSequence = 0;
const aiPendingDraftEditors = new WeakSet();

/** Structured edit form for a pending draft item -- session and task proposals get their real
 * fields (datetime pickers, a task dropdown, a priority select), never a raw JSON textarea.
 * `PATCH /drafts/items/{id}` MERGES `proposed` into the existing snapshot (never replaces it
 * wholesale), so this only needs to send the fields the form actually edits. */
function aiToggleInlineEdit(row, item, batch) {
    let editBox = row.querySelector('.ai-inline-edit-box');
    if (editBox) {
        editBox.remove();
        return;
    }
    editBox = document.createElement('div');
    editBox.className = 'ai-inline-edit-box mt-1.5 pt-1.5';
    editBox.id = `ai_draft_editor_${++aiDraftEditorSequence}`;

    const proposed = item.proposed || {};
    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'ai-edit-fields';
    const collectors = [];

    // Confirmed live (adversarial review): PATCH /drafts/items/{id} MERGES `proposed` into the
    // existing snapshot, so unconditionally sending every field -- including ones the model
    // never proposed -- either silently wipes a field that WAS proposed alongside it (e.g. a
    // move-only proposal has no `notes`/`tags` key; sending `notes: ''` erases real notes on
    // accept) or violates a NOT NULL column (a tags-only proposal has no `start_time`/`end_time`;
    // sending them as null 500s the accept). A field not part of the original proposal is
    // disabled here rather than silently ignored on save, so the user isn't left wondering why
    // an edit they typed didn't take -- add it directly on the task/session after accepting.
    const hasField = (key) => Object.prototype.hasOwnProperty.call(proposed, key);
    const addCollector = (key, getter) => {
        if (hasField(key)) collectors.push(() => [key, getter()]);
    };
    const markUneditable = (el, key) => {
        if (hasField(key)) return;
        el.disabled = true;
        el.title = 'Not part of the original proposal -- edit this after accepting instead.';
    };

    if (item.entity_type === 'session') {
        const startInput = document.createElement('input');
        startInput.type = 'datetime-local';
        startInput.value = aiIsoToDatetimeLocalValue(proposed.start_time);
        markUneditable(startInput, 'start_time');
        aiAddEditField(fieldsWrap, 'Start', startInput);
        addCollector('start_time', () => aiDatetimeLocalValueToIso(startInput.value));

        const endInput = document.createElement('input');
        endInput.type = 'datetime-local';
        endInput.value = aiIsoToDatetimeLocalValue(proposed.end_time);
        markUneditable(endInput, 'end_time');
        aiAddEditField(fieldsWrap, 'End', endInput);
        addCollector('end_time', () => aiDatetimeLocalValueToIso(endInput.value));

        const taskSelect = document.createElement('select');
        taskSelect.disabled = true;
        const noneOpt = document.createElement('option');
        noneOpt.value = proposed.task_id || '';
        noneOpt.textContent = 'Loading tasks...';
        taskSelect.appendChild(noneOpt);
        taskSelect.value = proposed.task_id || '';
        aiAddEditField(fieldsWrap, 'Task', taskSelect);
        addCollector('task_id', () => taskSelect.value || null);
        const taskStatus = document.createElement('div');
        taskStatus.className = 'ai-draft-task-options-status';
        fieldsWrap.appendChild(taskStatus);
        let taskReadGeneration = 0;
        const loadDraftTaskOptions = async () => {
            const request = ++taskReadGeneration;
            const selected = taskSelect.value || proposed.task_id || '';
            taskSelect.disabled = true;
            taskStatus.textContent = 'Loading task options…';
            try {
                const tasks = await api.get('/api/tasks');
                if (request !== taskReadGeneration || (typeof editBox.isConnected === 'boolean' && !editBox.isConnected)) return;
                taskSelect.textContent = '';
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = '(no task)';
                taskSelect.appendChild(emptyOpt);
                (tasks || []).forEach((task) => {
                    const option = document.createElement('option');
                    option.value = task.id;
                    option.textContent = task.title;
                    taskSelect.appendChild(option);
                });
                if (selected && !(tasks || []).some(task => task.id === selected)) {
                    const fallback = document.createElement('option');
                    fallback.value = selected;
                    const known = typeof taskKnowledge !== 'undefined' && typeof taskKnowledge.get === 'function'
                        ? taskKnowledge.get(selected) : null;
                    fallback.textContent = known?.title || `(task ${selected})`;
                    taskSelect.appendChild(fallback);
                }
                taskSelect.value = selected;
                taskSelect.disabled = !hasField('task_id');
                taskStatus.textContent = '';
            } catch (err) {
                if (request !== taskReadGeneration || (typeof editBox.isConnected === 'boolean' && !editBox.isConnected)) return;
                console.error('Failed to load tasks for the draft-item edit form:', err);
                taskSelect.textContent = '';
                const unavailable = document.createElement('option');
                unavailable.value = selected;
                const known = selected && typeof taskKnowledge !== 'undefined' && typeof taskKnowledge.get === 'function'
                    ? taskKnowledge.get(selected) : null;
                unavailable.textContent = known?.title || (selected ? `(task ${selected})` : '(no task)');
                taskSelect.appendChild(unavailable);
                taskStatus.textContent = 'Task options could not load. The selected task is unchanged.';
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'ai-btn-item';
                retry.textContent = 'Retry task options';
                retry.addEventListener('click', loadDraftTaskOptions);
                taskStatus.appendChild(retry);
            }
        };
        loadDraftTaskOptions();
        markUneditable(taskSelect, 'task_id');

        const notesInput = document.createElement('input');
        notesInput.type = 'text';
        notesInput.value = proposed.notes || '';
        markUneditable(notesInput, 'notes');
        aiAddEditField(fieldsWrap, 'Notes', notesInput);
        addCollector('notes', () => notesInput.value);

        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.value = proposed.tags || '';
        markUneditable(tagsInput, 'tags');
        aiAddEditField(fieldsWrap, 'Tags', tagsInput);
        addCollector('tags', () => tagsInput.value);
    } else if (item.entity_type === 'day_review') {
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = proposed.date_str || item.target_id || '';
        dateInput.readOnly = true;
        dateInput.title = 'The review date is fixed for this proposal.';
        aiAddEditField(fieldsWrap, 'Date', dateInput);

        const ratingSelect = document.createElement('select');
        [1, 2, 3, 4, 5].forEach((rating) => {
            const opt = document.createElement('option');
            opt.value = String(rating);
            opt.textContent = `${rating}/5`;
            if (Number(proposed.rating) === rating) opt.selected = true;
            ratingSelect.appendChild(opt);
        });
        aiAddEditField(fieldsWrap, 'Rating', ratingSelect);
        addCollector('rating', () => Number(ratingSelect.value));

        const highlightsInput = document.createElement('textarea');
        highlightsInput.rows = 3;
        highlightsInput.value = proposed.highlights || '';
        aiAddEditField(fieldsWrap, 'Highlights', highlightsInput);
        addCollector('highlights', () => highlightsInput.value);

        const frictionInput = document.createElement('textarea');
        frictionInput.rows = 3;
        frictionInput.value = proposed.friction || '';
        aiAddEditField(fieldsWrap, 'Friction', frictionInput);
        addCollector('friction', () => frictionInput.value);

        const notesInput = document.createElement('textarea');
        notesInput.rows = 3;
        notesInput.value = proposed.notes || '';
        aiAddEditField(fieldsWrap, 'Notes', notesInput);
        addCollector('notes', () => notesInput.value);

        const skippedInput = document.createElement('input');
        skippedInput.type = 'checkbox';
        skippedInput.checked = Boolean(proposed.review_skipped);
        aiAddEditField(fieldsWrap, 'Mark as skipped', skippedInput);
        addCollector('review_skipped', () => skippedInput.checked);
    } else if (item.entity_type === 'task') {
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = proposed.title || '';
        markUneditable(titleInput, 'title');
        aiAddEditField(fieldsWrap, 'Title', titleInput);
        addCollector('title', () => titleInput.value);

        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.value = proposed.tags || '';
        markUneditable(tagsInput, 'tags');
        aiAddEditField(fieldsWrap, 'Tags', tagsInput);
        addCollector('tags', () => tagsInput.value);

        const prioritySelect = document.createElement('select');
        ['-', 'low', 'medium', 'high'].forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p === '-' ? '(none)' : p;
            if (p === (proposed.priority || '-')) opt.selected = true;
            prioritySelect.appendChild(opt);
        });
        markUneditable(prioritySelect, 'priority');
        aiAddEditField(fieldsWrap, 'Priority', prioritySelect);
        addCollector('priority', () => prioritySelect.value);

        const dueInput = document.createElement('input');
        dueInput.type = 'date';
        const dueDt = proposed.due_date
            ? (typeof parseApiDateTime === 'function' ? parseApiDateTime(proposed.due_date) : new Date(proposed.due_date))
            : null;
        if (dueDt && !isNaN(dueDt.getTime())) {
            const pad = (n) => String(n).padStart(2, '0');
            dueInput.value = `${dueDt.getFullYear()}-${pad(dueDt.getMonth() + 1)}-${pad(dueDt.getDate())}`;
        }
        markUneditable(dueInput, 'due_date');
        aiAddEditField(fieldsWrap, 'Due date', dueInput);
        addCollector('due_date', () => (dueInput.value ? new Date(dueInput.value).toISOString() : null));

        const estInput = document.createElement('input');
        estInput.type = 'number';
        estInput.min = '0';
        estInput.value = proposed.estimated_minutes != null ? proposed.estimated_minutes : '';
        markUneditable(estInput, 'estimated_minutes');
        aiAddEditField(fieldsWrap, 'Estimate (minutes)', estInput);
        addCollector('estimated_minutes', () => (estInput.value ? parseInt(estInput.value, 10) : null));
    }
    editBox.appendChild(fieldsWrap);

    const hint = document.createElement('div');
    hint.className = 'ai-quickadd-hint';
    hint.textContent = 'Edit the proposed fields, then Save.';
    editBox.appendChild(hint);

    const btnRow = document.createElement('div');
    btnRow.className = 'flex gap-1 mt-1';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ai-btn-item';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        if (aiPendingDraftEditors.has(editBox) || aiPendingDraftActions.has(batch.id)) return;
        const updates = {};
        collectors.forEach((collect) => {
            const [key, value] = collect();
            updates[key] = value;
        });
        if (updates.start_time && updates.end_time && new Date(updates.end_time) <= new Date(updates.start_time)) {
            hint.textContent = 'End must be after start -- not saved.';
            hint.style.color = '#f87171';
            return;
        }
        const markSaved = typeof settingsDraftCheckpoint === 'function' ? settingsDraftCheckpoint(editBox) : () => {};
        aiPendingDraftEditors.add(editBox);
        aiPendingDraftActions.add(batch.id);
        saveBtn.disabled = true;
        try {
            await api.request(`/api/ai/drafts/items/${encodeURIComponent(item.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ proposed: updates })
            });
            markSaved();
            if (typeof aiRefreshCurrentBatchView === 'function') await aiRefreshCurrentBatchView(batch.id);
        } catch (err) {
            aiUnconfirmedDraftActions.add(batch.id);
            aiPendingDraftActions.delete(batch.id);
            hint.textContent = 'Save failed: ' + (err.message || err);
            hint.style.color = '#f87171';
            let batchCard = editBox;
            while (batchCard && !batchCard.classList.contains('ai-draft-batch')) batchCard = batchCard.parentNode;
            if (batchCard) {
                aiPendingDraftActions.add(batch.id);
                aiSetDraftReadFailure(batchCard, batch.id);
            }
        } finally {
            aiPendingDraftEditors.delete(editBox);
            saveBtn.disabled = aiPendingDraftActions.has(batch.id);
        }
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ai-btn-item';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => editBox.remove());
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    editBox.appendChild(btnRow);

    row.appendChild(editBox);
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(editBox);
}

function aiBatchStatusBadge(status) {
    const span = document.createElement('span');
    span.className = `ai-batch-status ai-batch-status-${status}`;
    span.textContent = (status || '').replace(/_/g, ' ');
    return span;
}

const aiDraftActionResults = new Map();
const aiPendingDraftActions = new Set();
const aiUnconfirmedDraftActions = new Set();

function aiRenderDraftActionResults(card, result) {
    if (!result || !Array.isArray(result.items) || result.items.length === 0) return;
    const results = document.createElement('div');
    results.className = 'ai-draft-action-results';
    results.setAttribute('role', 'status');
    result.items.forEach((item) => {
        const row = document.createElement('div');
        row.className = `ai-draft-action-result ai-draft-action-result-${item.status || 'unknown'}`;
        if (item.item_id) {
            const proposal = document.createElement('span');
            proposal.textContent = `Proposal item: ${item.item_id}`;
            row.appendChild(proposal);
        }
        const status = document.createElement('strong');
        status.textContent = (item.status || 'unknown').replace(/_/g, ' ');
        row.appendChild(status);
        if (item.error) {
            const error = document.createElement('span');
            error.textContent = item.error;
            row.appendChild(error);
        }
        if (item.applied_entity_id) {
            const identity = document.createElement('span');
            identity.textContent = `Saved item ID: ${item.applied_entity_id}`;
            row.appendChild(identity);
        }
        results.appendChild(row);
    });
    const previous = card.querySelector('.ai-draft-action-results');
    if (previous) previous.remove();
    card.appendChild(results);
}

function aiSetDraftReadFailure(card, batchId) {
    let status = card.querySelector('.ai-draft-read-status');
    if (!status) {
        status = document.createElement('div');
        status.className = 'ai-draft-read-status';
        status.setAttribute('role', 'status');
        card.appendChild(status);
    }
    status.textContent = aiUnconfirmedDraftActions.has(batchId)
        ? 'The action could not be confirmed. Refresh to review its current state before trying again.'
        : 'The action was saved, but this proposal could not refresh. Retry reads only.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'ai-btn-item ai-draft-read-retry';
    retry.textContent = 'Retry refresh';
    retry.addEventListener('click', () => aiRefreshCurrentBatchView(batchId));
    status.appendChild(retry);
}

/**
 * Builds a full draft-batch card (summary + items + action buttons). `options.onChanged` is
 * called after any accept/reject/undo/reapply so the caller can refresh (e.g. re-fetch the
 * batch, update the drafts panel, refresh the calendar overlay).
 */
function aiBuildDraftBatchNode(batch, options) {
    const opts = options || {};
    const card = document.createElement('div');
    card.className = 'ai-draft-batch';
    card.dataset.batchId = batch.id;

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-1';
    const summary = document.createElement('div');
    summary.className = 'ai-draft-batch-summary';
    summary.textContent = batch.summary || batch.intent || `${batch.item_count} proposed change(s)`;
    header.appendChild(summary);
    header.appendChild(aiBatchStatusBadge(batch.status));
    card.appendChild(header);

    const items = batch.items || [];
    const groupCounts = {};
    items.forEach((it) => { if (it.group_key) groupCounts[it.group_key] = (groupCounts[it.group_key] || 0) + 1; });
    const tieGroups = new Set(Object.keys(groupCounts).filter((k) => groupCounts[k] > 1));

    const itemsWrap = document.createElement('div');
    items.forEach((item) => {
        itemsWrap.appendChild(aiBuildDraftItemNode(item, batch, {
            selectable: true,
            showItemActions: true,
            tieGroups,
            onChanged: opts.onChanged
        }));
    });
    card.appendChild(itemsWrap);

    const actions = document.createElement('div');
    actions.className = 'ai-draft-batch-actions';

    const getSelectedItemIds = () => {
        const checked = itemsWrap.querySelectorAll('.ai-item-checkbox:checked');
        const all = itemsWrap.querySelectorAll('.ai-item-checkbox');
        if (checked.length === all.length || all.length === 0) return null; // all == omit filter
        return Array.from(checked).map((cb) => cb.dataset.itemId);
    };

    const runAction = async (fn, changesTasks = true) => {
        if (aiPendingDraftActions.has(batch.id)) return;
        if (typeof aiHistoryUndoPending !== 'undefined' && aiHistoryUndoPending) {
            if (typeof aiNotice === 'function') aiNotice('Undo all is still finishing; wait for history review before another proposal action.');
            return;
        }
        aiPendingDraftActions.add(batch.id);
        actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
        itemsWrap.querySelectorAll('.ai-item-checkbox').forEach(input => { input.disabled = true; });
        let result;
        try {
            result = await fn();
        } catch (err) {
            console.error('AI draft action failed:', err);
            aiUnconfirmedDraftActions.add(batch.id);
            aiSetDraftReadFailure(card, batch.id);
            if (typeof aiNotice === 'function') aiNotice('Could not confirm the proposal action. Refresh to review; Retry reads only.');
            return;
        }
        // The mutation is acknowledged. Keep its item outcomes visible while all display reads
        // start independently; no failed read can turn the write into a replayable retry.
        if (Array.isArray(result?.items) && result.items.length) {
            aiDraftActionResults.set(batch.id, result);
            aiRenderDraftActionResults(card, result);
        }
        const refreshes = [];
        const startRead = read => refreshes.push(Promise.resolve().then(read));
        if (changesTasks && typeof taskKnowledge !== 'undefined' && typeof taskKnowledge.changed === 'function') {
            startRead(() => taskKnowledge.changed());
        }
        startRead(() => aiRefreshCurrentBatchView(batch.id));
        if (typeof loadAiDraftOverlay === 'function') startRead(() => loadAiDraftOverlay());
        if (typeof refreshAiStatusBadge === 'function') startRead(() => refreshAiStatusBadge());
        if (typeof opts.onChanged === 'function') startRead(() => opts.onChanged());
        const settled = await Promise.allSettled(refreshes);
        if (settled.some(entry => entry.status === 'rejected')) {
            console.error('One or more saved AI draft views could not refresh.');
        }
    };

    const hasPendingItems = items.some(item => item.status === 'pending');
    if (batch.status === 'pending' || (batch.status === 'partially_applied' && hasPendingItems)) {
        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'ai-btn ai-btn-accept';
        acceptBtn.textContent = 'Accept';
        acceptBtn.addEventListener('click', () => runAction(async () => {
            const result = await api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/accept`, {
                item_ids: getSelectedItemIds()
            });
            aiHandleCompletionPolicies(result.completion_policies, card);
            return result;
        }));

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'ai-btn ai-btn-reject';
        rejectBtn.textContent = 'Reject';
        rejectBtn.addEventListener('click', () => runAction(() =>
            api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/reject`, { item_ids: getSelectedItemIds() }), false
        ));

        actions.appendChild(rejectBtn);
        actions.appendChild(acceptBtn);
    }
    if (batch.status === 'applied' || batch.status === 'partially_applied') {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'ai-btn ai-btn-undo';
        undoBtn.textContent = 'Undo';
        undoBtn.addEventListener('click', () => runAction(() =>
            api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/undo`, { item_ids: null })
        ));
        actions.appendChild(undoBtn);
    } else if (batch.status === 'undone') {
        const reapplyBtn = document.createElement('button');
        reapplyBtn.type = 'button';
        reapplyBtn.className = 'ai-btn ai-btn-reapply';
        reapplyBtn.textContent = 'Reapply';
        reapplyBtn.addEventListener('click', () => runAction(async () => {
            const result = await api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/reapply`, {
                item_ids: null
            });
            aiHandleCompletionPolicies(result.completion_policies, card);
            return result;
        }));
        actions.appendChild(reapplyBtn);
    }

    if (actions.childNodes.length > 0) card.appendChild(actions);
    return card;
}

function aiHandleCompletionPolicies(policies, card = null) {
    if (!policies || policies.length === 0) return;
    if (typeof window.handleCompletionPolicy !== 'function') return;

    const modal = document.getElementById('completion_policy_modal');
    const modalAlreadyOpen = modal && !modal.classList.contains('hidden');
    const remaining = modalAlreadyOpen ? policies : policies.slice(1);
    if (!modalAlreadyOpen) window.handleCompletionPolicy({ completion_policy: policies[0] });
    if (!remaining.length || !card) return;

    let actions = card.querySelector('.ai-draft-completion-policies');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'ai-draft-completion-policies';
        card.appendChild(actions);
    }
    remaining.forEach(policy => {
        const row = document.createElement('div');
        row.className = 'ai-draft-completion-policy';
        const label = document.createElement('span');
        label.textContent = `Scheduled sessions remain for ${policy.task_title || policy.task_id || 'a task'}.`;
        row.appendChild(label);
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'ai-btn-item';
        review.textContent = 'Review scheduled sessions';
        review.addEventListener('click', () => {
            const openModal = document.getElementById('completion_policy_modal');
            if (openModal && !openModal.classList.contains('hidden')) {
                if (typeof aiNotice === 'function') aiNotice('Finish the open scheduled-session review before opening another.');
                return;
            }
            window.handleCompletionPolicy({ completion_policy: policy });
            review.disabled = true;
        });
        row.appendChild(review);
        actions.appendChild(row);
    });
    if (modalAlreadyOpen && typeof aiNotice === 'function') {
        aiNotice('Finish the open scheduled-session review, then review the remaining tasks below.');
    }
}

/** Re-fetches one batch's detail and re-renders it in place, wherever it's currently mounted. */
async function aiRefreshCurrentBatchView(batchId) {
    let batch;
    try {
        batch = await api.get(`/api/ai/drafts/batches/${encodeURIComponent(batchId)}`);
        document.querySelectorAll(`[data-batch-id="${CSS.escape(batchId)}"]`).forEach((node) => {
            const replacement = aiReconcileDraftBatchNode(node, batch);
            if (aiDraftActionResults.has(batchId)) aiRenderDraftActionResults(replacement, aiDraftActionResults.get(batchId));
            node.replaceWith(replacement);
        });
        aiUnconfirmedDraftActions.delete(batchId);
        aiPendingDraftActions.delete(batchId);
        return true;
    } catch (err) {
        console.error('Failed to refresh draft batch view:', err);
        document.querySelectorAll(`[data-batch-id="${CSS.escape(batchId)}"]`).forEach(node => aiSetDraftReadFailure(node, batchId));
        return false;
    }
}
window.aiRefreshCurrentBatchView = aiRefreshCurrentBatchView;

function aiReconcileDraftBatchNode(current, batch) {
    const replacement = aiBuildDraftBatchNode(batch, {
        onChanged: () => aiRefreshCurrentBatchView(batch.id)
    });
    const selected = new Map(Array.from(current.querySelectorAll('.ai-item-checkbox')).map(input => [input.dataset.itemId, input.checked]));
    replacement.querySelectorAll('.ai-item-checkbox').forEach(input => {
        if (selected.has(input.dataset.itemId)) input.checked = selected.get(input.dataset.itemId);
    });
    const replacementItems = new Map(Array.from(replacement.querySelectorAll('.ai-draft-item')).map(row => [row.dataset.itemId, row]));
    current.querySelectorAll('.ai-inline-edit-box').forEach(editor => {
        const itemId = editor.parentNode?.dataset.itemId;
        const nextRow = replacementItems.get(itemId);
        if (nextRow && batch.items?.some(item => item.id === itemId && item.status === 'pending')) nextRow.appendChild(editor);
    });
    const policyActions = current.querySelector('.ai-draft-completion-policies');
    if (policyActions) replacement.appendChild(policyActions);
    return replacement;
}

/** Loads the drafts/history panel (all recent batches, undo-since-any-point actions). */
async function aiLoadBatchesPanel() {
    const list = document.getElementById('ai_batches_list');
    if (!list) return;
    try {
        const batches = await api.get('/api/ai/drafts/batches?limit=50');
        if (!batches || batches.length === 0) {
            if (list.children.length) return true;
            const empty = document.createElement('div');
            empty.className = 'ai-thread-empty';
            empty.textContent = 'No draft batches yet.';
            list.appendChild(empty);
            return true;
        }
        const details = [];
        for (const b of batches) {
            const detail = await api.get(`/api/ai/drafts/batches/${encodeURIComponent(b.id)}`);
            details.push(detail);
        }
        details.forEach(detail => {
            const existing = list.querySelector(`[data-batch-id="${CSS.escape(detail.id)}"]`);
            if (existing && ((typeof aiRootHasDrafts === 'function' && aiRootHasDrafts(existing))
                || existing.contains(document.activeElement || null))) return;
            const replacement = existing
                ? aiReconcileDraftBatchNode(existing, detail)
                : aiBuildDraftBatchNode(detail, { onChanged: aiLoadBatchesPanel });
            if (aiDraftActionResults.has(detail.id)) aiRenderDraftActionResults(replacement, aiDraftActionResults.get(detail.id));
            if (existing) existing.replaceWith(replacement);
            else list.appendChild(replacement);
        });
        return true;
    } catch (err) {
        console.error('Failed to load draft batches:', err);
        if (typeof aiNotice === 'function') aiNotice('Could not refresh proposals. Existing cards and edits are kept; Retry reads only.');
        return false;
    }
}

async function aiUndoAllBatches() {
    if (typeof aiUndoAssistantHistory === 'function') return aiUndoAssistantHistory();
    try {
        const result = await api.post('/api/ai/drafts/undo', {});
        if (typeof aiRenderUndoAllResults === 'function') aiRenderUndoAllResults(result);
        const reads = [];
        const startRead = read => reads.push(Promise.resolve().then(read));
        if (typeof taskKnowledge !== 'undefined' && typeof taskKnowledge.changed === 'function') startRead(() => taskKnowledge.changed());
        startRead(() => aiLoadBatchesPanel());
        if (typeof loadAiDraftOverlay === 'function') startRead(() => loadAiDraftOverlay());
        if (typeof refreshAiStatusBadge === 'function') startRead(() => refreshAiStatusBadge());
        await Promise.allSettled(reads);
    } catch (err) {
        console.error('Failed to undo all AI draft batches:', err);
        alert('Undo failed: ' + (err.message || err));
    }
}

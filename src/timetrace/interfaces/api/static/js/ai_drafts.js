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
    remove: 'REMOVE'
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
        const title = proposed.notes || proposed.tags || baseline.notes || baseline.tags || '(untitled session)';
        parts.push(title);
        const start = proposed.start_time || baseline.start_time;
        const end = proposed.end_time || baseline.end_time;
        if (start) {
            parts.push(`${aiFormatLocalDt(start)}${end ? ' -> ' + aiFormatLocalDt(end) : ''}`);
        }
    } else if (item.entity_type === 'task') {
        parts.push(proposed.title || baseline.title || '(untitled task)');
    } else {
        parts.push(item.entity_type || 'item');
    }
    return parts;
}

function aiBadgeForItem(item) {
    const kind = item.ui_kind || item.op;
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

    if (opts.selectable && batch.status === 'pending') {
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
    const [titleText] = aiDescribeDraftItem(item);
    titleSpan.textContent = titleText;
    titleRow.appendChild(titleSpan);
    body.appendChild(titleRow);

    const [, metaText] = aiDescribeDraftItem(item);
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

    if (opts.showItemActions && batch.status === 'pending' && item.status === 'pending') {
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
            try {
                await api.post(`/api/ai/drafts/items/${encodeURIComponent(item.id)}/reject`, {});
                if (typeof options.onChanged === 'function') options.onChanged();
            } catch (err) {
                console.error('Failed to reject draft item:', err);
            }
        });
        actions.appendChild(rejectBtn);

        body.appendChild(actions);
    }

    row.appendChild(body);
    return row;
}

function aiToggleInlineEdit(row, item, batch) {
    let editBox = row.querySelector('.ai-inline-edit-box');
    if (editBox) {
        editBox.remove();
        return;
    }
    editBox = document.createElement('div');
    editBox.className = 'ai-inline-edit-box mt-1.5 pt-1.5';
    editBox.style.borderTop = '1px dashed #262938';

    const textarea = document.createElement('textarea');
    textarea.rows = 4;
    textarea.style.width = '100%';
    textarea.style.background = '#0b0c10';
    textarea.style.border = '1px solid #262938';
    textarea.style.color = '#e2e8f0';
    textarea.style.fontSize = '10px';
    textarea.style.fontFamily = 'ui-monospace, monospace';
    textarea.style.borderRadius = '6px';
    textarea.style.padding = '5px';
    textarea.value = JSON.stringify(item.proposed || {}, null, 2);
    editBox.appendChild(textarea);

    const hint = document.createElement('div');
    hint.className = 'ai-quickadd-hint';
    hint.textContent = 'Edit the proposed fields as JSON, then Save.';
    editBox.appendChild(hint);

    const btnRow = document.createElement('div');
    btnRow.className = 'flex gap-1 mt-1';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ai-btn-item';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        let parsed;
        try {
            parsed = JSON.parse(textarea.value);
        } catch (e) {
            hint.textContent = 'Invalid JSON -- not saved.';
            hint.style.color = '#f87171';
            return;
        }
        try {
            await api.request(`/api/ai/drafts/items/${encodeURIComponent(item.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ proposed: parsed })
            });
            if (typeof window.aiRefreshCurrentBatchView === 'function') window.aiRefreshCurrentBatchView(batch.id);
        } catch (err) {
            hint.textContent = 'Save failed: ' + (err.message || err);
            hint.style.color = '#f87171';
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
}

function aiBatchStatusBadge(status) {
    const span = document.createElement('span');
    span.className = `ai-batch-status ai-batch-status-${status}`;
    span.textContent = (status || '').replace(/_/g, ' ');
    return span;
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

    const runAction = async (fn) => {
        try {
            await fn();
            if (typeof opts.onChanged === 'function') opts.onChanged();
        } catch (err) {
            console.error('AI draft action failed:', err);
            alert('Action failed: ' + (err.message || err));
        }
    };

    if (batch.status === 'pending') {
        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'ai-btn ai-btn-accept';
        acceptBtn.textContent = 'Accept';
        acceptBtn.addEventListener('click', () => runAction(async () => {
            const result = await api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/accept`, {
                item_ids: getSelectedItemIds()
            });
            aiHandleCompletionPolicies(result.completion_policies);
        }));

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.className = 'ai-btn ai-btn-reject';
        rejectBtn.textContent = 'Reject';
        rejectBtn.addEventListener('click', () => runAction(() =>
            api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/reject`, { item_ids: getSelectedItemIds() })
        ));

        actions.appendChild(rejectBtn);
        actions.appendChild(acceptBtn);
    } else if (batch.status === 'applied' || batch.status === 'partially_applied') {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'ai-btn ai-btn-undo';
        undoBtn.textContent = 'Undo';
        undoBtn.addEventListener('click', () => runAction(() =>
            api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/undo`, { item_ids: getSelectedItemIds() })
        ));
        actions.appendChild(undoBtn);
    } else if (batch.status === 'undone') {
        const reapplyBtn = document.createElement('button');
        reapplyBtn.type = 'button';
        reapplyBtn.className = 'ai-btn ai-btn-reapply';
        reapplyBtn.textContent = 'Reapply';
        reapplyBtn.addEventListener('click', () => runAction(async () => {
            const result = await api.post(`/api/ai/drafts/batches/${encodeURIComponent(batch.id)}/reapply`, {
                item_ids: getSelectedItemIds()
            });
            aiHandleCompletionPolicies(result.completion_policies);
        }));
        actions.appendChild(reapplyBtn);
    }

    if (actions.childNodes.length > 0) card.appendChild(actions);
    return card;
}

function aiHandleCompletionPolicies(policies) {
    if (!policies || policies.length === 0) return;
    // Reuses the EXISTING completion_policy.js modal (spec S7) -- never reinvented. That modal
    // (and completionPolicyState) is single-prompt, so with multiple affected tasks in one AI
    // batch only the first is shown; the rest are noted in the console. Good enough for a first
    // cut -- a real multi-prompt queue is out of scope here.
    if (typeof window.handleCompletionPolicy !== 'function') return;
    window.handleCompletionPolicy({ completion_policy: policies[0] });
    if (policies.length > 1) {
        console.warn(`AI batch affected ${policies.length} tasks' scheduled sessions; only showing the first completion-policy prompt.`);
    }
}

/** Re-fetches one batch's detail and re-renders it in place, wherever it's currently mounted. */
async function aiRefreshCurrentBatchView(batchId) {
    try {
        const batch = await api.get(`/api/ai/drafts/batches/${encodeURIComponent(batchId)}`);
        document.querySelectorAll(`[data-batch-id="${CSS.escape(batchId)}"]`).forEach((node) => {
            const replacement = aiBuildDraftBatchNode(batch, { onChanged: () => aiRefreshCurrentBatchView(batchId) });
            node.replaceWith(replacement);
        });
        if (typeof loadAiDraftOverlay === 'function') loadAiDraftOverlay();
        if (typeof refreshAiStatusBadge === 'function') refreshAiStatusBadge();
    } catch (err) {
        console.error('Failed to refresh draft batch view:', err);
    }
}
window.aiRefreshCurrentBatchView = aiRefreshCurrentBatchView;

/** Loads the drafts/history panel (all recent batches, undo-since-any-point actions). */
async function aiLoadBatchesPanel() {
    const list = document.getElementById('ai_batches_list');
    if (!list) return;
    list.textContent = '';
    try {
        const batches = await api.get('/api/ai/drafts/batches?limit=50');
        if (!batches || batches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ai-thread-empty';
            empty.textContent = 'No draft batches yet.';
            list.appendChild(empty);
            return;
        }
        for (const b of batches) {
            const detail = await api.get(`/api/ai/drafts/batches/${encodeURIComponent(b.id)}`);
            list.appendChild(aiBuildDraftBatchNode(detail, { onChanged: aiLoadBatchesPanel }));
        }
    } catch (err) {
        console.error('Failed to load draft batches:', err);
        const errNode = document.createElement('div');
        errNode.className = 'ai-msg ai-msg-error';
        errNode.textContent = 'Failed to load draft batches: ' + (err.message || err);
        list.appendChild(errNode);
    }
}

async function aiUndoAllBatches() {
    try {
        await api.post('/api/ai/drafts/undo', {});
        aiLoadBatchesPanel();
        if (typeof loadAiDraftOverlay === 'function') loadAiDraftOverlay();
        if (typeof refreshAiStatusBadge === 'function') refreshAiStatusBadge();
    } catch (err) {
        console.error('Failed to undo all AI draft batches:', err);
        alert('Undo failed: ' + (err.message || err));
    }
}

/** Task-only post-mortem editor, shared by details and Revision. */
function createTaskPostmortemEditor(root, guardNavigation = false) {
    if (!root) return null;
    if (root.taskPostmortem) return root.taskPostmortem;
    const field = name => root.querySelector(`[data-task-review="${name}"]`);
    const textNames = ['difficulty', 'what_went_well', 'blockers', 'key_takeaways'];
    const textSelector = textNames.map(name => `#${field(name).id}`).join(', ');
    const ratings = field('ratings');
    let owner = null, sequence = 0, read = 0, editRevision = 0;
    root.dataset.settingsDraftRetained = 'true';
    ratings.dataset.settingsDraftRetained = 'true';
    const current = captured => owner === captured;
    const message = text => { field('status').textContent = text; };
    const controls = () => {
        field('fields').disabled = !owner?.textReady || !!owner?.discarding;
        field('save').disabled = !owner?.ready || owner.busy;
        field('discard').disabled = !owner || owner.busy;
        field('retry').disabled = !owner || owner.busy;
        root.setAttribute('aria-busy', String(!!owner?.busy));
    };
    const text = () => ({task_id:owner.taskId, difficulty:Number.isNaN(Number.parseInt(field('difficulty').value))
        ? 3 : Number.parseInt(field('difficulty').value),
        what_went_well:field('what_went_well').value || '', blockers:field('blockers').value || '',
        key_takeaways:field('key_takeaways').value || ''});
    const dirty = () => !!owner?.textReady && typeof hasSettingsDrafts === 'function' &&
        hasSettingsDrafts([root.id, ratings.id]);
    const editor = {
        get ready() { return !!owner?.ready; },
        get initialized() { return !!owner?.textReady; },
        get taskId() { return owner?.taskId; },
        canLeave() { return !dirty() || window.confirm('Discard this task review draft and select another task?'); },
        bind(taskId) {
            if (owner?.taskId === taskId) return owner;
            owner = {taskId, token:++sequence, textReady:false, ready:false, busy:false, acknowledged:null};
            ++read;
            ratings.innerHTML = '';
            delete ratings.ratingHTML; ratings.ratingUnavailable = false;
            ratings.ratingBaselines = new Map(); ratings.ratingAcknowledged = new Map();
            ratings.ratingTarget = `task:${taskId}`;
            message('Loading this task’s post-mortem…'); controls();
            return owner;
        },
        begin(taskId) {
            const captured = editor.bind(taskId);
            if (captured.busy) { captured.refreshPending = true; return captured; }
            ++read; captured.ready = false;
            message('Loading this task’s post-mortem…'); controls();
            return captured;
        },
        async hydrate(taskId, stats, isCurrent = () => true, preserveEdits = true, settlingSave = false) {
            if (!isCurrent()) return false;
            const captured = editor.bind(taskId);
            // Captured rating writes retain their input nodes until the entire batch settles.
            // Metadata refresh still paints evidence; fresh definitions reconcile afterward.
            if (captured.busy && !settlingSave) { captured.refreshPending = true; return false; }
            const request = ++read;
            const valid = () => current(captured) && request === read && isCurrent();
            captured.ready = false; controls();
            if (!captured.textReady || !preserveEdits) {
                const review = stats.task_review || {};
                field('difficulty').value = review.difficulty ?? 3;
                for (const name of textNames.slice(1)) field(name).value = review[name] || '';
                captured.textReady = true;
                captured.acknowledged = review.id ? JSON.stringify(text()) : null;
                if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(root.id, textSelector);
            }
            controls();
            try {
                const result = await renderCustomRatingsInputs('task', taskId, ratings.id, stats.custom_ratings || [], valid, ratings, preserveEdits);
                if (!valid() || result !== true || ratings.ratingTarget !== `task:${taskId}`) return false;
                captured.ready = true;
                if (!captured.ratingsInitialized || !preserveEdits) {
                    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(ratings.id);
                    for (const item of snapshotCustomRatings('task', taskId, ratings)) {
                        ratings.ratingBaselines.set(item.input.id, JSON.stringify([item.input.value, item.input.disabled]));
                    }
                    captured.ratingsInitialized = true;
                }
                message('This task only. Save records a review without changing task status or schedules.');
                return true;
            } catch (_) {
                if (valid()) message('Review ratings unavailable. Drafts retained. Retry refresh reads only.');
                return false;
            } finally { if (valid()) controls(); }
        },
        async retry() {
            const captured = owner, request = ++read;
            if (!captured || captured.busy) return false;
            captured.ready = false; message('Refreshing post-mortem…'); controls();
            try {
                const stats = await api.get(`/api/tasks/${captured.taskId}/stats`);
                if (!current(captured) || request !== read) return false;
                return await editor.hydrate(captured.taskId, stats, () => current(captured), true);
            } catch (_) {
                if (current(captured) && request === read) message('Refresh unavailable. Drafts retained. Retry refresh reads only.');
                return false;
            } finally { if (current(captured)) controls(); }
        },
        async save() {
            const captured = owner;
            if (!captured?.ready || captured.busy) return false;
            if (!validateRequiredCustomRatings('task', captured.taskId, ratings)) return false;
            const payload = text(), signature = JSON.stringify(payload);
            const checkpoint = typeof settingsDraftCheckpoint === 'function'
                ? settingsDraftCheckpoint(root.id, textSelector) : () => {};
            const submitted = snapshotCustomRatings('task', captured.taskId, ratings);
            captured.busy = true; message('Saving post-mortem…'); controls();
            try {
                if (captured.acknowledged !== signature) {
                    await api.post('/api/task-reviews', payload);
                    if (!current(captured)) return false;
                    captured.acknowledged = signature; checkpoint();
                }
                await submitCustomRatings('task', captured.taskId, () => current(captured), ratings, submitted);
                if (!current(captured)) return false;
                // Separate writes are acknowledged independently. Refresh never replays them.
                const refreshed = await editor.retryAfterSave(captured);
                if (current(captured)) message(refreshed ? 'Captured review saved. New edits remain unsaved until Save.' : 'Review saved; refresh unavailable. Retry refresh reads only.');
                return true;
            } catch (_) {
                if (current(captured)) message('Save incomplete. Successful writes are retained; retry Save for remaining or changed fields.');
                return false;
            } finally {
                if (current(captured)) {
                    if (captured.refreshPending) {
                        const saveStatus = field('status').textContent;
                        await editor.retryAfterSave(captured);
                        if (current(captured)) message(saveStatus);
                    }
                    if (current(captured)) { captured.busy = false; controls(); }
                }
            }
        },
        async retryAfterSave(captured) {
            captured.refreshPending = false;
            const request = ++read;
            try {
                const stats = await api.get(`/api/tasks/${captured.taskId}/stats`);
                if (!current(captured) || request !== read) return false;
                return await editor.hydrate(captured.taskId, stats, () => current(captured), true, true);
            } catch (_) { return false; }
        },
        async discard() {
            const captured = owner;
            if (!captured || captured.busy) return false;
            if (dirty() && !window.confirm('Discard unsaved task review changes and reload the saved review?')) return false;
            const beforeText = JSON.stringify(text());
            const beforeRatings = JSON.stringify(snapshotCustomRatings('task', captured.taskId, ratings).map(entry => [entry.signature, entry.rawValue]));
            const request = ++read, revision = editRevision;
            captured.ready = false; message('Reloading saved post-mortem…'); controls();
            try {
                const stats = await api.get(`/api/tasks/${captured.taskId}/stats`);
                if (!current(captured) || request !== read) return false;
                const unchanged = editRevision === revision && JSON.stringify(text()) === beforeText &&
                    JSON.stringify(snapshotCustomRatings('task', captured.taskId, ratings).map(entry => [entry.signature, entry.rawValue])) === beforeRatings;
                if (!unchanged) {
                    message('New edits retained. Discard again to reload the saved review.'); controls(); return false;
                }
                // Hold editing while definitions load so Discard cannot consume newer input.
                captured.discarding = true; controls();
                return await editor.hydrate(captured.taskId, stats, () => current(captured), false);
            } catch (_) {
                if (current(captured)) message('Discard refresh failed. Drafts retained. Retry refresh reads only.');
                return false;
            } finally { if (current(captured)) { captured.discarding = false; controls(); } }
        }
    };
    for (const action of ['save', 'discard', 'retry']) field(action).addEventListener('click', () => editor[action]());
    root.addEventListener('input', () => { ++editRevision; });
    root.addEventListener('change', () => { ++editRevision; });
    root.addEventListener('click', event => {
        if (ratings.contains(event.target)) ++editRevision;
    });
    root.addEventListener('keydown', event => {
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation(); editor.save();
        } else if (event.key === 'Escape' || event.key === 'Esc') event.stopPropagation();
    });
    // Dedicated details already guards its links; Revision delegates this review's departure here.
    if (guardNavigation) document.addEventListener('click', event => {
        const link = event.target?.closest?.('a[href]');
        if (!link || event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
            link.target === '_blank' || link.hasAttribute?.('download') || link.getAttribute('href')?.startsWith('#') ||
            link.getAttribute('onclick')?.includes('followSettingsLink')) return;
        if (dirty() && !window.confirm('Leave this page and discard unsaved task review changes?')) {
            event.preventDefault(); event.stopPropagation();
        }
    }, true);
    window.addEventListener('beforeunload', event => {
        if (dirty()) { event.preventDefault(); event.returnValue = ''; }
    });
    root.taskPostmortem = editor; controls();
    return editor;
}

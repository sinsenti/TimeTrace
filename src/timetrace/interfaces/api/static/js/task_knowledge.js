/** Same-page task metadata. Fallback labels never make a complete registry. */
const taskKnowledge = (() => {
    let tasks = Object.freeze({});
    const fallbacks = new Map();
    let status = 'unloaded';
    let generation = 0;
    let pending = null;
    let metadataFailed = false;
    const failedViews = new Set();

    function renderNotice() {
        let notice = document.getElementById('task_metadata_notice');
        if (!metadataFailed && failedViews.size === 0) {
            if (notice) notice.remove();
            return;
        }
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'task_metadata_notice';
            notice.className = 'fixed bottom-4 left-4 z-[200] bg-slate-900 text-amber-200 border border-amber-700 rounded-lg p-3 text-xs shadow-lg';
            notice.setAttribute('role', 'status');
            const label = document.createElement('span');
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = 'Retry refresh';
            retry.className = 'ml-3 underline font-bold';
            retry.addEventListener('click', () => refresh());
            notice.appendChild(label);
            notice.appendChild(retry);
            document.body.appendChild(notice);
        }
        notice.children[0].textContent = status === 'failed'
            ? 'Task information unavailable. Saved changes are not affected.'
            : 'Task information is stale. Saved changes are not affected.';
    }

    function viewResult(name, succeeded) {
        if (succeeded) failedViews.delete(name);
        else failedViews.add(name);
        renderNotice();
    }

    function refreshLabels() {
        // Any successful metadata load can recover a failed refresh (e.g. a calendar read).
        // Update local labels before removing the notice, even outside changed()/refresh().
        const labels = [];
        if (typeof refreshAttachedTaskViews === 'function') labels.push(['attachments', refreshAttachedTaskViews]);
        if (typeof refreshTaskInspectorLabels === 'function') labels.push(['inspector-labels', refreshTaskInspectorLabels]);
        for (const [name, render] of labels) {
            try {
                render();
                viewResult(name, true);
            } catch (e) {
                viewResult(name, false);
            }
        }
    }

    async function refresh() {
        const refreshGeneration = generation;
        await load(true);
        if (refreshGeneration !== generation) return;
        // Only refresh display paths present on this page; never reopen or repopulate forms.
        const views = [];
        if (typeof calendar !== 'undefined' && calendar) views.push(['calendar', () => calendar.refetchEvents()]);
        if (document.getElementById('task_card_list') && typeof fetchTasks === 'function') views.push(['sidebar', () => fetchTasks()]);
        if (document.getElementById('kanban_columns_container') && typeof loadKanbanBoard === 'function') views.push(['kanban', () => loadKanbanBoard()]);
        if (typeof refreshTaskInspectorKnowledge === 'function') views.push(['inspector-registry', () => refreshTaskInspectorKnowledge()]);
        if (document.getElementById('inspector_task_id') && typeof loadTaskDetailTree === 'function') {
            views.push(['task-detail', () => loadTaskDetailTree(true)]);
        }
        await Promise.allSettled(views.map(async ([name, render]) => {
            try {
                const result = await render();
                // null means this renderer was superseded by another selection/request.
                if (refreshGeneration === generation && name !== 'calendar' && result !== null) viewResult(name, result !== false);
            } catch (e) {
                if (refreshGeneration === generation) viewResult(name, false);
            }
        }));
    }

    function changed() {
        invalidate();
        return refresh();
    }

    function invalidate() {
        generation++;
        if (status === 'fresh') status = 'stale';
    }

    function load(force = false) {
        if (pending && pending.generation === generation) return pending.promise;
        if (!force && status === 'fresh') return Promise.resolve(tasks);
        const requestGeneration = generation;
        const promise = (async () => {
            try {
                const rows = await api.get('/api/tasks?status=all');
                if (requestGeneration !== generation) return load();
                if (!Array.isArray(rows)) throw new Error('Task metadata unavailable');
                tasks = Object.freeze(Object.fromEntries(rows.map(t => [t.id, Object.freeze({ ...t })])));
                status = 'fresh';
                metadataFailed = false;
                fallbacks.clear();
                refreshLabels();
                renderNotice();
            } catch (e) {
                if (requestGeneration !== generation) return load();
                status = status === 'unloaded' || status === 'failed' ? 'failed' : 'stale';
                metadataFailed = true;
                renderNotice();
            } finally {
                if (pending && pending.generation === requestGeneration) pending = null;
            }
            return tasks;
        })();
        pending = { generation: requestGeneration, promise };
        return promise;
    }

    return {
        load,
        invalidate,
        refresh,
        changed,
        viewResult,
        get: id => tasks[id] || fallbacks.get(id) || null,
        values: () => Object.values(tasks),
        state: () => ({ status, generation, failed: metadataFailed, loading: Boolean(pending && pending.generation === generation) }),
        rememberFallback(task) {
            if (task && task.id && task.title && !tasks[task.id]) {
                fallbacks.set(task.id, Object.freeze({ ...task }));
            }
            return task ? this.get(task.id) : null;
        }
    };
})();

function fetchAllTasksRegistry(force = false) {
    return taskKnowledge.load(force);
}

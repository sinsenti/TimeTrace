/** Handle-only native drag and keyboard ordering for the saved dashboard grid.
 * Snapshot identity + the complete ordered ID set fence gestures against refreshed owners.
 * Persistence/ACK and recovery stay with the dashboard writer, not the DOM order.
 */
function createDashboardDrag({ grid, getState, commit }) {
    let gesture = null;
    let indicator = null;

    function clearIndicator() {
        if (indicator) {
            delete indicator.dataset.dropPosition;
            delete indicator.dataset.dropAxis;
        }
        indicator = null;
    }

    function cancel() {
        clearIndicator();
        gesture = null;
        delete grid.dataset.draggingWidget;
    }

    function snapshot() {
        const state = getState();
        return state && !state.blocked ? { owner: state.owner, ids: [...state.ids] } : null;
    }

    function isCurrent(saved) {
        const state = snapshot();
        return state && saved && state.owner === saved.owner &&
            state.ids.length === saved.ids.length && state.ids.every((id, i) => id === saved.ids[i]);
    }

    function targetAt(event) {
        const card = event.target.closest('[data-widget-id]');
        if (!card || !grid.contains(card) || !gesture || !isCurrent(gesture)) return null;
        if (!gesture.ids.includes(card.dataset.widgetId) || card.dataset.widgetId === gesture.widgetId) return null;
        const rect = card.getBoundingClientRect();
        // A full-row card (including the narrow responsive grid) has a vertical insertion edge.
        const vertical = rect.width >= grid.getBoundingClientRect().width - 2;
        const after = vertical ? event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2;
        return { card, after, vertical };
    }

    grid.addEventListener('dragstart', event => {
        cancel();
        const handle = event.target.closest('[data-widget-drag-handle]');
        const card = handle?.closest('[data-widget-id]');
        const state = snapshot();
        if (!handle || event.target !== handle || !card || !grid.contains(card) || !state ||
            !state.ids.includes(card.dataset.widgetId) || !event.dataTransfer) {
            event.preventDefault();
            return;
        }
        gesture = { ...state, widgetId: card.dataset.widgetId };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', gesture.widgetId);
        grid.dataset.draggingWidget = gesture.widgetId;
        event.stopPropagation();
    });

    grid.addEventListener('dragover', event => {
        clearIndicator();
        const target = targetAt(event);
        if (!target) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        indicator = target.card;
        indicator.dataset.dropPosition = target.after ? 'after' : 'before';
        indicator.dataset.dropAxis = target.vertical ? 'vertical' : 'horizontal';
    });

    grid.addEventListener('drop', event => {
        const target = targetAt(event);
        const saved = gesture;
        cancel();
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        const ids = saved.ids.filter(id => id !== saved.widgetId);
        ids.splice(ids.indexOf(target.card.dataset.widgetId) + (target.after ? 1 : 0), 0, saved.widgetId);
        if (ids.some((id, i) => id !== saved.ids[i])) commit(ids, saved.owner);
    });

    grid.addEventListener('dragend', cancel);
    grid.addEventListener('dragleave', event => {
        if (!event.relatedTarget || !grid.contains(event.relatedTarget)) {
            clearIndicator();
        }
    });
    grid.addEventListener('keydown', event => {
        if (event.key === 'Escape') { cancel(); return; }
        const handle = event.target.closest('[data-widget-drag-handle]');
        if (!handle || event.target !== handle || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        cancel();
        const state = snapshot();
        if (!state) return;
        const from = state.ids.indexOf(handle.closest('[data-widget-id]').dataset.widgetId);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= state.ids.length) return;
        state.ids.splice(to, 0, state.ids.splice(from, 1)[0]);
        commit(state.ids, state.owner);
    });
    return { cancel };
}

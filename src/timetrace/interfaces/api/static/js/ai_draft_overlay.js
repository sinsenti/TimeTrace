/**
 * TimeTrace AI Assistant -- calendar draft overlay (docs/ai-assistant-spec.md S5/S7).
 *
 * Renders pending AI-proposed session changes ("ghost" events) on the FullCalendar grid, as an
 * additional function-based event source (`calendar.addEventSource`) so calendar.js itself needs
 * no changes -- FullCalendar re-invokes a function source automatically whenever the visible
 * date range changes.
 *
 * Positioning uses `display.start_time_local`/`display.end_time_local` (server-computed, naive
 * local-time ISO strings) -- NEVER `start_time`/`end_time` sliced as `[:10]`, which buckets by
 * UTC and would put a late-night session under the wrong day (spec S7/S9 explicit trap).
 */

let aiDraftOverlaySource = null;

function aiParseNaiveLocal(isoStr) {
    // `display.*_local` values have no trailing 'Z'/offset -- the browser's Date constructor
    // parses a bare "YYYY-MM-DDTHH:MM:SS" as local time already, which is exactly what we want.
    if (!isoStr) return null;
    const dt = new Date(isoStr);
    return isNaN(dt.getTime()) ? null : dt;
}

function aiDraftOverlayEventSourceFn(fetchInfo, successCallback, failureCallback) {
    const start = fetchInfo.start.toISOString();
    const end = fetchInfo.end.toISOString();

    api.get(`/api/ai/drafts/overlay?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
        .then((items) => {
            const events = (items || []).map((item) => {
                const proposed = item.proposed || {};
                const baseline = item.baseline || {};
                const isRemove = item.op === 'delete';
                const startDt = aiParseNaiveLocal(item.display && item.display.start_time_local);
                const endDt = aiParseNaiveLocal(item.display && item.display.end_time_local);
                if (!startDt || !endDt) return null;

                const label = proposed.notes || proposed.tags || baseline.notes || baseline.tags
                    || (isRemove ? 'AI: remove' : 'AI proposal');

                return {
                    id: `ai-draft-${item.id}`,
                    title: `${isRemove ? '(remove) ' : ''}${label}`,
                    start: startDt,
                    end: endDt,
                    classNames: isRemove ? ['tt-ai-draft-ghost', 'tt-ai-draft-ghost-remove'] : ['tt-ai-draft-ghost'],
                    editable: false,
                    extendedProps: { aiDraftItemId: item.id, aiDraftBatchId: item.batch_id, aiUiKind: item.ui_kind }
                };
            }).filter(Boolean);
            successCallback(events);
        })
        .catch((err) => {
            console.error('Failed to load AI draft overlay:', err);
            failureCallback(err);
        });
}

/** Called by ai_assistant.js/ai_drafts.js after any draft mutation so the overlay reflects it. */
function loadAiDraftOverlay() {
    if (typeof calendar !== 'undefined' && calendar) {
        calendar.refetchEvents();
    }
}
window.loadAiDraftOverlay = loadAiDraftOverlay;

function aiSetupDraftOverlay() {
    const tryAttach = () => {
        if (typeof calendar !== 'undefined' && calendar && !aiDraftOverlaySource) {
            aiDraftOverlaySource = calendar.addEventSource(aiDraftOverlayEventSourceFn);
            return true;
        }
        return false;
    };

    if (tryAttach()) return;
    // `calendar` is created asynchronously in dashboard.js's own DOMContentLoaded handler;
    // poll briefly rather than depending on load order between the two scripts.
    let attempts = 0;
    const interval = setInterval(() => {
        attempts += 1;
        if (tryAttach() || attempts > 40) clearInterval(interval);
    }, 150);
}

document.addEventListener('DOMContentLoaded', aiSetupDraftOverlay);

/**
 * TimeTrace AI Assistant -- quick-add strip inside the task creation/edit modal
 * (docs/ai-assistant-spec.md S1/S7).
 *
 * Tier routing: `POST /quick-add/classify` (no LLM call) decides whether free text needs tier-2
 * escalation, purely so the UI can say "AI will parse this" before spending any money -- it is
 * NOT what triggers the actual parse. `POST /quick-add/parse` is read-only and creates nothing;
 * it only returns best-effort fields for this form to prefill. The existing tier-1 regex parser
 * (`apply_quick_task_syntax` / `parse_title_estimation`, spec S9 trap 2) still runs server-side
 * on save regardless of what this does, so tags/priority/estimate belong in their own fields
 * here, never smuggled back into the title text.
 *
 * `fields` keys returned by the backend (see `AIChatService.quick_add_parse`): title, tags,
 * priority, due_date, start_time, end_time, estimated_duration_minutes -- all optional/nullable.
 */

let aiQuickAddClassifyTimer = null;
let aiQuickAddParseInFlight = false;

function aiQuickAddSetupStrip() {
    const input = document.getElementById('ai_quickadd_input');
    const parseBtn = document.getElementById('ai_quickadd_parse_btn');
    if (!input || !parseBtn) return; // strip not present on this page

    input.addEventListener('input', () => {
        clearTimeout(aiQuickAddClassifyTimer);
        const hint = document.getElementById('ai_quickadd_hint');
        const text = input.value.trim();
        if (!text) {
            if (hint) hint.textContent = '';
            return;
        }
        aiQuickAddClassifyTimer = setTimeout(() => aiQuickAddClassify(text), 350);
    });

    parseBtn.addEventListener('click', aiQuickAddParse);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            aiQuickAddParse();
        }
    });
}

document.addEventListener('DOMContentLoaded', aiQuickAddSetupStrip);

async function aiQuickAddClassify(text) {
    const hint = document.getElementById('ai_quickadd_hint');
    if (!hint) return;
    try {
        const decision = await api.post('/api/ai/quick-add/classify', { text });
        if (decision.tier === 2) {
            hint.textContent = 'AI will parse this (tier 2) -- click Parse or press Enter.';
        } else {
            hint.textContent = 'Simple enough for the regular parser -- Parse still works, but is optional.';
        }
    } catch (err) {
        console.error('Quick-add classify failed:', err);
        hint.textContent = '';
    }
}

async function aiQuickAddParse() {
    if (aiQuickAddParseInFlight) return;
    const input = document.getElementById('ai_quickadd_input');
    const hint = document.getElementById('ai_quickadd_hint');
    const parseBtn = document.getElementById('ai_quickadd_parse_btn');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    aiQuickAddParseInFlight = true;
    if (parseBtn) parseBtn.disabled = true;
    if (hint) hint.textContent = 'Parsing...';

    try {
        const result = await api.post('/api/ai/quick-add/parse', { text });
        if (!result.fields || Object.keys(result.fields).length === 0) {
            if (hint) {
                hint.textContent = result.tier === 1
                    ? 'No AI fields returned -- type directly into the fields below (tier-1 syntax like [30min] or #tag still works in the title).'
                    : 'The assistant returned no usable fields.';
            }
            return;
        }
        aiQuickAddApplyFields(result.fields);
        if (hint) hint.textContent = 'Fields prefilled below -- review before saving.';
    } catch (err) {
        console.error('Quick-add parse failed:', err);
        if (hint) hint.textContent = 'Parse failed: ' + (err.message || err);
    } finally {
        aiQuickAddParseInFlight = false;
        if (parseBtn) parseBtn.disabled = false;
    }
}

function aiQuickAddApplyFields(fields) {
    const titleInput = document.getElementById('modal_input_title');
    if (titleInput && fields.title) titleInput.value = fields.title;

    const tagsInput = document.getElementById('modal_input_tags');
    if (tagsInput && fields.tags) {
        const tagList = String(fields.tags).split(/\s+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`));
        tagsInput.value = tagList.join(' ');
    }

    const prioritySelect = document.getElementById('modal_input_priority');
    if (prioritySelect && fields.priority) {
        const val = String(fields.priority).toLowerCase();
        if (['low', 'medium', 'high', '-'].includes(val)) prioritySelect.value = val;
    }

    const dueInput = document.getElementById('modal_input_due_date');
    if (dueInput && fields.due_date) dueInput.value = aiQuickAddFormatDateField(fields.due_date);

    // Task modal only has a single "Target Day" field, not separate start/end time-of-day
    // fields -- start_time is the closest fit (assigned_date accepts "YYYY-MM-DD HH:MM").
    const assignedInput = document.getElementById('modal_input_assigned_date');
    if (assignedInput && fields.start_time) assignedInput.value = aiQuickAddFormatDateField(fields.start_time);

    const estInput = document.getElementById('modal_input_est');
    if (estInput && fields.estimated_duration_minutes) {
        estInput.value = typeof formatMinutesToDuration === 'function'
            ? formatMinutesToDuration(fields.estimated_duration_minutes)
            : `${fields.estimated_duration_minutes}m`;
    }
}

function aiQuickAddFormatDateField(raw) {
    if (typeof formatFlexibleDateForInput === 'function') {
        try {
            return formatFlexibleDateForInput(raw);
        } catch (e) {
            // fall through to raw string below
        }
    }
    return String(raw);
}

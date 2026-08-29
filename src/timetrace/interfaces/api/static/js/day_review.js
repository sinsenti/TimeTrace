/**
 * Daily Retrospective Form & Day Timeline
 */

let currentDaySummary = null;
let dayBreakdownFilter = null; // { type: 'tag'|'task', value } or null

function setDayReviewToday() {
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput) {
        dateInput.value = typeof getLocalTodayStr === 'function' ? getLocalTodayStr() : new Date().toISOString().slice(0, 10);
        loadDayReviewData();
    }
}

function jumpToCalendarForDay() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput || !dateInput.value) return;

    let url = `/dashboard?date=${dateInput.value}`;
    if (dayBreakdownFilter) {
        if (dayBreakdownFilter.type === 'tag') {
            url += `&tag=${encodeURIComponent(dayBreakdownFilter.value)}`;
        } else if (dayBreakdownFilter.type === 'task') {
            url += `&task=${encodeURIComponent(dayBreakdownFilter.value)}`;
        }
    }
    window.location.href = url;
}

function markDayFormDirty() {
    const btn = document.getElementById('day_form_save_btn');
    if (btn) {
        btn.innerText = dayReviewHasExisting ? "Save Updates" : "Save Day Review";
        btn.className = "w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs transition shadow-lg shadow-purple-600/30";
    }
}

async function loadDayReviewData() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput) return;

    if (!dateInput.value) {
        dateInput.value = typeof getLocalTodayStr === 'function' ? getLocalTodayStr() : new Date().toISOString().slice(0, 10);
    }

    const dateStr = dateInput.value;
    try {
        const data = await api.get(`/revision/day-summary?date_str=${dateStr}`);
        currentDaySummary = data;
        dayBreakdownFilter = null;

        const badge = document.getElementById('day_review_status_badge');
        const saveBtn = document.getElementById('day_form_save_btn');

        if (data.day_review && !data.day_review.review_skipped) {
            dayReviewHasExisting = true;
            if (badge) {
                const gradeClasses = typeof getGradeColorClasses === 'function'
                    ? getGradeColorClasses(data.day_review.rating, 1, 5).badge
                    : "bg-emerald-900/60 text-emerald-300 border border-emerald-700";
                badge.innerText = `Reviewed (${data.day_review.rating}/5)`;
                badge.className = `px-2.5 py-1 rounded text-xs font-bold ${gradeClasses}`;
            }
            if (saveBtn) {
                saveBtn.innerText = "Save Updates";
                saveBtn.className = "w-full bg-[#222536] hover:bg-[#2d3046] text-slate-300 font-bold py-2 rounded-lg text-xs transition border border-[var(--border-muted)]";
            }
        } else if (data.day_review && data.day_review.review_skipped) {
            dayReviewHasExisting = true;
            if (badge) {
                badge.innerText = "Dismissed";
                badge.className = "px-2.5 py-1 rounded text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700";
            }
            if (saveBtn) {
                saveBtn.innerText = "Save Updates";
                saveBtn.className = "w-full bg-[#222536] hover:bg-[#2d3046] text-slate-300 font-bold py-2 rounded-lg text-xs transition border border-[var(--border-muted)]";
            }
        } else {
            dayReviewHasExisting = false;
            if (badge) {
                badge.innerText = "Missing Review";
                badge.className = "px-2.5 py-1 rounded text-xs font-bold bg-amber-900/60 text-amber-300 border border-amber-700";
            }
            if (saveBtn) {
                saveBtn.innerText = "Save Day Review";
                saveBtn.className = "w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs transition";
            }
        }

        const kpiContainer = document.getElementById('day_kpi_badges');
        if (kpiContainer) {
            kpiContainer.innerHTML = `
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Focus Time</span>
                    <span class="text-lg font-black text-purple-400">${data.total_hours}h</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Sessions</span>
                    <span class="text-lg font-black text-emerald-400">${data.total_sessions}</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Tasks Completed</span>
                    <span class="text-lg font-black text-blue-400">${data.completed_tasks_count}</span>
                </div>
            `;
        }

        const review = data.day_review;
        document.getElementById('day_form_rating').value = review ? review.rating : 3;
        document.getElementById('day_form_highlights').value = review ? (review.highlights || "") : "";
        document.getElementById('day_form_friction').value = review ? (review.friction || "") : "";
        document.getElementById('day_form_notes').value = review ? (review.notes || "") : "";
        applyDayRatingColor();

        await renderCustomRatingsInputs('day', dateStr, 'day_custom_ratings_container', data.custom_ratings);

        renderDayBreakdown();
        renderDaySessionsTimeline();

    } catch (e) {
        console.error("Failed to load day review:", e);
    }
}

function applyDayRatingColor() {
    const select = document.getElementById('day_form_rating');
    if (!select || typeof getGradeColorClasses !== 'function') return;
    const classes = getGradeColorClasses(parseInt(select.value), 1, 5);
    select.style.color = classes.hex;
}

function sessionMatchesDayFilter(s) {
    if (!dayBreakdownFilter) return true;
    if (dayBreakdownFilter.type === 'tag') {
        const tagStr = s.tags || '#general';
        const tokens = tagStr.split(/\s+/).filter(t => t.startsWith('#'));
        const effectiveTokens = tokens.length ? tokens : ['#general'];
        return effectiveTokens.includes(dayBreakdownFilter.value);
    }
    if (dayBreakdownFilter.type === 'task') {
        if (dayBreakdownFilter.value === '__none__') return !s.task_id;
        return String(s.task_id) === String(dayBreakdownFilter.value);
    }
    return true;
}

function toggleDayBreakdownFilter(type, value) {
    if (dayBreakdownFilter && dayBreakdownFilter.type === type && String(dayBreakdownFilter.value) === String(value)) {
        dayBreakdownFilter = null;
    } else {
        dayBreakdownFilter = { type, value };
    }
    renderDayBreakdown();
    renderDaySessionsTimeline();
}

function renderDayBreakdown() {
    if (!currentDaySummary) return;

    const totalEl = document.getElementById('day_breakdown_total');
    if (totalEl) totalEl.innerText = `${currentDaySummary.total_hours}h`;

    const chip = document.getElementById('day_breakdown_filter_chip');
    if (chip) {
        if (dayBreakdownFilter) {
            const label = dayBreakdownFilter.type === 'tag'
                ? dayBreakdownFilter.value
                : (dayBreakdownFilter.value === '__none__' ? 'Direct Session Log' : (currentDaySummary.task_breakdown.find(r => String(r.task_id) === String(dayBreakdownFilter.value)) || {}).title || 'Task');
            chip.classList.remove('hidden');
            chip.classList.add('flex');
            chip.innerHTML = `<span>Filtered: ${label}</span><button type="button" onclick="toggleDayBreakdownFilter('${dayBreakdownFilter.type}', '${dayBreakdownFilter.value}')" class="text-purple-300 hover:text-white font-black">&times;</button>`;
        } else {
            chip.classList.add('hidden');
            chip.classList.remove('flex');
            chip.innerHTML = '';
        }
    }

    const renderRow = (row, type, idOrValue) => {
        const isActive = dayBreakdownFilter && dayBreakdownFilter.type === type && String(dayBreakdownFilter.value) === String(idOrValue);
        const isDimmed = dayBreakdownFilter && !isActive;
        const rowClass = `bg-[#0f1016] border border-[var(--border-muted)] p-2.5 rounded-lg flex justify-between items-center cursor-pointer transition ${isActive ? 'ring-2 ring-purple-400' : ''} ${isDimmed ? 'opacity-40' : ''}`;
        const label = type === 'tag' ? row.tag : row.title;
        return `
            <div onclick="toggleDayBreakdownFilter('${type}', '${idOrValue}')" class="${rowClass}">
                <span class="text-xs font-bold ${type === 'tag' ? 'text-emerald-400' : 'text-purple-300'} truncate">${label}</span>
                <span class="text-xs font-black text-white shrink-0 ml-2">${row.total_hours}h <span class="text-slate-500 font-medium">(${row.percent}%)</span></span>
            </div>
        `;
    };

    const tagsList = document.getElementById('day_breakdown_tags_list');
    if (tagsList) {
        const rows = currentDaySummary.tag_breakdown || [];
        tagsList.innerHTML = rows.length === 0
            ? '<div class="text-xs text-slate-500">No activity logged.</div>'
            : rows.map(row => renderRow(row, 'tag', row.tag)).join('');
    }

    const tasksList = document.getElementById('day_breakdown_tasks_list');
    if (tasksList) {
        const rows = currentDaySummary.task_breakdown || [];
        tasksList.innerHTML = rows.length === 0
            ? '<div class="text-xs text-slate-500">No activity logged.</div>'
            : rows.map(row => renderRow(row, 'task', row.task_id === null ? '__none__' : row.task_id)).join('');
    }
}

function renderDaySessionsTimeline() {
    const timeline = document.getElementById('day_sessions_timeline');
    if (!timeline || !currentDaySummary) return;

    const sessions = (currentDaySummary.sessions || []).filter(sessionMatchesDayFilter);

    if (sessions.length === 0) {
        timeline.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No sessions logged for this day.</div>';
        return;
    }

    timeline.innerHTML = sessions.map(s => {
        const stStr = s.start_time ? new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '00:00';
        const etStr = s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NOW';
        const durMins = roundVal((s.duration_seconds || 0) / 60, 1);

        const mainHeading = s.task ? s.task.title : (s.notes || 'Direct Session Log');
        const subDesc = s.task ? (s.task.description || '') : '';
        const notesBody = s.task ? (s.notes || '') : '';

        return `
            <div onclick="openSessionReviewModal('${s.id}')" class="bg-[#0f1016] hover:bg-[#161824] border border-[var(--border-muted)] hover:border-purple-500 p-3 rounded-lg flex flex-col space-y-1.5 text-xs cursor-pointer transition">
                <div class="flex justify-between items-center">
                    <span class="font-mono text-purple-300 font-bold">[${stStr} - ${etStr}] (${durMins}m)</span>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800">${s.tags || '#general'}</span>
                </div>
                <div class="space-y-0.5">
                    <div class="font-black text-sm text-white">${mainHeading}</div>
                    ${subDesc ? `<div class="text-xs text-slate-400 line-clamp-1">${subDesc}</div>` : ''}
                </div>
                ${notesBody ? `<div class="text-slate-200 font-medium">${notesBody}</div>` : ''}
            </div>
        `;
    }).join('');
}

async function saveDayReviewForm() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput || !dateInput.value) return;

    const dateStr = dateInput.value;

    if (!validateRequiredCustomRatings('day', dateStr)) {
        return;
    }

    const ratingEl = document.getElementById('day_form_rating');
    const parsedRating = ratingEl ? parseInt(ratingEl.value) : 3;

    const payload = {
        date_str: dateStr,
        rating: isNaN(parsedRating) ? 3 : parsedRating,
        highlights: document.getElementById('day_form_highlights') ? document.getElementById('day_form_highlights').value || "" : "",
        friction: document.getElementById('day_form_friction') ? document.getElementById('day_form_friction').value || "" : "",
        notes: document.getElementById('day_form_notes') ? document.getElementById('day_form_notes').value || "" : "",
        review_skipped: false
    };

    await api.post('/revision/day-review', payload);
    await submitCustomRatings('day', dateStr);
    loadDayReviewData();
}

async function dismissDayReview() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput || !dateInput.value) return;

    const dateStr = dateInput.value;

    const confirmed = await showCustomConfirm(
        "Dismiss Day Review",
        `Mark day review for ${dateStr} as dismissed?`
    );

    if (confirmed) {
        const ratingEl = document.getElementById('day_form_rating');
        const parsedRating = ratingEl ? parseInt(ratingEl.value) : 3;

        const payload = {
            date_str: dateStr,
            rating: isNaN(parsedRating) ? 3 : parsedRating,
            highlights: document.getElementById('day_form_highlights') ? document.getElementById('day_form_highlights').value || "" : "",
            friction: document.getElementById('day_form_friction') ? document.getElementById('day_form_friction').value || "" : "",
            notes: document.getElementById('day_form_notes') ? document.getElementById('day_form_notes').value || "" : "",
            review_skipped: true
        };

        await api.post('/revision/day-review', payload);
        loadDayReviewData();
    }
}

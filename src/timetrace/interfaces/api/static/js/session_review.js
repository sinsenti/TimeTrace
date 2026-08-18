/**
 * Sessions Review List & Inspector Modal
 */

async function loadAllSessionsReview() {
    try {
        allRevisionSessions = await api.get('/sessions') || [];
        
        let tasksMap = {};
        try {
            const tasks = await api.get('/api/tasks?status=all');
            if (tasks) tasks.forEach(t => { tasksMap[t.id] = t; });
        } catch (e) {}

        let reviewedSessionIds = new Set();
        try {
            const entries = await api.get('/rating-entries?target_type=session&target_id=all');
            if (entries) {
                entries.forEach(e => {
                    if (!e.dismissed) reviewedSessionIds.add(String(e.target_id));
                });
            }
        } catch (e) {}

        allRevisionSessions.forEach(s => {
            s.is_reviewed = reviewedSessionIds.has(String(s.id));
            const attachedTask = s.task_id ? tasksMap[s.task_id] : null;
            s.attachedTask = attachedTask;
            const isExempt = s.review_skipped === true || (attachedTask && attachedTask.requires_session_review === false);
            s.is_exempt = isExempt;
            s.is_missed = !s.is_reviewed && !isExempt;
        });

        allRevisionSessions.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        filterSessionsReviewList();
    } catch (e) {
        console.error("Failed to load sessions for review:", e);
    }
}

function setSessionReviewFilter(filter) {
    currentSessionReviewFilter = filter;
    ['all', 'reviewed', 'missed', 'dismissed'].forEach(f => {
        const btn = document.getElementById(`sess_filter_${f}`);
        if (btn) btn.className = f === filter 
            ? "px-2.5 py-0.5 rounded font-bold bg-purple-600 text-white" 
            : "px-2.5 py-0.5 rounded font-bold text-slate-400 hover:text-white";
    });
    filterSessionsReviewList();
}

function filterSessionsReviewList() {
    const queryEl = document.getElementById('session_rev_search');
    const query = queryEl ? queryEl.value.trim().toLowerCase() : '';
    const container = document.getElementById('sessions_review_list');
    const badge = document.getElementById('session_rev_count_badge');

    if (!container) return;

    let filtered = allRevisionSessions;

    if (currentSessionReviewFilter === 'reviewed') {
        filtered = filtered.filter(s => s.is_reviewed);
    } else if (currentSessionReviewFilter === 'missed') {
        filtered = filtered.filter(s => s.is_missed);
    } else if (currentSessionReviewFilter === 'dismissed') {
        filtered = filtered.filter(s => s.is_exempt);
    }

    if (query) {
        filtered = filtered.filter(s => 
            (s.notes && s.notes.toLowerCase().includes(query)) ||
            (s.tags && s.tags.toLowerCase().includes(query)) ||
            (s.attachedTask && s.attachedTask.title.toLowerCase().includes(query))
        );
    }

    if (badge) badge.innerText = `${filtered.length} sessions`;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 text-center py-8">No matching session logs found.</div>';
        return;
    }

    container.innerHTML = filtered.map(s => {
        const st = new Date(s.start_time);
        const dateLabel = st.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        const timeLabel = `${st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NOW'}`;
        const durMins = roundVal((s.duration_seconds || 0) / 60, 1);

        let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/80 text-amber-400 border border-amber-800">Missed Review</span>';
        if (s.is_reviewed) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-900/60 text-emerald-300 border border-emerald-700">Reviewed</span>';
        } else if (s.is_exempt) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">Dismissed</span>';
        }

        const attachedTask = s.attachedTask;

        return `
            <div onclick="openSessionReviewModal(${s.id})" class="rev-card hover:border-purple-500 cursor-pointer space-y-2 text-xs transition">
                <div class="flex justify-between items-center border-b border-[var(--border-muted)] pb-2">
                    <div class="flex items-center space-x-2">
                        <span class="font-bold text-purple-400">${dateLabel} (${timeLabel})</span>
                        ${statusBadge}
                    </div>
                    <div class="flex items-center space-x-2">
                        ${!s.is_reviewed && !s.is_exempt ? `<button onclick="quickDismissSessionReview(${s.id}, event)" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-800/80 transition">Dismiss</button>` : ''}
                        <span class="font-mono font-bold text-slate-300">${durMins} mins</span>
                        <span class="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 font-bold border border-purple-800">${s.tags || '#general'}</span>
                    </div>
                </div>
                ${attachedTask ? `
                    <div class="space-y-0.5">
                        <div class="font-black text-sm text-white">${attachedTask.title}</div>
                        ${attachedTask.description ? `<div class="text-xs text-slate-400 line-clamp-1">${attachedTask.description}</div>` : ''}
                    </div>
                ` : ''}
                ${s.notes ? `<div class="text-slate-200 font-medium">${s.notes}</div>` : ''}
            </div>
        `;
    }).join('');
}

async function openSessionReviewModal(sessionId) {
    try {
        const session = await api.get(`/sessions/${sessionId}`);

        document.getElementById('session_rev_modal_id').value = session.id;

        const st = session.start_time ? new Date(session.start_time) : new Date();
        const et = session.end_time ? new Date(session.end_time) : new Date();
        const timeStr = `${st.toLocaleString()} - ${et.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        document.getElementById('session_rev_modal_time').innerText = timeStr;

        document.getElementById('session_rev_modal_tags').value = session.tags || '';
        document.getElementById('session_rev_modal_notes').value = session.notes || '';

        const skipCheck = document.getElementById('session_rev_modal_skip_check');
        if (skipCheck) skipCheck.checked = session.review_skipped === true;

        const entries = await api.get(`/rating-entries?target_type=session&target_id=${sessionId}`);
        await renderCustomRatingsInputs('session', sessionId, 'session_custom_ratings_container', entries || []);

        document.getElementById('session_review_modal').classList.remove('hidden');

        setTimeout(() => {
            const tagsInput = document.getElementById('session_rev_modal_tags');
            if (tagsInput) tagsInput.focus();
        }, 50);

    } catch (e) {
        console.error("Failed to open session review modal:", e);
    }
}

function closeSessionReviewModal() {
    const modal = document.getElementById('session_review_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSessionReviewModal() {
    const sessionId = document.getElementById('session_rev_modal_id').value;
    if (!sessionId) return;

    if (!validateRequiredCustomRatings('session', sessionId)) {
        return;
    }

    const tagsVal = document.getElementById('session_rev_modal_tags').value.trim();
    const notesVal = document.getElementById('session_rev_modal_notes').value.trim();
    const skipVal = document.getElementById('session_rev_modal_skip_check') ? document.getElementById('session_rev_modal_skip_check').checked : false;

    await api.put(`/sessions/${sessionId}`, { tags: tagsVal, notes: notesVal, review_skipped: skipVal });
    await submitCustomRatings('session', sessionId);

    closeSessionReviewModal();
    loadCurrentRevisionView();
}

async function resetSessionReview() {
    const sessionId = document.getElementById('session_rev_modal_id').value;
    if (!sessionId) return;

    const confirmed = await showCustomConfirm(
        "Reset Session Review",
        "Are you sure you want to remove all review ratings for this session and mark it as unreviewed?"
    );

    if (confirmed) {
        await api.delete(`/rating-entries?target_type=session&target_id=${sessionId}`);
        await api.put(`/sessions/${sessionId}`, { review_skipped: false });

        closeSessionReviewModal();
        loadCurrentRevisionView();
    }
}

async function quickDismissSessionReview(sessionId, event) {
    if (event) event.stopPropagation();
    await api.put(`/sessions/${sessionId}`, { review_skipped: true });
    loadCurrentRevisionView();
}

async function deleteSessionFromReviewModal() {
    const sessionId = document.getElementById('session_rev_modal_id').value;
    if (!sessionId) return;

    const confirmed = await showCustomConfirm("Delete Session Log", "Are you sure you want to delete this session log? This action cannot be undone.");
    if (confirmed) {
        await api.delete(`/sessions/${sessionId}`);
        closeSessionReviewModal();
        loadCurrentRevisionView();
    }
}

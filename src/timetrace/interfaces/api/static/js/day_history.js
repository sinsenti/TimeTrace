/**
 * Historical Day Revisions Grid
 */

async function loadDayHistoryOverview() {
    try {
        allDayHistoryList = await api.get('/revision/day-history') || [];
        renderDayHistoryGrid();
    } catch (e) {
        console.error("Failed to load day history overview:", e);
    }
}

function setHistoryFilter(filter) {
    currentDayHistoryFilter = filter;
    ['all', 'reviewed', 'missed', 'dismissed'].forEach(f => {
        const btn = document.getElementById(`hist_filter_${f}`);
        if (btn) btn.className = f === filter 
            ? "px-3 py-1 rounded font-bold bg-purple-600 text-white" 
            : "px-3 py-1 rounded font-bold text-slate-400 hover:text-white";
    });
    renderDayHistoryGrid();
}

function renderDayHistoryGrid() {
    const grid = document.getElementById('day_history_grid');
    if (!grid) return;

    let filtered = allDayHistoryList;
    if (currentDayHistoryFilter === 'reviewed') {
        filtered = filtered.filter(d => d.has_review && !d.review_skipped);
    } else if (currentDayHistoryFilter === 'missed') {
        filtered = filtered.filter(d => !d.has_review && !d.review_skipped);
    } else if (currentDayHistoryFilter === 'dismissed') {
        filtered = filtered.filter(d => d.review_skipped);
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-xs text-slate-500 text-center py-8">No matching days found in history.</div>';
        return;
    }

    grid.innerHTML = filtered.map(d => {
        const dateObj = new Date(d.date_str + "T00:00:00");
        const formattedDate = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        
        let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/80 text-amber-400 border border-amber-800">Missing Review</span>';
        if (d.review_skipped) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">Dismissed</span>';
        } else if (d.has_review) {
            const gradeClasses = typeof getGradeColorClasses === 'function'
                ? getGradeColorClasses(d.rating, 1, 5).badge
                : "bg-emerald-900/60 text-emerald-300 border border-emerald-700";
            statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${gradeClasses}">Reviewed (${d.rating}/5)</span>`;
        }

        return `
            <div onclick="jumpToDayReview('${d.date_str}')" class="rev-card hover:border-purple-500 cursor-pointer transition space-y-2">
                <div class="flex justify-between items-center border-b border-[var(--border-muted)] pb-2">
                    <span class="font-bold text-sm text-white">${formattedDate}</span>
                    ${statusBadge}
                </div>
                <div class="flex justify-between items-center text-xs text-slate-400">
                    <span>${d.total_hours} focus hours</span>
                    <span>${d.session_count} sessions</span>
                </div>
                ${d.highlights ? `<p class="text-xs text-slate-300 line-clamp-2"><span class="font-bold text-emerald-400">Highlights:</span> ${d.highlights}</p>` : ''}
                ${d.friction ? `<p class="text-xs text-slate-300 line-clamp-2"><span class="font-bold text-amber-400">Friction:</span> ${d.friction}</p>` : ''}
            </div>
        `;
    }).join('');
}

function jumpToDayReview(dateStr) {
    switchRevisionTab('day');
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput) {
        dateInput.value = dateStr;
        loadDayReviewData();
    }
}

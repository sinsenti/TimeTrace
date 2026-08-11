let allTasksMap = {};
let attachedTask = null;
let activeTaskSuggestionIndex = -1;

async function fetchAllTasksRegistry() {
    try {
        const res = await fetch('/api/v1/tasks?status=all');
        const tasks = await res.json();
        allTasksMap = {};
        tasks.forEach(t => {
            allTasksMap[t.id] = t;
        });
    } catch(e) {}
}

function renderTaskSuggestions(query) {
    const dropdown = document.getElementById('task_suggestions_dropdown');
    if (!dropdown) return;

    let q = (query || "").trim().toLowerCase();
    const tasks = Object.values(allTasksMap);
    let filtered = tasks.filter(t => !q || t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q)));

    if (filtered.length === 0) {
        dropdown.classList.add('hidden');
        activeTaskSuggestionIndex = -1;
        return;
    }

    activeTaskSuggestionIndex = 0;
    dropdown.innerHTML = filtered.map((t, idx) => `
        <div onclick="attachTaskById(${t.id})" class="task-suggestion-item px-3 py-2 hover:bg-[#1a1c28] cursor-pointer text-xs flex items-center justify-between border-b border-[#1a1c26] last:border-b-0 transition ${idx === 0 ? 'bg-[#1a1c28]' : ''}">
            <div>
                <span class="font-bold text-white block">${t.title}</span>
                <span class="text-[10px] text-slate-400 truncate block">${t.description || ''}</span>
            </div>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style="background-color: ${t.color || '#7c3aed'}">#${t.id}</span>
        </div>
    `).join('');

    dropdown.classList.remove('hidden');
}

function highlightTaskSuggestionItem(items) {
    items.forEach((item, idx) => {
        if (idx === activeTaskSuggestionIndex) {
            item.classList.add('bg-[#1a1c28]');
        } else {
            item.classList.remove('bg-[#1a1c28]');
        }
    });
}

function attachTaskById(taskId, preventFocus = false) {
    const t = allTasksMap[taskId];
    if (!t) return;
    attachedTask = t;

    document.getElementById('session_modal_task_id').value = t.id;
    renderTaskChip();

    // Auto-populate task's default tags if defined
    if (t.tags) {
        setTagChips(t.tags);
    }

    const input = document.getElementById('session_modal_task_search');
    if (input) input.value = '';

    const dropdown = document.getElementById('task_suggestions_dropdown');
    if (dropdown) dropdown.classList.add('hidden');

    if (!preventFocus) {
        const tagInput = document.getElementById('session_modal_tags_input');
        if (tagInput) setTimeout(() => tagInput.focus(), 20);
    }
}

function detachTask() {
    attachedTask = null;
    document.getElementById('session_modal_task_id').value = '';
    renderTaskChip();
}

function renderTaskChip() {
    const container = document.getElementById('task_chip_container');
    const input = document.getElementById('session_modal_task_search');
    if (!container || !input) return;

    container.querySelectorAll('.task-chip-item').forEach(el => el.remove());

    if (attachedTask) {
        const chip = document.createElement('span');
        chip.className = 'task-chip-item px-2.5 py-1 rounded text-xs font-bold text-white flex items-center space-x-1.5 shadow-sm shrink-0';
        chip.style.backgroundColor = attachedTask.color || '#7c3aed';
        chip.innerHTML = `
            <span>✓ ${attachedTask.title}</span>
            <button type="button" onclick="detachTask()" class="hover:text-red-200 text-xs font-black ml-1">&times;</button>
        `;
        container.insertBefore(chip, input);
        input.placeholder = "Attached! Type to change task...";
    } else {
        input.placeholder = "Search/Type task... (Press Enter to attach top match)";
    }
}

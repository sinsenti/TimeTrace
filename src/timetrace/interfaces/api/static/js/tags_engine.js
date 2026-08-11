let currentTagChips = [];
let activeTagSuggestionIndex = -1;

function setTagChips(tagStr) {
    if (!tagStr) {
        currentTagChips = [];
    } else {
        const raw = tagStr.split(' ').map(t => t.trim()).filter(t => t.startsWith('#'));
        currentTagChips = [...new Set(raw)];
    }
    renderTagChips();
}

function addTagChip(rawTag) {
    let clean = rawTag.trim();
    if (!clean) return;
    if (!clean.startsWith('#')) clean = `#${clean}`;
    if (!currentTagChips.includes(clean)) {
        currentTagChips.push(clean);
        renderTagChips();
    }
}

function removeTagChip(index) {
    currentTagChips.splice(index, 1);
    renderTagChips();
}

function renderTagChips() {
    const container = document.getElementById('tag_chips_container');
    const input = document.getElementById('session_modal_tags_input');
    if (!container || !input) return;

    container.querySelectorAll('.tag-chip').forEach(el => el.remove());

    currentTagChips.forEach((tag, idx) => {
        const color = getTagColor(tag);
        const chip = document.createElement('span');
        chip.className = 'tag-chip px-2 py-0.5 rounded text-xs font-bold text-white flex items-center space-x-1 shadow-sm';
        chip.style.backgroundColor = color;
        chip.innerHTML = `
            <span>${tag}</span>
            <button type="button" onclick="removeTagChip(${idx})" class="hover:text-red-200 text-[10px] font-black ml-1">&times;</button>
        `;
        container.insertBefore(chip, input);
    });
}

function getAllSystemTags() {
    let tagSet = new Set(['#progr', '#backend', '#frontend', '#meeting', '#planning', '#review', '#design', '#bugfix']);
    
    if (typeof allSessions !== 'undefined') {
        allSessions.forEach(s => {
            if (s.tags) {
                s.tags.split(' ').forEach(t => {
                    if (t.startsWith('#')) tagSet.add(t.trim());
                });
            }
        });
    }

    return Array.from(tagSet);
}

function renderTagSuggestions(query) {
    const dropdown = document.getElementById('tag_suggestions_dropdown');
    if (!dropdown) return;

    let q = (query || "").trim().toLowerCase();
    if (q.startsWith('#')) q = q.slice(1);

    const allTags = getAllSystemTags();
    let filtered = allTags.filter(t => t.toLowerCase().includes(q) && !currentTagChips.includes(t));

    if (filtered.length === 0) {
        dropdown.classList.add('hidden');
        activeTagSuggestionIndex = -1;
        return;
    }

    activeTagSuggestionIndex = 0;
    dropdown.innerHTML = filtered.map((tag, idx) => `
        <div onclick="selectTagSuggestion('${tag}')" class="tag-suggestion-item px-3 py-1.5 hover:bg-[#1a1c28] cursor-pointer text-xs flex items-center justify-between transition ${idx === 0 ? 'bg-[#1a1c28]' : ''}">
            <span class="font-bold text-purple-300">${tag}</span>
            <span class="text-[10px] text-slate-500">Press Enter</span>
        </div>
    `).join('');

    dropdown.classList.remove('hidden');
}

function selectTagSuggestion(tag) {
    addTagChip(tag);
    const input = document.getElementById('session_modal_tags_input');
    if (input) {
        input.value = '';
        input.focus();
    }
    const dropdown = document.getElementById('tag_suggestions_dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}

function highlightTagSuggestionItem(items) {
    items.forEach((item, idx) => {
        if (idx === activeTagSuggestionIndex) {
            item.classList.add('bg-[#1a1c28]');
        } else {
            item.classList.remove('bg-[#1a1c28]');
        }
    });
}

/**
 * TimeTrace AI Assistant -- drawer state, conversation switching, streaming chat consumption.
 *
 * All model-generated text renders via `textContent`, never `innerHTML`/Markdown (spec S9.5).
 * Ids are UUIDv7 strings: `addEventListener` + `dataset`, never `parseInt` or an unquoted
 * `onclick` (spec S9.6). Toggled by the navbar launcher and Ctrl+Shift+A only (spec S9.4) --
 * NOT Ctrl+K, which vim_engine.js already binds.
 */

let aiCurrentConversationId = null;
let aiConversationsCache = [];
let aiStreamInFlight = false;

function isAiDrawerOpen() {
    const el = document.getElementById('ai_drawer');
    return Boolean(el && el.classList.contains('ai-drawer-open'));
}

function openAiDrawer() {
    const el = document.getElementById('ai_drawer');
    if (!el) return;
    el.classList.add('ai-drawer-open');
    if (aiConversationsCache.length === 0) {
        aiLoadConversations();
    }
    const input = document.getElementById('ai_composer_input');
    if (input) input.focus();
}

function closeAiDrawer() {
    if (isAiFullscreenActive()) aiExitFullscreen(); // never leave the calendar stranded in a hidden drawer
    const el = document.getElementById('ai_drawer');
    if (el) el.classList.remove('ai-drawer-open');
}

function toggleAiDrawer() {
    if (isAiDrawerOpen()) closeAiDrawer();
    else openAiDrawer();
}
window.closeAiDrawer = closeAiDrawer;
window.openAiDrawer = openAiDrawer;

// -- Full screen (calendar + chat side by side) --------------------------------------------

// Where the page's own #calendar element normally lives, so aiExitFullscreen can put it back
// exactly where it came from instead of guessing.
let aiCalendarHomeParent = null;
let aiCalendarHomeNextSibling = null;

function isAiFullscreenActive() {
    const el = document.getElementById('ai_drawer');
    return Boolean(el && el.classList.contains('ai-drawer-fullscreen'));
}

function aiPageHasCalendar() {
    // `calendar` is dashboard.js's top-level FullCalendar instance -- only defined (and only a
    // real object, not just `undefined`) on the dashboard page. Checking both the JS variable
    // and the DOM element it's bound to guards against a page that has one but not the other.
    // NOTE: only safe to call from user-triggered handlers after dashboard.js has run -- never
    // from early/module-top-level/DOMContentLoaded-race code (the `calendar` `let` binding may
    // not exist yet, which throws a ReferenceError rather than evaluating falsy).
    return typeof calendar !== 'undefined' && calendar && Boolean(document.getElementById('calendar'));
}

// Reads the page header's rendered height (0 if there's no `body > header`) and publishes it as
// a CSS variable so the fullscreen drawer can sit below page chrome instead of covering it.
function aiMeasureFullscreenTop() {
    const header = document.querySelector('body > header');
    const h = header ? header.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--ai-fullscreen-top', `${h}px`);
}

function aiHandleFullscreenResize() {
    if (!isAiFullscreenActive()) return;
    aiMeasureFullscreenTop();
}

window.addEventListener('resize', aiHandleFullscreenResize);

function aiEnterFullscreen() {
    const drawer = document.getElementById('ai_drawer');
    const pane = document.getElementById('ai_drawer_calendar_pane');
    if (!drawer || !pane) return;
    aiMeasureFullscreenTop();
    aiRestoreFullscreenChatWidth();
    if (!isAiDrawerOpen()) openAiDrawer();

    drawer.classList.add('ai-drawer-no-transition');
    drawer.classList.add('ai-drawer-fullscreen');

    if (aiPageHasCalendar()) {
        const calendarEl = document.getElementById('calendar');
        aiCalendarHomeParent = calendarEl.parentElement;
        aiCalendarHomeNextSibling = calendarEl.nextSibling;
        pane.appendChild(calendarEl);
        pane.classList.remove('hidden');
    }

    // FullCalendar sizes itself off its container's rendered dimensions at the moment of the
    // move; ask it to recompute once the new layout has actually painted rather than in the
    // same frame as the reparent/class toggle (which may still be mid-CSS-transition).
    requestAnimationFrame(() => {
        if (aiPageHasCalendar()) calendar.updateSize();
        drawer.classList.remove('ai-drawer-no-transition');
    });

    const btn = document.getElementById('ai_fullscreen_toggle_btn');
    if (btn) { btn.textContent = 'Exit Fullscreen'; btn.title = 'Exit full screen'; }
}

function aiExitFullscreen() {
    const drawer = document.getElementById('ai_drawer');
    const pane = document.getElementById('ai_drawer_calendar_pane');
    if (!drawer) return;

    drawer.classList.add('ai-drawer-no-transition');
    drawer.classList.remove('ai-drawer-fullscreen');

    if (aiCalendarHomeParent) {
        const calendarEl = document.getElementById('calendar');
        if (calendarEl) {
            aiCalendarHomeParent.insertBefore(calendarEl, aiCalendarHomeNextSibling);
        }
        aiCalendarHomeParent = null;
        aiCalendarHomeNextSibling = null;
    }
    if (pane) pane.classList.add('hidden');

    requestAnimationFrame(() => {
        if (typeof calendar !== 'undefined' && calendar) calendar.updateSize();
        drawer.classList.remove('ai-drawer-no-transition');
    });

    const btn = document.getElementById('ai_fullscreen_toggle_btn');
    if (btn) { btn.textContent = 'Fullscreen'; btn.title = 'Toggle full screen'; }
}

function aiToggleFullscreen() {
    if (isAiFullscreenActive()) aiExitFullscreen();
    else aiEnterFullscreen();
}
window.toggleAiDrawer = toggleAiDrawer;

function aiAppendThreadNode(node) {
    const thread = document.getElementById('ai_thread');
    if (!thread) return null;
    thread.appendChild(node);
    const body = document.getElementById('ai_drawer_body');
    if (body) body.scrollTop = body.scrollHeight;
    return node;
}

function aiAppendMessageBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `ai-msg ai-msg-${role}`;
    bubble.textContent = text; // spec S9.5: textContent only, never innerHTML/markdown
    return aiAppendThreadNode(bubble);
}

function aiAppendStatusLine(text) {
    const line = document.createElement('div');
    line.className = 'ai-msg-status';
    line.textContent = text;
    return aiAppendThreadNode(line);
}

function aiAppendToolAnnotation(text) {
    const line = document.createElement('div');
    line.className = 'ai-msg-tool';
    line.textContent = text;
    return aiAppendThreadNode(line);
}

function aiClearThread() {
    const thread = document.getElementById('ai_thread');
    if (thread) thread.textContent = '';
}

function aiRenderEmptyThreadHint() {
    const hint = document.createElement('div');
    hint.className = 'ai-thread-empty';
    hint.textContent = 'No messages yet. Ask about rescheduling, quick-add, or planning your week.';
    aiAppendThreadNode(hint);
}

async function aiLoadConversations() {
    try {
        aiConversationsCache = await api.get('/api/ai/conversations');
        const select = document.getElementById('ai_conversation_select');
        if (select) {
            select.textContent = '';
            aiConversationsCache.forEach((conv) => {
                const opt = document.createElement('option');
                opt.value = conv.id;
                opt.textContent = conv.title || '(untitled conversation)';
                select.appendChild(opt);
            });
        }
        if (aiConversationsCache.length > 0) {
            const targetId = aiCurrentConversationId || aiConversationsCache[0].id;
            if (select) select.value = targetId;
            await aiSelectConversation(targetId);
        } else {
            aiClearThread();
            aiRenderEmptyThreadHint();
        }
    } catch (err) {
        console.error('Failed to load AI conversations:', err);
    }
}

async function aiSelectConversation(conversationId) {
    if (!conversationId) return;
    aiCurrentConversationId = conversationId;
    const select = document.getElementById('ai_conversation_select');
    if (select) select.value = conversationId;

    aiClearThread();
    try {
        const detail = await api.get(`/api/ai/conversations/${encodeURIComponent(conversationId)}`);
        const messages = detail.messages || [];
        if (messages.length === 0) {
            aiRenderEmptyThreadHint();
        }
        for (const msg of messages) {
            if (msg.role === 'user') {
                aiAppendMessageBubble('user', msg.content);
            } else if (msg.role === 'assistant') {
                if (msg.content) aiAppendMessageBubble('assistant', msg.content);
                if (msg.draft_batch_id) {
                    await aiRenderDraftBatchById(msg.draft_batch_id);
                }
            } else if (msg.role === 'tool') {
                aiAppendToolAnnotation(`tool: ${msg.tool_name || 'unknown'}${msg.error ? ' (error)' : ''}`);
            }
        }
    } catch (err) {
        console.error('Failed to load AI conversation detail:', err);
        aiAppendMessageBubble('error', 'Failed to load this conversation.');
    }
}

async function aiRenderDraftBatchById(batchId) {
    try {
        const batch = await api.get(`/api/ai/drafts/batches/${encodeURIComponent(batchId)}`);
        aiAppendThreadNode(aiBuildDraftBatchNode(batch, { onChanged: refreshAiStatusBadge }));
    } catch (err) {
        console.error('Failed to load draft batch for chat turn:', err);
    }
}

async function aiCreateConversation() {
    try {
        const conv = await api.post('/api/ai/conversations', {});
        aiConversationsCache.unshift(conv);
        const select = document.getElementById('ai_conversation_select');
        if (select) {
            const opt = document.createElement('option');
            opt.value = conv.id;
            opt.textContent = conv.title || '(untitled conversation)';
            select.insertBefore(opt, select.firstChild);
        }
        await aiSelectConversation(conv.id);
    } catch (err) {
        console.error('Failed to create AI conversation:', err);
        alert('Failed to start a new conversation: ' + (err.message || err));
    }
}

async function aiRenameCurrentConversation() {
    if (!aiCurrentConversationId) return;
    const current = aiConversationsCache.find((c) => c.id === aiCurrentConversationId);
    const nextTitle = prompt('Rename conversation', (current && current.title) || '');
    if (nextTitle === null) return; // cancelled
    const trimmed = nextTitle.trim();
    if (!trimmed) return;

    try {
        const updated = await api.request(`/api/ai/conversations/${encodeURIComponent(aiCurrentConversationId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: trimmed }),
        });
        if (current) current.title = updated.title;
        const select = document.getElementById('ai_conversation_select');
        const opt = select && select.querySelector(`option[value="${CSS.escape(aiCurrentConversationId)}"]`);
        if (opt) opt.textContent = updated.title || '(untitled conversation)';
    } catch (err) {
        console.error('Failed to rename AI conversation:', err);
        alert('Failed to rename conversation: ' + (err.message || err));
    }
}

async function aiEnsureConversation() {
    if (aiCurrentConversationId) return aiCurrentConversationId;
    await aiCreateConversation();
    return aiCurrentConversationId;
}

async function aiSendMessage() {
    if (aiStreamInFlight) return;
    const input = document.getElementById('ai_composer_input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const conversationId = await aiEnsureConversation();
    if (!conversationId) return;

    input.value = '';
    aiAutoGrowComposer(input);
    const emptyHint = document.querySelector('#ai_thread .ai-thread-empty');
    if (emptyHint) emptyHint.remove();
    aiAppendMessageBubble('user', text);

    const sendBtn = document.getElementById('ai_composer_send');
    if (sendBtn) sendBtn.disabled = true;
    aiStreamInFlight = true;

    let statusNode = null;
    let assistantBubble = null;
    let assistantText = '';

    const setStatus = (label) => {
        if (!statusNode) {
            statusNode = aiAppendStatusLine(label);
        } else {
            statusNode.textContent = label;
        }
    };

    try {
        await api.stream(`/api/ai/conversations/${encodeURIComponent(conversationId)}/messages`, { text, stream: true }, (evt) => {
            switch (evt.event) {
                case 'message_start':
                    setStatus('thinking...');
                    break;
                case 'status': {
                    const label = (evt.data && (evt.data.message || evt.data.label || evt.data.status)) || 'working...';
                    setStatus(String(label));
                    break;
                }
                case 'token': {
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    const piece = (evt.data && (evt.data.token !== undefined ? evt.data.token : evt.data.text)) || '';
                    assistantText += piece;
                    if (!assistantBubble) {
                        assistantBubble = document.createElement('div');
                        assistantBubble.className = 'ai-msg ai-msg-assistant';
                        aiAppendThreadNode(assistantBubble);
                    }
                    assistantBubble.textContent = assistantText; // textContent only -- spec S9.5
                    const body = document.getElementById('ai_drawer_body');
                    if (body) body.scrollTop = body.scrollHeight;
                    break;
                }
                case 'draft': {
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    const batch = evt.data;
                    if (batch && batch.id) {
                        aiAppendThreadNode(aiBuildDraftBatchNode(batch, { onChanged: refreshAiStatusBadge }));
                        if (typeof loadAiDraftOverlay === 'function') loadAiDraftOverlay();
                    }
                    break;
                }
                case 'message_end':
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    break;
                case 'error': {
                    if (statusNode) { statusNode.remove(); statusNode = null; }
                    const msg = (evt.data && (evt.data.error || evt.data.message)) || 'The assistant hit an error.';
                    aiAppendMessageBubble('error', String(msg));
                    break;
                }
                default:
                    break;
            }
        });
    } catch (err) {
        console.error('AI chat stream failed:', err);
        if (statusNode) { statusNode.remove(); statusNode = null; }
        aiAppendMessageBubble('error', 'Failed to reach the assistant: ' + (err.message || err));
    } finally {
        aiStreamInFlight = false;
        if (sendBtn) sendBtn.disabled = false;
        refreshAiStatusBadge();
    }
}

async function refreshAiStatusBadge() {
    const badge = document.getElementById('ai_launcher_badge');
    try {
        const status = await api.get('/api/ai/status');
        const count = (status.pending_draft_count || 0) + (status.undoable_batch_count || 0);
        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    } catch (err) {
        // Non-fatal: badge just stays as last known state (or hidden if a provider isn't
        // configured yet -- /status still returns 200 with configured=false in that case).
        console.error('Failed to refresh AI status badge:', err);
    }
}

const AI_DRAWER_WIDTH_STORAGE_KEY = 'tt_ai_drawer_width_px';
const AI_DRAWER_MIN_WIDTH = 320;
const AI_FULLSCREEN_CHAT_WIDTH_STORAGE_KEY = 'tt_ai_fullscreen_chat_width_px';

function aiDrawerMaxWidth() {
    // Leave at least ~280px of calendar/content visible rather than letting the drawer
    // swallow the whole viewport on a narrow window.
    return Math.max(AI_DRAWER_MIN_WIDTH, window.innerWidth - 280);
}

function aiApplyDrawerWidth(widthPx) {
    const el = document.getElementById('ai_drawer');
    if (!el) return;
    const clamped = Math.min(Math.max(widthPx, AI_DRAWER_MIN_WIDTH), aiDrawerMaxWidth());
    el.style.width = `${clamped}px`;
    return clamped;
}

function aiRestoreDrawerWidth() {
    const stored = window.localStorage ? window.localStorage.getItem(AI_DRAWER_WIDTH_STORAGE_KEY) : null;
    if (!stored) return;
    const widthPx = parseInt(stored, 10);
    if (Number.isFinite(widthPx) && widthPx > 0) aiApplyDrawerWidth(widthPx);
}

// -- Full-screen chat/calendar split width (separate from the normal-mode drawer width above) --

function aiFullscreenChatMaxWidth() {
    // Mirror aiDrawerMaxWidth's reasoning: never let the chat column swallow the whole viewport
    // and leave the calendar pane with nothing.
    return Math.max(AI_DRAWER_MIN_WIDTH, window.innerWidth - 320);
}

function aiApplyFullscreenChatWidth(widthPx) {
    const clamped = Math.min(Math.max(widthPx, AI_DRAWER_MIN_WIDTH), aiFullscreenChatMaxWidth());
    document.documentElement.style.setProperty('--ai-chat-width', `${clamped}px`);
    return clamped;
}

function aiRestoreFullscreenChatWidth() {
    const stored = window.localStorage
        ? window.localStorage.getItem(AI_FULLSCREEN_CHAT_WIDTH_STORAGE_KEY)
        : null;
    if (!stored) return;
    const widthPx = parseInt(stored, 10);
    if (Number.isFinite(widthPx) && widthPx > 0) aiApplyFullscreenChatWidth(widthPx);
}

function aiSetupDrawerResize() {
    const handle = document.getElementById('ai_drawer_resize_handle');
    const drawer = document.getElementById('ai_drawer');
    if (!handle || !drawer) return;

    let dragging = false;

    const onMove = (e) => {
        if (!dragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        if (isAiFullscreenActive()) {
            aiApplyFullscreenChatWidth(window.innerWidth - clientX);
        } else {
            aiApplyDrawerWidth(window.innerWidth - clientX);
        }
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('ai-drawer-resize-active');
        drawer.classList.remove('ai-drawer-resizing');
        document.body.style.userSelect = '';
        try {
            if (isAiFullscreenActive()) {
                const chatWidth = getComputedStyle(document.documentElement).getPropertyValue('--ai-chat-width');
                const widthPx = parseInt(chatWidth, 10);
                if (Number.isFinite(widthPx) && widthPx > 0) {
                    window.localStorage.setItem(AI_FULLSCREEN_CHAT_WIDTH_STORAGE_KEY, String(widthPx));
                }
            } else {
                window.localStorage.setItem(AI_DRAWER_WIDTH_STORAGE_KEY, String(parseInt(drawer.style.width, 10)));
            }
        } catch (_err) {
            // localStorage can throw in a private/blocked context -- resizing still works this session.
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
    };

    const onDown = (e) => {
        dragging = true;
        handle.classList.add('ai-drawer-resize-active');
        drawer.classList.add('ai-drawer-resizing');
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        e.preventDefault();
    };

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });

    window.addEventListener('resize', () => aiApplyDrawerWidth(drawer.getBoundingClientRect().width));
}

function aiAutoGrowComposer(el) {
    // Grow the textarea to fit its content as the user types multiline text, up to the
    // `max-height` set in ai.css -- the browser itself enforces that cap and switches to an
    // internal scrollbar once `scrollHeight` exceeds it, so this only needs to ask for
    // "as tall as the content wants to be" each time, not compute the limit itself.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}

function aiSetupDrawer() {
    aiRestoreDrawerWidth();
    aiSetupDrawerResize();

    const closeBtn = document.getElementById('ai_drawer_close_btn');
    if (closeBtn) closeBtn.addEventListener('click', closeAiDrawer);

    const newConvBtn = document.getElementById('ai_new_conversation_btn');
    if (newConvBtn) newConvBtn.addEventListener('click', aiCreateConversation);

    const renameConvBtn = document.getElementById('ai_rename_conversation_btn');
    if (renameConvBtn) renameConvBtn.addEventListener('click', aiRenameCurrentConversation);

    const fullscreenBtn = document.getElementById('ai_fullscreen_toggle_btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', aiToggleFullscreen);
        // Safe here (user-triggered setup after page load), unlike inside aiPageHasCalendar's
        // own early-call guard -- a plain DOM check is enough to decide whether this page can
        // ever go fullscreen with a calendar pane.
        if (!document.getElementById('calendar')) fullscreenBtn.classList.add('hidden');
    }

    const calendarPaneEl = document.getElementById('ai_drawer_calendar_pane');
    if (calendarPaneEl && typeof ResizeObserver !== 'undefined') {
        let resizeDebounce = null;
        const observer = new ResizeObserver(() => {
            if (resizeDebounce) clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(() => {
                if (aiPageHasCalendar()) calendar.updateSize();
            }, 50);
        });
        observer.observe(calendarPaneEl);
    }

    const select = document.getElementById('ai_conversation_select');
    if (select) select.addEventListener('change', (e) => aiSelectConversation(e.target.value));

    const sendBtn = document.getElementById('ai_composer_send');
    if (sendBtn) sendBtn.addEventListener('click', aiSendMessage);

    const input = document.getElementById('ai_composer_input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                aiSendMessage();
            }
        });
        input.addEventListener('input', () => aiAutoGrowComposer(input));
        aiAutoGrowComposer(input);
    }

    const draftsToggleBtn = document.getElementById('ai_drafts_toggle_btn');
    const draftsPanel = document.getElementById('ai_drafts_panel');
    const drawerBody = document.getElementById('ai_drawer_body');
    if (draftsToggleBtn && draftsPanel && drawerBody) {
        draftsToggleBtn.addEventListener('click', () => {
            const showing = !draftsPanel.classList.contains('hidden');
            if (showing) {
                draftsPanel.classList.add('hidden');
                drawerBody.classList.remove('hidden');
                draftsToggleBtn.textContent = 'Drafts';
            } else {
                draftsPanel.classList.remove('hidden');
                drawerBody.classList.add('hidden');
                draftsToggleBtn.textContent = 'Chat';
                aiLoadBatchesPanel();
            }
        });
    }

    const undoAllBtn = document.getElementById('ai_undo_all_btn');
    if (undoAllBtn) undoAllBtn.addEventListener('click', aiUndoAllBatches);

    const launcherBtn = document.getElementById('ai_launcher_btn');
    if (launcherBtn) launcherBtn.addEventListener('click', toggleAiDrawer);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
            e.preventDefault();
            toggleAiDrawer();
        }
    });

    refreshAiStatusBadge();
}

document.addEventListener('DOMContentLoaded', aiSetupDrawer);

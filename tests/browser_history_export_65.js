/* Isolated Orca browser probe: synthetic scratch daemon/profile only.
 * Evaluate this async function on /agenda-view?date=2000-01-04.
 * Download verification uses Orca's typed download command separately.
 */
(async () => {
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const wait = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        throw Error('Timed out waiting for public UI');
    };
    const find = text => [...document.querySelectorAll('dialog button')].find(button => button.textContent === text);
    document.querySelector('dialog')?.close();
    if (!document.querySelector('#agenda-detail textarea')) document.querySelector('.agenda-entry')?.click();
    const dirtyEditor = document.querySelector('#agenda-detail textarea');
    check(dirtyEditor, 'saved work note editor available');
    const draft = 'Synthetic unsaved editor draft café';
    dirtyEditor.value = draft; dirtyEditor.dispatchEvent(new Event('input'));
    const noteFilter = document.getElementById('agenda-filter-note');
    noteFilter.value = 'café'; noteFilter.dispatchEvent(new Event('input'));
    document.getElementById('history-export-open').click();
    find('Load eligible rows').click();
    await wait(() => document.querySelectorAll('dialog fieldset input').length > 0);
    const group = document.querySelector('dialog fieldset input');
    group.click();
    find('Preview checkbox selection').click();
    await wait(() => !find('Download preview').disabled);
    const preview = document.querySelector('dialog textarea');
    check(preview.value.includes('café'), 'literal Unicode filtered note retained');
    check(preview.value.includes('mode=selected'), 'explicit selected mode');
    const frozen = preview.value;
    const clipboard = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async () => { throw Error('synthetic clipboard denial'); };
    try {
        find('Copy preview').click();
        await wait(() => document.querySelector('dialog [role=status]').textContent.includes('synthetic clipboard denial'));
        check(preview.value === frozen && !find('Download preview').disabled, 'clipboard failure retains accepted bytes');
    } finally { navigator.clipboard.writeText = clipboard; }
    const width = document.querySelector('dialog').getBoundingClientRect().width;
    check(width <= window.innerWidth, 'dialog bounded to viewport');
    // Inject only the external read boundary to exercise late response ownership.
    const original = api.post.bind(api);
    const envelope = await original('/api/agenda/history-export/preview', {
        start_date:'2000-01-04',end_date:'2000-01-04',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        mode:'filtered',note:'café',
    });
    try {
        api.post = async () => envelope;
        find('Preview ALL filtered matches').click();
        window.dispatchEvent(new CustomEvent('timetrace:history-mutated',{detail:{}}));
        await Promise.resolve(); await Promise.resolve();
        check(find('Download preview').disabled, 'late read after mutation never enables output');
        api.post = async () => { throw Error('synthetic read failure'); };
        find('Preview ALL filtered matches').click();
        await wait(() => document.querySelector('dialog [role=status]').textContent.includes('synthetic read failure'));
        check(find('Download preview').disabled, 'failed read has no half-ready output');
    } finally { api.post = original; }
    find('Close').click();
    // Native dialog close/focus completion is checked in the next Orca command;
    // this headless transport can defer its rendering task until eval returns.
    check(dirtyEditor.value === draft && dirtyEditor.isConnected, 'dirty saved-work editor survives export and failed reads');
    return {unicodeFilter:true,groupSelection:true,selectedPreview:true,clipboardFailureRetainsBytes:true,
        narrowDialogWidth:width,viewport:window.innerWidth,lateMutationReadRejected:true,readFailure:true,closeFocusRequiresNextTurn:true,dirtyEditorRetained:true};
})()

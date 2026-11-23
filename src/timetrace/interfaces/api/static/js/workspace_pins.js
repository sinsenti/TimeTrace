/** Device-local ordered task identities; never writes tasks or recorded work. */
function createWorkspacePins(storage) {
    const key = 'timetrace.workspace.pins.v1';
    const saved = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(saved) || saved.some(id => typeof id !== 'string')) throw Error('Saved pins are invalid; persistence unavailable.');
    let ids = [...new Set(saved)];
    const save = next => { storage.setItem(key, JSON.stringify(next)); ids = next; };
    return {ids:()=>[...ids], pin:id=> { if (!ids.includes(id)) save([...ids,id]); }, unpin:id=>save(ids.filter(value=>value !== id))};
}
if (typeof module !== 'undefined') module.exports = {createWorkspacePins};

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function browser() {
    const events = {};
    const document = {addEventListener(name, fn) {(events[name] ||= []).push(fn);}, activeElement:null};
    function node(tag) {
        const listeners = {}, children = [];
        return {tagName:tag.toUpperCase(), children, listeners, isConnected:true, dataset:{},
            append(...items) {children.push(...items);}, setAttribute(k,v) {this[k]=v;},
            addEventListener(name, fn) {(listeners[name] ||= []).push(fn);},
            dispatch(name) {let prevented=false;for(const fn of listeners[name] || []) fn({preventDefault(){prevented=true;}});return !prevented;},
            requestClose() {if(this.dispatch('cancel'))this.close();},
            contains(target) {return target === this || children.some(child => child.contains?.(target));},
            focus() {document.activeElement=this;}, showModal() {this.open=true;},
            // Embedded browsers may defer close until a future frame. Do not dispatch it here.
            close() {this.open=false;}, remove() {this.isConnected=false;}};
    }
    document.createElement=node; document.body=node('body');
    document.querySelector=()=>document.body.children.find(child=>child.tagName==='DIALOG'&&child.open&&child.isConnected&&child.className?.split(' ').includes('app-dialog'));
    document.activeElement=node('button'); const launch=document.activeElement;
    const window={addEventListener(name,fn){(events[`window:${name}`] ||= []).push(fn);}};
    vm.runInNewContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/app_dialogs.js','utf8'), {window, document});
    return {document, events, launch, api:window.appDialogs, dialog:()=>document.body.children.at(-1)};
}
const find = (root, text) => root.children.flatMap(child=>[child,...child.children.flatMap(grand=>[grand,...grand.children])]).find(child=>child.textContent===text);
test('app confirmation names its target, defaults to Cancel and settles without a close frame', async () => {
    const b=browser(); const result=b.api.confirm({title:'Delete entry', message:'<script>inert</script>', danger:true, confirmLabel:'Delete'});
    const dialog=b.dialog();
    assert.equal(dialog['aria-labelledby'], find(dialog,'Delete entry').id);
    assert.equal(find(dialog,'<script>inert</script>').textContent,'<script>inert</script>');
    assert.equal(b.document.activeElement.textContent,'Cancel');
    find(dialog,'Cancel').dispatch('click');
    assert.equal(await result,false); assert.equal(b.document.activeElement,b.launch);
});
test('Escape and newer requests cancel without mutating; obsolete close cannot settle the new dialog', async () => {
    const b=browser(); const first=b.api.confirm({message:'First'}); const old=b.dialog();
    const second=b.api.confirm({message:'Second'});
    assert.equal(await first,false);
    old.dispatch('close');
    b.dialog().dispatch('cancel');
    assert.equal(await second,false);
});
test('approval after newer editor input is refused; prompt input is its own draft', async () => {
    const b=browser(); const approval=b.api.confirm({message:'Leave?'});
    for(const fn of b.events.input) fn({target:b.launch});
    find(b.dialog(),'Confirm').dispatch('click'); assert.equal(await approval,false);
    const answer=b.api.prompt({title:'Rename', message:'Name', value:'Old'});
    const input=b.dialog().children.find(child=>child.tagName==='LABEL').children[0]; input.value='New';
    for(const fn of b.events.input) fn({target:input});
    find(b.dialog(),'Save').dispatch('click'); assert.equal(await answer,'New');
});
test('Settings inline link prevents navigation synchronously; Cancel, newer typing and repeated intent are safe', async () => {
    const b=browser();
    const context={window:{appDialogs:b.api,location:{href:'http://localhost/agenda-view'}},document:b.document, URL,
        localStorage:{getItem:()=>null},console};
    const field=b.document.createElement('input');field.id='entry-text';field.type='text';field.value='Saved';
    const root={id:'entry-editor',dataset:{},classList:{contains:()=>false},querySelectorAll:()=>[field]};
    b.document.getElementById=id=>id===root.id ? root : null;
    vm.createContext(context); vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/settings.js','utf8'),context);
    context.rememberSettingsDraft(root.id);field.value='Unsaved';
    const follow=() => context.followSettingsLink({currentTarget:{href:'/settings'},preventDefault(){}});
    assert.equal(follow(),false); find(b.dialog(),'Cancel').dispatch('click'); await Promise.resolve();
    assert.equal(context.window.location.href,'http://localhost/agenda-view');
    assert.equal(follow(),false);
    field.value='Newer unsaved text';
    for(const fn of b.events.input) fn({target:field});
    find(b.dialog(),'Confirm').dispatch('click'); await Promise.resolve();
    assert.equal(context.window.location.href,'http://localhost/agenda-view');
    follow(); const old=b.dialog(); follow(); old.dispatch('close');
    find(b.dialog(),'Confirm').dispatch('click'); await Promise.resolve();
    assert.equal(context.window.location.href,'/settings');
});

test('window-capture Escape settles only the top app decision before underlying editor shortcuts',async()=>{
    const b=browser();const result=b.api.confirm({message:'Leave the Session draft?'});
    let stopped=false,prevented=false;
    b.events['window:keydown'][0]({key:'Escape',preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
    assert.equal(await result,false);assert.equal(stopped,true);assert.equal(prevented,true);
});

test('Escape delegates to a static app dialog cancel owner without waiting for a close frame',()=>{
    const b=browser(),dialog=b.document.createElement('dialog');dialog.className='app-dialog';
    b.document.body.append(dialog);dialog.showModal();let ownerClosed=false;
    dialog.addEventListener('cancel',event=>{event.preventDefault();ownerClosed=true;dialog.close();});
    b.events['window:keydown'][0]({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
    assert.equal(ownerClosed,true);assert.equal(dialog.open,false);
});

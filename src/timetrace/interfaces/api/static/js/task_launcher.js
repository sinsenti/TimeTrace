/** Search selects an explicit task. Only the existing timer writer can start it. */
function canStartTaskFromTimerState(state){
    const ownAck=state.receipt?.outcome==='acknowledged'&&state.lastResult?.operation_id===state.receipt.payload?.operation_id;
    return !state.pending&&(state.fresh&&!state.receipt||Boolean(ownAck));
}
function taskLauncherPriority(task){const priority=String(task.priority||'').toLowerCase();return ['high','medium','low'].includes(priority)?priority:'none';}
function taskLauncherGroupKey(task,filterOnly=false){return `${filterOnly?'default':task.match_kind}:${taskLauncherPriority(task)}`;}
function createTaskLauncher({api,startTask,onState=()=>{},available=()=>true,validateTask=async()=>true,timezone=null,pauseWhenIdle=()=>undefined,timerSelection=()=>undefined,view='suggested',priority='all',filterOnly=false}) {
    const validView=value=>['suggested','priority'].includes(value),validPriority=value=>['all','high','medium','low','none'].includes(value);
    if(!validView(view)||!validPriority(priority))throw Error('Unsupported launcher view or priority.');
    let query='',tagFilter='',includeCompleted=false,rows=[],activeIndex=-1,open=false,loading=false,pending=false;
    let version=0,request=0,selectionGeneration=0,explicit=false,message='',actionMessage='',binding=null;
    const collapsedGroups=new Set();
    const visible=task=>view!=='priority'||!collapsedGroups.has(taskLauncherGroupKey(task,filterOnly));
    const snapshot=()=>({query,tagFilter,includeCompleted,view,priority,filterOnly,rows,activeIndex,open,loading,pending,message,actionMessage,collapsedGroups:[...collapsedGroups]});
    const publish=()=>onState(snapshot());
    async function read(){
        const own=++request,atVersion=version;loading=true;rows=[];activeIndex=-1;explicit=false;message='';publish();
        try{
            const params=new URLSearchParams({q:query,include_completed:String(includeCompleted),view,priority,limit:'20'});
            if(timezone)params.set('timezone',timezone);if(tagFilter)params.set('tag_contains',tagFilter);
            const result=await api.get(`/api/tasks/launcher?${params}`);
            if(own!==request||atVersion!==version)return;
            if(!Array.isArray(result?.suggestions)||result.suggestions.some(r=>typeof r.id!=='string'||typeof r.title!=='string'))throw Error('Unknown suggestions');
            rows=filterOnly?result.suggestions.filter(row=>row.match_kind!=='fuzzy'):result.suggestions;
            activeIndex=filterOnly?-1:rows.findIndex(r=>visible(r)&&r.match_kind!=='fuzzy');
            message=rows.length?'':filterOnly?'No matching activities. Try another filter.':'No matching tasks. Choose another search or create a task explicitly.';
        }catch(error){if(own!==request||atVersion!==version)return;rows=[];activeIndex=-1;message=filterOnly?'Activity filter unavailable. Try again.':'Task suggestions unavailable. Try again; no timer started.';}
        finally{if(own===request&&atVersion===version){loading=false;publish();}}
    }
    function acknowledged(owner,result){
        if(owner!==binding||owner.acknowledged||!owner.id||result?.operation_id!==owner.id||!result.timer)return false;
        owner.acknowledged=true;pending=false;
        actionMessage=`${owner.task.title}: ${result.timer.state==='running'?'recording':result.timer.state}.`;
        if(!filterOnly&&version===owner.version&&request===owner.request&&selectionGeneration===owner.selectionGeneration&&query===owner.query){query='';message='';version++;request++;loading=false;rows=[];activeIndex=-1;open=false;}
        publish();return true;
    }
    async function start({explicitButton=false}={}){
        const task=rows[activeIndex];
        if(pending||loading||(filterOnly&&!explicitButton)||(!open&&!explicitButton)||!task||!visible(task)||(task.match_kind==='fuzzy'&&!explicit))return false;
        if(!available()){actionMessage='Finish timer recovery or refresh timer status before starting.';publish();return false;}
        const idle=pauseWhenIdle(),payload={task_id:task.id,...(typeof idle==='boolean'?{pause_when_idle:idle}:{})};
        const owner={task,query,version,request,selectionGeneration,timerSelection:timerSelection(),id:null,acknowledged:false};binding=owner;pending=true;actionMessage='';publish();
        try{
            if(!await validateTask(task,includeCompleted))throw Error('Task changed or is unavailable. Search again.');
            const result=await startTask(payload,{
                selectionGeneration:owner.timerSelection,
                onSubmitted:id=>{owner.id=id;},
                onAcknowledged:result=>acknowledged(owner,result),
            });
            if(!owner.acknowledged){actionMessage=`${task.title}: ${result?'Start acknowledged; check the timer bar.':'Start not confirmed. Check the saved operation; do not repeat Start.'}`;}
            return owner.acknowledged||Boolean(result);
        }catch(error){actionMessage=`${task.title}: ${error.message||'Could not start this task.'}`;return false;}
        finally{if(binding===owner){pending=false;publish();}}
    }
    return {snapshot,refresh:read,
        focus:()=>{open=true;return read();},
        input:value=>{query=value;version++;open=true;actionMessage='';return read();},
        tag:value=>{tagFilter=value;version++;open=true;return read();},
        view:value=>{if(!validView(value))throw Error('Unsupported launcher view.');view=value;version++;open=true;return read();},
        priority:value=>{if(!validPriority(value))throw Error('Unsupported launcher priority.');priority=value;version++;open=true;return read();},
        includeCompleted:value=>{includeCompleted=Boolean(value);version++;open=true;return read();},
        close:()=>{open=false;request++;loading=false;publish();},
        toggleGroup:(match,priority)=>{
            if(view!=='priority'||!['default','exact','prefix','contains','fuzzy'].includes(match)||!['high','medium','low','none'].includes(priority))return false;
            const key=`${match}:${priority}`;
            if(collapsedGroups.has(key))collapsedGroups.delete(key);else collapsedGroups.add(key);
            selectionGeneration++;
            if(rows[activeIndex]&&!visible(rows[activeIndex])){activeIndex=-1;explicit=false;}
            publish();return true;
        },
        choose:index=>{if(loading||!rows[index]||!visible(rows[index]))return false;activeIndex=index;selectionGeneration++;explicit=true;open=true;publish();return true;},
        reconcile:result=>binding?acknowledged(binding,result):false,
        start,
        key:event=>{
            if(event.isComposing||event.repeat||event.altKey||event.ctrlKey||event.metaKey)return false;
            if(event.key==='Tab'){open=false;request++;loading=false;publish();return false;}
            if(event.key==='Escape'){open=false;request++;loading=false;publish();return true;}
            if(event.key==='Enter')return filterOnly?true:start();
            if(!filterOnly&&['ArrowDown','ArrowUp'].includes(event.key)&&!open){open=true;void read();return true;}
            if(!filterOnly&&['ArrowDown','ArrowUp'].includes(event.key)&&open&&!loading&&rows.length){
                const indices=rows.map((row,index)=>visible(row)?index:-1).filter(index=>index>=0);
                if(!indices.length)return false;
                const selected=indices.indexOf(activeIndex),direction=event.key==='ArrowDown'?1:-1;
                activeIndex=indices[selected<0?(direction===1?0:indices.length-1):(selected+direction+indices.length)%indices.length];
                selectionGeneration++;explicit=true;publish();return true;
            }
            return false;
        },
    };
}
let taskLauncherSequence=0;
function mountTaskLauncher(root,control,{input=root.querySelector('[data-launcher-input]'),startButton=root.querySelector('[data-launcher-start]'),onSuggestions=null,view='suggested',prioritySelect=null,resultsRoot=null,onDetails=null,filterOnly=false}={}) {
    const doc=root.ownerDocument,uid=`task-launcher-${++taskLauncherSequence}`;
    const popup=doc.createElement('div');popup.className='task-launcher-popup';popup.hidden=true;
    const hint=doc.createElement('p');hint.className='task-launcher-hint';hint.textContent='↑↓ choose · Enter starts · Tab moves focus';hint.hidden=filterOnly;
    const checkLabel=doc.createElement('label');checkLabel.className='launcher-completed';
    const check=doc.createElement('input');check.type='checkbox';checkLabel.append(check,doc.createTextNode(' Include completed'));
    const options=doc.createElement('div');options.id=`${uid}-options`;options.setAttribute('role','listbox');options.setAttribute('aria-label','Task suggestions');
    const status=doc.createElement('p');status.className='task-launcher-status';status.setAttribute('role','status');
    popup.append(hint,options);
    if(resultsRoot){resultsRoot.id ||= `${uid}-results`;root.append(hint,checkLabel,status);}
    else root.append(checkLabel,popup,status);
    root.hidden=false;input.maxLength=200;
    input.setAttribute('role',resultsRoot?'searchbox':'combobox');
    if(!resultsRoot)input.setAttribute('aria-autocomplete','list');
    input.setAttribute('aria-controls',resultsRoot?resultsRoot.id:options.id);input.setAttribute('autocomplete','off');
    let model,signature='',resultsSignature='',resultActions=[],groupControls=[];
    function available(){return canStartTaskFromTimerState(control.snapshot());}
    function activate(id){const index=model.snapshot().rows.findIndex(t=>t.id===id);if(index<0||!model.choose(index))return false;return model.start({explicitButton:true});}
    function taskInfo(task){
        return [task.parent_title,task.completed?'Completed':null,task.scheduled_state==='now'?'Scheduled now':task.scheduled_state==='soon'?`Scheduled ${new Date(task.scheduled_start).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:null,task.priority&&task.priority!=='-'?`${task.priority} priority`:null,task.recorded_hours>0?`${Number(task.recorded_hours.toFixed(1))} h recorded · last 30 days`:null].filter(Boolean).join(' · ');
    }
    function renderResults(s){
        if(!resultsRoot)return;
        const next=JSON.stringify([s.rows,s.query.trim(),s.priority]);
        if(next!==resultsSignature){
            resultsSignature=next;resultsRoot.replaceChildren();resultActions=[];groupControls=[];
            const bound=doc.createElement('p');bound.className='launcher-result-bound';bound.textContent='Up to 20 results. Filter by priority or search for more tasks.';resultsRoot.append(bound);
            const priorities=[['high','High priority'],['medium','Medium priority'],['low','Low priority'],['none','No priority']];
            // Search keeps exact → prefix → literal contains → explicit close matches.
            const matches=s.query.trim()&&!filterOnly?['exact','prefix','contains','fuzzy']:['default'];
            for(const match of matches){
                for(const [priority,label] of priorities){
                    if(s.priority!=='all'&&s.priority!==priority)continue;
                    const tasks=s.rows.map((task,index)=>({task,index})).filter(({task})=>taskLauncherPriority(task)===priority&&(filterOnly||task.match_kind===match));
                    if(s.query.trim()&&!tasks.length)continue;
                    const section=doc.createElement('section');section.className='launcher-priority-group';section.dataset.priority=priority;
                    const heading=doc.createElement('h4'),toggle=doc.createElement('button'),name=doc.createElement('span'),count=doc.createElement('span'),body=doc.createElement('div');
                    const key=`${match}:${priority}`,title=s.query.trim()&&!filterOnly?`${{exact:'Exact title',prefix:'Title starts with',contains:'Title contains',fuzzy:'Close matches · select before starting'}[match]} · ${label}`:label;
                    toggle.type='button';toggle.className='launcher-group-toggle';toggle.id=`${uid}-${match}-${priority}-toggle`;
                    body.className='launcher-group-body';body.id=`${uid}-${match}-${priority}-body`;body.setAttribute('role','group');body.setAttribute('aria-labelledby',toggle.id);
                    toggle.setAttribute('aria-controls',body.id);toggle.setAttribute('aria-label',`${title} (${tasks.length} ${tasks.length===1?'task':'tasks'})`);
                    name.className='launcher-group-label';name.textContent=title;count.className='launcher-group-count';count.textContent=String(tasks.length);count.setAttribute('aria-hidden','true');
                    toggle.append(name,count);toggle.addEventListener('click',()=>model.toggleGroup(match,priority));heading.append(toggle);section.append(heading,body);
                    groupControls.push({toggle,body,key});
                    if(!tasks.length){const empty=doc.createElement('p');empty.className='launcher-group-empty';empty.textContent='No tasks in this result list. Filter or search to look further.';body.append(empty);}
                    for(const {task,index} of tasks){
                        const row=doc.createElement('article');row.className='launcher-priority-row';
                        const text=doc.createElement('div'),title=doc.createElement('strong'),info=doc.createElement('small');title.textContent=task.title;info.textContent=taskInfo(task);text.append(title,info);
                        const actions=doc.createElement('div');actions.className='launcher-row-actions';
                        const start=doc.createElement('button');start.type='button';start.textContent='Start';start.dataset.launcherOwnedStart='true';start.setAttribute('aria-label',`Start timer for ${task.title}`);start.addEventListener('click',()=>activate(task.id));actions.append(start);
                        if(onDetails){const details=doc.createElement('button');details.type='button';details.textContent='Task details';details.setAttribute('aria-label',`Task details for ${task.title}`);details.addEventListener('click',()=>onDetails(task.id));actions.append(details);}
                        row.append(text,actions);body.append(row);resultActions.push({start,row,index});
                    }
                    resultsRoot.append(section);
                }
            }
        }
        for(const {toggle,body,key} of groupControls){const collapsed=s.collapsedGroups.includes(key);toggle.setAttribute('aria-expanded',String(!collapsed));body.hidden=collapsed;}
        for(const {start,row,index} of resultActions){start.disabled=s.pending||s.loading||!available();row.dataset.selected=String(!filterOnly&&index===s.activeIndex);}
    }
    function render(s){
        if(input.value!==s.query)input.value=s.query;
        popup.hidden=!s.open;check.checked=s.includeCompleted;
        if(!resultsRoot)input.setAttribute('aria-expanded',String(s.open));
        input.setAttribute('aria-busy',String(s.loading));
        const row=s.rows[s.activeIndex];
        if(!resultsRoot&&row)input.setAttribute('aria-activedescendant',`${uid}-${s.activeIndex}`);else input.removeAttribute('aria-activedescendant');
        status.textContent=[s.loading?'Finding tasks…':s.message,resultsRoot&&s.rows.length&&s.rows.every(task=>s.collapsedGroups.includes(taskLauncherGroupKey(task,filterOnly)))?'Expand a priority group to choose a task.':'',resultsRoot&&!filterOnly&&s.open&&row?`Selected: ${row.title}. Enter starts this task.`:'',s.actionMessage].filter(Boolean).join(' ');
        if(startButton){startButton.disabled=s.pending||s.loading||!row||!available();startButton.setAttribute('aria-label',row?`Start timer for ${row.title}`:'Choose a task before starting');}
        const next=JSON.stringify([s.rows,s.activeIndex]);if(!resultsRoot&&next!==signature){signature=next;options.replaceChildren();let fuzzy=false;
            s.rows.forEach((task,index)=>{
                if(task.match_kind==='fuzzy'&&!fuzzy){const heading=doc.createElement('p');heading.className='launcher-close-heading';heading.textContent='Close matches · select one before starting';options.append(heading);fuzzy=true;}
                const option=doc.createElement('div');option.id=`${uid}-${index}`;option.setAttribute('role','option');option.setAttribute('aria-selected',String(index===s.activeIndex));option.className='task-launcher-option';
                const title=doc.createElement('strong');title.textContent=task.title;const info=doc.createElement('small');
                info.textContent=taskInfo(task);
                option.append(title,info);option.addEventListener('pointerdown',e=>e.preventDefault());option.addEventListener('click',()=>{model.choose(index);input.focus({preventScroll:true});});options.append(option);
            });
        }
        if(prioritySelect)prioritySelect.value=s.priority;
        renderResults(s);onSuggestions?.(s);
    }
    model=createTaskLauncher({api,view,filterOnly,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,available,onState:render,pauseWhenIdle:()=>document.querySelector('[data-timer-idle]')?.checked,timerSelection:()=>control.snapshot().selectionGeneration,
        validateTask:async(task,includeCompleted)=>{
            const current=await api.get(`/api/tasks/${encodeURIComponent(task.id)}`);
            if(current.id!==task.id||current.title!==task.title)return false;
            if(!includeCompleted){const statuses=await api.get('/api/tasks/statuses');const status=statuses.find(s=>s.name===current.status);if(status?status.is_completed:['done','completed'].includes((current.status||'').toLowerCase()))return false;}
            if(!available())throw Error('Finish the current timer request before starting another.');
            return true;
        },
        startTask:(payload,hooks)=>{
            const previous=control.snapshot().receipt?.payload?.operation_id;
            const saving=control.start(payload,hooks.onAcknowledged,{preservePage:true,selectionGeneration:hooks.selectionGeneration});
            const receipt=control.snapshot().receipt;if(receipt?.url==='/timers'&&receipt.payload?.operation_id!==previous)hooks.onSubmitted(receipt.payload.operation_id);
            return saving;
        },
    });
    input.addEventListener('focus',()=>{if(!model.snapshot().open)void model.focus();});input.addEventListener('pointerdown',()=>{if(!model.snapshot().open)void model.focus();});input.addEventListener('input',()=>void model.input(input.value));
    input.addEventListener('keydown',event=>{if(model.key(event)!==false)event.preventDefault();});
    check.addEventListener('change',()=>void model.includeCompleted(check.checked));
    prioritySelect?.addEventListener('change',()=>model.priority(prioritySelect.value));
    const outside=e=>{if(!root.contains(e.target)&&e.target!==startButton)model.close();};doc.addEventListener('pointerdown',outside);
    doc.addEventListener('focusin',event=>{if(model.snapshot().open&&!root.contains(event.target)&&event.target!==startButton)model.close();});
    const recovered=e=>model.reconcile(e.detail);window.addEventListener('timetrace:timer-mutated',recovered);
    const tasksChanged=()=>{if(model.snapshot().open||onSuggestions||resultsRoot)void model.refresh();};window.addEventListener('timetrace:tasks-mutated',tasksChanged);
    render(model.snapshot());
    return {model,sync:()=>render(model.snapshot()),start:()=>model.start({explicitButton:true}),activate};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createTaskLauncher,mountTaskLauncher,canStartTaskFromTimerState};

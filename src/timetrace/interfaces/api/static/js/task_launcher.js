/** Search selects an explicit task. Only the existing timer writer can start it. */
function createTaskLauncher({api,startTask,onState=()=>{},available=()=>true,validateTask=async()=>true,timezone=null,pauseWhenIdle=()=>undefined}) {
    let query='',tagFilter='',includeCompleted=false,rows=[],activeIndex=-1,open=false,loading=false,pending=false;
    let version=0,request=0,explicit=false,message='',actionMessage='',binding=null;
    const snapshot=()=>({query,tagFilter,includeCompleted,rows,activeIndex,open,loading,pending,message,actionMessage});
    const publish=()=>onState(snapshot());
    async function read(){
        const own=++request,atVersion=version;loading=true;rows=[];activeIndex=-1;explicit=false;message='';publish();
        try{
            const params=new URLSearchParams({q:query,include_completed:String(includeCompleted),limit:'20'});
            if(timezone)params.set('timezone',timezone);if(tagFilter)params.set('tag_contains',tagFilter);
            const result=await api.get(`/api/tasks/launcher?${params}`);
            if(own!==request||atVersion!==version)return;
            if(!Array.isArray(result?.suggestions)||result.suggestions.some(r=>typeof r.id!=='string'||typeof r.title!=='string'))throw Error('Unknown suggestions');
            rows=result.suggestions;activeIndex=rows.findIndex(r=>r.match_kind!=='fuzzy');
            message=rows.length?'':'No matching tasks. Choose another search or create a task explicitly.';
        }catch(error){if(own!==request||atVersion!==version)return;rows=[];activeIndex=-1;message='Task suggestions unavailable. Try again; no timer started.';}
        finally{if(own===request&&atVersion===version){loading=false;publish();}}
    }
    function acknowledged(owner,result){
        if(owner!==binding||owner.acknowledged||!owner.id||result?.operation_id!==owner.id||!result.timer)return false;
        owner.acknowledged=true;pending=false;
        actionMessage=`${owner.task.title}: ${result.timer.state==='running'?'recording':result.timer.state}.`;
        if(version===owner.version&&query===owner.query){query='';message='';version++;request++;loading=false;rows=[];activeIndex=-1;open=false;}
        publish();return true;
    }
    async function start({explicitButton=false}={}){
        const task=rows[activeIndex];
        if(pending||loading||(!open&&!explicitButton)||!task||(task.match_kind==='fuzzy'&&!explicit))return false;
        if(!available()){actionMessage='Finish timer recovery or refresh timer status before starting.';publish();return false;}
        const idle=pauseWhenIdle(),payload={task_id:task.id,...(typeof idle==='boolean'?{pause_when_idle:idle}:{})};
        const owner={task,query,version,id:null,acknowledged:false};binding=owner;pending=true;actionMessage='';publish();
        try{
            if(!await validateTask(task,includeCompleted))throw Error('Task changed or is unavailable. Search again.');
            const result=await startTask(payload,{
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
        includeCompleted:value=>{includeCompleted=Boolean(value);version++;open=true;return read();},
        close:()=>{open=false;request++;loading=false;publish();},
        choose:index=>{if(loading||!rows[index])return false;activeIndex=index;explicit=true;open=true;publish();return true;},
        reconcile:result=>binding?acknowledged(binding,result):false,
        start,
        key:event=>{
            if(event.isComposing||event.repeat||event.altKey||event.ctrlKey||event.metaKey)return false;
            if(event.key==='Tab'){open=false;request++;loading=false;publish();return false;}
            if(event.key==='Escape'){open=false;request++;loading=false;publish();return true;}
            if(event.key==='Enter')return start();
            if(['ArrowDown','ArrowUp'].includes(event.key)&&!open){open=true;void read();return true;}
            if(['ArrowDown','ArrowUp'].includes(event.key)&&open&&!loading&&rows.length){
                activeIndex=activeIndex<0?(event.key==='ArrowDown'?0:rows.length-1):(activeIndex+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
                explicit=true;publish();return true;
            }
            return false;
        },
    };
}
let taskLauncherSequence=0;
function mountTaskLauncher(root,control,{input=root.querySelector('[data-launcher-input]'),startButton=root.querySelector('[data-launcher-start]'),onSuggestions=null}={}) {
    const doc=root.ownerDocument,uid=`task-launcher-${++taskLauncherSequence}`;
    const popup=doc.createElement('div');popup.className='task-launcher-popup';popup.hidden=true;
    const hint=doc.createElement('p');hint.className='task-launcher-hint';hint.textContent='↑↓ choose · Enter starts · Tab moves focus';
    const checkLabel=doc.createElement('label');checkLabel.className='launcher-completed';
    const check=doc.createElement('input');check.type='checkbox';checkLabel.append(check,doc.createTextNode(' Include completed'));
    const options=doc.createElement('div');options.id=`${uid}-options`;options.setAttribute('role','listbox');options.setAttribute('aria-label','Task suggestions');
    const status=doc.createElement('p');status.className='task-launcher-status';status.setAttribute('role','status');
    popup.append(hint,checkLabel,options);root.append(popup,status);root.hidden=false;
    input.maxLength=200;
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',options.id);input.setAttribute('autocomplete','off');
    let model,signature='';
    function available(){const s=control.snapshot();const ownAck=s.receipt?.outcome==='acknowledged'&&s.lastResult?.operation_id===s.receipt.payload?.operation_id;return !s.pending&&(s.fresh&&!s.receipt||ownAck);}
    function render(s){
        if(input.value!==s.query)input.value=s.query;
        popup.hidden=!s.open;check.checked=s.includeCompleted;input.setAttribute('aria-expanded',String(s.open));input.setAttribute('aria-busy',String(s.loading));
        const row=s.rows[s.activeIndex];if(row)input.setAttribute('aria-activedescendant',`${uid}-${s.activeIndex}`);else input.removeAttribute('aria-activedescendant');
        status.textContent=[s.loading?'Finding tasks…':s.message,s.actionMessage].filter(Boolean).join(' ');
        if(startButton){startButton.disabled=s.pending||s.loading||!row||!available();startButton.setAttribute('aria-label',row?`Start timer for ${row.title}`:'Choose a task before starting');}
        const next=JSON.stringify([s.rows,s.activeIndex]);if(next!==signature){signature=next;options.replaceChildren();let fuzzy=false;
            s.rows.forEach((task,index)=>{
                if(task.match_kind==='fuzzy'&&!fuzzy){const heading=doc.createElement('p');heading.className='launcher-close-heading';heading.textContent='Close matches · select one before starting';options.append(heading);fuzzy=true;}
                const option=doc.createElement('div');option.id=`${uid}-${index}`;option.setAttribute('role','option');option.setAttribute('aria-selected',String(index===s.activeIndex));option.className='task-launcher-option';
                const title=doc.createElement('strong');title.textContent=task.title;const info=doc.createElement('small');
                info.textContent=[task.parent_title,task.completed?'Completed':null,task.scheduled_state==='now'?'Scheduled now':task.scheduled_state==='soon'?`Scheduled ${new Date(task.scheduled_start).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:null,task.priority&&task.priority!=='-'?`${task.priority} priority`:null,task.recorded_hours>0?`${Number(task.recorded_hours.toFixed(1))} h recorded · last 30 days`:null].filter(Boolean).join(' · ');
                option.append(title,info);option.addEventListener('pointerdown',e=>e.preventDefault());option.addEventListener('click',()=>{model.choose(index);input.focus({preventScroll:true});});options.append(option);
            });
        }
        onSuggestions?.(s);
    }
    model=createTaskLauncher({api,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,available,onState:render,pauseWhenIdle:()=>document.querySelector('[data-timer-idle]')?.checked,
        validateTask:async(task,includeCompleted)=>{
            const current=await api.get(`/api/tasks/${encodeURIComponent(task.id)}`);
            if(current.id!==task.id||current.title!==task.title)return false;
            if(!includeCompleted){const statuses=await api.get('/api/tasks/statuses');const status=statuses.find(s=>s.name===current.status);if(status?status.is_completed:['done','completed'].includes((current.status||'').toLowerCase()))return false;}
            if(!available())throw Error('Finish the current timer request before starting another.');
            return true;
        },
        startTask:(payload,hooks)=>{
            const previous=control.snapshot().receipt?.payload?.operation_id;
            const saving=control.start(payload,hooks.onAcknowledged,{preservePage:true});
            const receipt=control.snapshot().receipt;if(receipt?.url==='/timers'&&receipt.payload?.operation_id!==previous)hooks.onSubmitted(receipt.payload.operation_id);
            return saving;
        },
    });
    input.addEventListener('focus',()=>{if(!model.snapshot().open)void model.focus();});input.addEventListener('pointerdown',()=>{if(!model.snapshot().open)void model.focus();});input.addEventListener('input',()=>void model.input(input.value));
    input.addEventListener('keydown',event=>{if(model.key(event)!==false)event.preventDefault();});
    check.addEventListener('change',()=>void model.includeCompleted(check.checked));
    const outside=e=>{if(!root.contains(e.target)&&e.target!==startButton)model.close();};doc.addEventListener('pointerdown',outside);
    const recovered=e=>model.reconcile(e.detail);window.addEventListener('timetrace:timer-mutated',recovered);
    const tasksChanged=()=>{if(model.snapshot().open||onSuggestions)void model.refresh();};window.addEventListener('timetrace:tasks-mutated',tasksChanged);
    render(model.snapshot());
    return {model,sync:()=>render(model.snapshot()),start:()=>model.start({explicitButton:true}),activate:id=>{const index=model.snapshot().rows.findIndex(t=>t.id===id);if(index<0)return false;model.choose(index);return model.start({explicitButton:true});}};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createTaskLauncher,mountTaskLauncher};

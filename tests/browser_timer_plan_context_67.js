/* Native/manual check after selecting a timer; this probe makes no application writes. */
function verifyTimerPlanContext67({linked, planId = null, taskTitle = null}) {
    const card = document.getElementById('workspace-current-timer');
    const context = card?.querySelector('.timer-plan-context');
    if (!context) throw Error('Select a timer and wait for its plan context.');
    const text = context.innerText;
    const link = context.querySelector('a');
    if (!linked) {
        if (!text.startsWith('No linked plan') || link) throw Error('Unlinked timer must not offer a plan.');
    } else {
        if (!text.startsWith('Linked plan') || !text.includes('Current schedule:') || !link) {
            throw Error('Wait for readable current plan details.');
        }
        const url = new URL(link.href);
        if (url.pathname !== '/agenda-view' || url.searchParams.get('entry') !== planId ||
            !/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '')) throw Error('Incorrect plan navigation.');
        if (text.includes(planId) || (taskTitle && !text.includes(taskTitle))) throw Error('Plan context must be readable.');
    }
    return {text, linked, href:link?.getAttribute('href') || null};
}

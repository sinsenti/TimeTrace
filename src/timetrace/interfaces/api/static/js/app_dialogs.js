/** App-owned, asynchronous decisions. A superseding request cancels the previous one. */
(() => {
    let active = null, sequence = 0;
    // Bootstrap precedes page shortcuts, including window-capture Escape handlers. Keep their
    // underlying editors inert; native dialog controls still receive their browser default actions.
    window.addEventListener('keydown', event => {
        if (!active && !document.querySelector?.('dialog.app-dialog[open]')) return;
        event.stopImmediatePropagation();
        if (active && ['Escape', 'Esc'].includes(event.key)) { event.preventDefault(); active.cancel(); }
    }, true);
    // Consent cannot discard editor input made after the question was opened, including ABA edits.
    for (const name of ['input', 'change']) document.addEventListener(name, event => {
        if (active && !active.dialog.contains(event.target)) active.changed = true;
    }, true);
    function open(kind, options = {}) {
        const previousFocus = active?.returnFocus || document.activeElement;
        active?.cancel();
        return new Promise(resolve => {
            const element = (tag, text) => {
                const node = document.createElement(tag);
                if (text !== undefined) node.textContent = text;
                return node;
            };
            const dialog = element('dialog'); dialog.className = 'app-dialog'; dialog.setAttribute('role', 'dialog');
            const heading = element('h2', options.title || (kind === 'alert' ? 'Notice' : kind === 'prompt' ? 'Enter a value' : 'Confirm action'));
            heading.id = `app-dialog-title-${++sequence}`;
            const message = element('p', options.message || ''); message.id = `app-dialog-message-${sequence}`;
            dialog.setAttribute('aria-labelledby', heading.id); dialog.setAttribute('aria-describedby', message.id);
            const footer = element('footer'); footer.className = 'app-dialog-actions';
            const cancel = element('button', options.cancelLabel || (kind === 'alert' ? 'Close' : 'Cancel'));
            cancel.type = 'button'; cancel.autofocus = true;
            const confirm = element('button', options.confirmLabel || (kind === 'prompt' ? 'Save' : 'Confirm'));
            confirm.type = 'button'; confirm.className = options.danger ? 'app-dialog-danger' : 'app-dialog-primary';
            const input = element('input'); input.type = 'text'; input.value = options.value || '';
            dialog.append(heading, message);
            if (kind === 'prompt') { const label = element('label', options.label || 'Name'); label.append(input); dialog.append(label); }
            footer.append(cancel); if (kind !== 'alert') footer.append(confirm);
            dialog.append(footer);
            const owner = {dialog, returnFocus:previousFocus, changed:false, cancel:() => finish(kind === 'prompt' ? null : false)};
            let settled = false;
            function finish(value) {
                if (settled) return;
                settled = true;
                const ownedFocus = dialog.contains(document.activeElement);
                if (active === owner) active = null;
                if (dialog.open) dialog.close();
                dialog.remove();
                if (ownedFocus && previousFocus?.isConnected) previousFocus.focus();
                resolve(value);
            }
            active = owner;
            cancel.addEventListener('click', owner.cancel);
            confirm.addEventListener('click', () => finish(owner.changed ? (kind === 'prompt' ? null : false) : kind === 'prompt' ? input.value : true));
            // Do not let page shortcuts act on an editor underneath the modal. Native Tab/Enter still work.
            dialog.addEventListener('keydown', event => event.stopPropagation());
            dialog.addEventListener('cancel', event => { event.preventDefault(); owner.cancel(); });
            dialog.addEventListener('close', owner.cancel);
            document.body.append(dialog); dialog.showModal(); cancel.focus();
        });
    }
    window.appDialogs = {
        confirm: options => open('confirm', options),
        alert: options => open('alert', options),
        prompt: options => open('prompt', options),
    };
})();

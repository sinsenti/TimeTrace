/**
 * TimeTrace Centralized API Client
 * Wraps fetch calls with standard error handling, JSON parsing, and unified HTTP methods.
 */

class ApiClient {
    async request(url, options = {}) {
        const { headers, ...restOptions } = options;
        const config = {
            ...restOptions,
            headers: {
                'Content-Type': 'application/json',
                ...(headers || {})
            }
        };

        try {
            const response = await fetch(url, config);

            // Task/hierarchy ACKs invalidate goal evidence; observers only reread and never credit counters.
            if (response.ok && !['GET','HEAD'].includes((options.method || 'GET').toUpperCase()) &&
                /^\/api\/tasks(?:\/|$)/.test(url) && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
                window.dispatchEvent(new CustomEvent('timetrace:tasks-mutated', {detail:{url}}));
            }
            if (response.ok && !['GET','HEAD'].includes((options.method || 'GET').toUpperCase()) &&
                (url === '/recorded-work' || /^\/recorded-work\/[^/]+\/note(?:\?|$)/.test(url) ||
                 /^\/scheduled-sessions(?:\/|$)/.test(url)) &&
                typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
                window.dispatchEvent(new CustomEvent('timetrace:work-mutated', {detail:{url}}));
            }
            if (response.status === 204) {
                return null;
            }

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    errorData = { detail: response.statusText };
                }
                throw Object.assign(new Error(errorData.detail || `HTTP Error ${response.status}`), {
                    status: response.status, code: errorData.code
                });
            }

            const contentType = response.headers.get('content-type');
            if (contentType && (contentType.includes('text/plain') || contentType.includes('text/markdown'))) {
                return await response.text();
            }

            return await response.json();
        } catch (error) {
            const privateSettings = /^\/api\/ai\/(?:settings$|status$|providers(?:\/|$))/.test(url);
            if (privateSettings) console.error('[API Error] AI settings request failed.');
            else console.error(`[API Error] ${options.method || 'GET'} ${url}:`, error.message);
            throw error;
        }
    }

    get(url, headers = {}) {
        return this.request(url, { method: 'GET', headers });
    }

    post(url, body = null, headers = {}) {
        return this.request(url, {
            method: 'POST',
            headers,
            body: body ? JSON.stringify(body) : null
        });
    }

    recordedWorkAttempt() {
        if (typeof sessionStorage === 'undefined') return this.workAttempt || null;
        // Storage errors fail closed: no recording may be sent without a journal.
        return JSON.parse(sessionStorage.getItem('timetrace_manual_work_attempt') || 'null');
    }

    rememberRecordedWorkAttempt(attempt) {
        if (typeof sessionStorage !== 'undefined') {
            if (attempt) sessionStorage.setItem('timetrace_manual_work_attempt', JSON.stringify(attempt));
            else sessionStorage.removeItem('timetrace_manual_work_attempt');
        }
        this.workAttempt = attempt;
        if (typeof window?.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('timetrace:manual-work-journal'));
        }
    }

    async saveRecordedWork(payload) {
        if (this.recordedWorkAttempt()) throw new Error('Previous manual recording is unconfirmed. Review recorded work recovery before starting a new entry.');
        this.rememberRecordedWorkAttempt({payload});
        this.workPending = true;
        let saved;
        try {
            saved = await this.post('/recorded-work', payload);
            if (!saved?.id || saved.kind !== 'recorded_work') throw new Error('Missing recorded work acknowledgement');
        } catch (error) {
            if (error.status && error.status < 500 && !['operation_payload_mismatch','reconciliation_required'].includes(error.code)) this.rememberRecordedWorkAttempt(null);
            throw error;
        } finally {
            this.workPending = false;
        }
        // ACK wins over fallible cleanup/display: never report a committed recording as failed.
        try { this.rememberRecordedWorkAttempt(null); } catch (_) { /* Retained journal safely blocks a duplicate. */ }
        return saved;
    }

    async recoverRecordedWork() {
        const attempt = this.recordedWorkAttempt();
        if (!attempt?.payload?.operation_id || this.workPending) return null;
        const receipt = await this.get(`/operations/${encodeURIComponent(`recorded-work:${attempt.payload.operation_id}`)}`);
        if (receipt.status !== 'finalized' || !receipt.result?.id || receipt.result.kind !== 'recorded_work') return null;
        if (JSON.stringify(this.recordedWorkAttempt()) !== JSON.stringify(attempt)) return null;
        this.rememberRecordedWorkAttempt(null);
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('timetrace:recording-acknowledged', {detail:{...receipt.result,requested_scheduled_session_id:attempt.payload.scheduled_session_id}}));
        }
        return receipt.result;
    }

    put(url, body = null, headers = {}) {
        return this.request(url, {
            method: 'PUT',
            headers,
            body: body ? JSON.stringify(body) : null
        });
    }

    async saveScheduledSession(row, fields, scope = 'only_this') {
        const saved = row ? await this.put(
            `/scheduled-sessions/${encodeURIComponent(row.id)}?scope=${encodeURIComponent(scope)}`,
            { start_time: fields.start_time, end_time: fields.end_time,
                ...(row.is_virtual ? { expected_projection_revision: row.projection_revision } : { expected_revision: row.revision }) }
        ) : await this.post('/scheduled-sessions', fields);
        if (!saved?.id || saved.kind !== 'scheduled_session' || !Number.isInteger(saved.revision)) {
            throw new Error('Missing schedule acknowledgement');
        }
        return saved;
    }

    delete(url, headers = {}) {
        return this.request(url, { method: 'DELETE', headers });
    }

    /**
     * POST a JSON body and consume a `text/event-stream` response, parsing SSE frames manually
     * (fetch()-based, not EventSource -- EventSource cannot send a POST body). Generic: yields
     * `{event, data}` per frame via `onEvent`, `data` JSON-parsed when possible, else the raw
     * string. Frames are separated by a blank line; each frame may carry `event:` (defaults to
     * "message") and one or more `data:` lines (joined with "\n" per the SSE spec).
     *
     * @param {string} url
     * @param {object} body
     * @param {(evt: {event: string, data: any}) => void} onEvent
     * @param {object} [headers]
     * @param {{signal?: AbortSignal}} [options]
     * @returns {Promise<any>} JSON payload, or undefined when SSE ends; throws on HTTP/transport errors
     */
    async stream(url, body, onEvent, headers = {}, options = {}) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: body ? JSON.stringify(body) : null,
            signal: options.signal
        });

        if (!response.ok || !response.body) {
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                errorData = { detail: response.statusText };
            }
            throw new Error(errorData.detail || `HTTP Error ${response.status}`);
        }

        if ((response.headers.get('content-type') || '').includes('application/json')) {
            return response.json();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        const dispatchFrame = (rawFrame) => {
            if (!rawFrame.trim()) return;
            let eventName = 'message';
            const dataLines = [];
            for (const line of rawFrame.split(/\r?\n/)) {
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).replace(/^ /, ''));
                }
            }
            if (dataLines.length === 0) return;
            const rawData = dataLines.join('\n');
            let parsed;
            try {
                parsed = JSON.parse(rawData);
            } catch (e) {
                parsed = rawData;
            }
            onEvent({ event: eventName, data: parsed });
        };

        let completed = false;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let boundary;
                while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
                    const frame = buffer.slice(0, boundary.index);
                    buffer = buffer.slice(boundary.index + boundary[0].length);
                    dispatchFrame(frame);
                }
            }
            buffer += decoder.decode();
            if (buffer.trim()) dispatchFrame(buffer);
            completed = true;
        } finally {
            try {
                if (!completed) await reader.cancel();
            } finally {
                reader.releaseLock();
            }
        }
    }
}

const api = new ApiClient();

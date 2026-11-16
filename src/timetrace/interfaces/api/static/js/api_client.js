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
                throw new Error(errorData.detail || `HTTP Error ${response.status}`);
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

    put(url, body = null, headers = {}) {
        return this.request(url, {
            method: 'PUT',
            headers,
            body: body ? JSON.stringify(body) : null
        });
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

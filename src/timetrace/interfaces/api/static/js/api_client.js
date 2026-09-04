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
            console.error(`[API Error] ${options.method || 'GET'} ${url}:`, error.message);
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
     * @returns {Promise<void>} resolves when the stream ends (or throws on a network/HTTP error)
     */
    async stream(url, body, onEvent, headers = {}) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: body ? JSON.stringify(body) : null
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        const dispatchFrame = (rawFrame) => {
            if (!rawFrame.trim()) return;
            let eventName = 'message';
            const dataLines = [];
            for (const line of rawFrame.split('\n')) {
                if (line.startsWith('event:')) {
                    eventName = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).trim());
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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                dispatchFrame(frame);
            }
        }
        if (buffer.trim()) {
            dispatchFrame(buffer);
        }
    }
}

const api = new ApiClient();

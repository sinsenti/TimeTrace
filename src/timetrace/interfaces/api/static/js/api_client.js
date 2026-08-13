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
            if (contentType && contentType.includes('text/plain')) {
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
}

const api = new ApiClient();

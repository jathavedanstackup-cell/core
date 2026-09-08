/**
 * API client.
 *
 * Sessions ride on an httpOnly cookie, so there is no token to hold in
 * JavaScript and nothing to leak through storage. Every call therefore sends
 * credentials and the server decides what the caller may see.
 */
export class ApiError extends Error {
    status;
    code;
    details;
    requestId;
    constructor(status, body) {
        super(body.error?.message ?? 'Something went wrong.');
        this.name = 'ApiError';
        this.status = status;
        this.code = body.error?.code ?? 'unknown';
        this.details = body.error?.details;
        this.requestId = body.requestId;
    }
    /** Field-level problems, when the server sent them. */
    fieldErrors() {
        const out = {};
        const details = this.details;
        if (Array.isArray(details)) {
            for (const item of details) {
                if (typeof item === 'object' &&
                    item !== null &&
                    'field' in item &&
                    'message' in item &&
                    typeof item.field === 'string' &&
                    typeof item.message === 'string') {
                    (out[item.field] ??= []).push(item.message);
                }
            }
        }
        else if (typeof details === 'object' && details !== null) {
            for (const [key, value] of Object.entries(details)) {
                if (Array.isArray(value))
                    out[key] = value.map(String);
            }
        }
        return out;
    }
}
async function request(path, init = {}) {
    let response;
    try {
        response = await fetch(path, {
            ...init,
            credentials: 'include',
            headers: {
                ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                ...init.headers,
            },
        });
    }
    catch {
        // A network failure is not the same as a server error, and the message
        // should tell the user which one they are looking at.
        throw new ApiError(0, {
            error: {
                code: 'network_error',
                message: 'Could not reach the server. Check your connection and try again.',
            },
        });
    }
    if (response.status === 204)
        return undefined;
    const text = await response.text();
    let body = null;
    if (text.length > 0) {
        try {
            body = JSON.parse(text);
        }
        catch {
            body = null;
        }
    }
    if (!response.ok) {
        const shaped = body !== null && typeof body === 'object' && 'error' in body
            ? body
            : {
                error: {
                    code: 'unexpected_response',
                    message: `The server returned ${response.status}.`,
                },
            };
        throw new ApiError(response.status, shaped);
    }
    return body;
}
export const api = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
    patch: (path, body) => request(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
    del: (path) => request(path, { method: 'DELETE' }),
};

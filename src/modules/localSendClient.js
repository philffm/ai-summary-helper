// localSendClient.js
// Handles LocalSend handshake and file upload over local network.

function sendViaBackground(targetUrl, body, isJson = true, headers = null, method = 'POST') {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                action: 'sendLocalSendP2P',
                targetUrl,
                method,
                body,
                isJson,
                headers
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.success) {
                    reject(new Error(response?.error || 'LocalSend transfer failed'));
                    return;
                }
                resolve(response);
            }
        );
    });
}

function parseTargetIp(targetIp, defaultPort) {
    let input = (targetIp || '').trim();
    if (!input) throw new Error('LocalSend target IP is empty.');

    const markdownUrlMatch = input.match(/\]\((https?:\/\/[^)]+)\)$/i);
    if (markdownUrlMatch?.[1]) {
        input = markdownUrlMatch[1].trim();
    }

    const explicitProtocol = /^https?:\/\//i.test(input);
    const url = new URL(explicitProtocol ? input : `http://${input}`);
    const host = url.hostname;
    const port = url.port || String(defaultPort);
    const preferredProtocol = explicitProtocol ? url.protocol.replace(':', '').toLowerCase() : null;

    if (!host) throw new Error('Invalid LocalSend IP/URL.');

    return { host, port, preferredProtocol };
}

export async function sendToLocalSend(targetIp, fileName, fileDataString, mimeType = 'text/html') {
    const PORT = 53317;
    const { host, port, preferredProtocol } = parseTargetIp(targetIp, PORT);

    // KOReader plugin typically uses HTTP v1. Keep a minimal fallback path for other LocalSend builds.
    const protocols = preferredProtocol
        ? [preferredProtocol, preferredProtocol === 'http' ? 'https' : 'http']
        : ['http', 'https'];
    const apiVersions = ['v1', 'v2'];

    const baseUrlCandidates = [];
    for (const protocol of protocols) {
        for (const version of apiVersions) {
            baseUrlCandidates.push(`${protocol}://${host}:${port}/api/localsend/${version}`);
        }
    }

    const encoder = new TextEncoder();
    const fileBytes = encoder.encode(fileDataString || '');
    const fileSize = fileBytes.byteLength;
    const fileId = `file_${Date.now()}`;

    const preparePayload = {
        info: {
            alias: 'AI Summary Helper',
            version: '2.0',
            deviceModel: 'Browser Extension',
            deviceType: 'browser'
        },
        files: {
            [fileId]: {
                id: fileId,
                fileName,
                size: fileSize,
                fileType: mimeType,
                sha256: null,
                preview: null
            }
        }
    };

    let selectedBaseUrl = null;
    let prepareData = null;
    let lastStatus = null;
    let lastError = null;

    for (const candidateBaseUrl of baseUrlCandidates) {
        try {
            const prepareResp = await sendViaBackground(
                `${candidateBaseUrl}/prepare-upload`,
                preparePayload,
                true,
                { 'Content-Type': 'application/json' },
                'POST'
            );

            if (prepareResp.status === 404) {
                lastStatus = 404;
                continue;
            }

            if (!prepareResp.ok) {
                lastStatus = prepareResp.status;
                throw new Error(`Handshake Failed: HTTP ${prepareResp.status}`);
            }

            prepareData = prepareResp.data;
            selectedBaseUrl = candidateBaseUrl;
            break;
        } catch (err) {
            lastError = err;
        }
    }

    if (!selectedBaseUrl || !prepareData) {
        if (lastError?.message) throw new Error(lastError.message);
        throw new Error(`Handshake Failed: HTTP ${lastStatus || 'unknown'}`);
    }

    const sessionId = prepareData.sessionId || prepareData.session_id;
    const files = prepareData.files || {};
    const fileToken = files[fileId] || prepareData.tokens?.[fileId];

    if (!sessionId) throw new Error('LocalSend rejected upload session (missing sessionId).');

    let uploadUrl = `${selectedBaseUrl}/upload?sessionId=${encodeURIComponent(sessionId)}&fileId=${encodeURIComponent(fileId)}`;
    if (fileToken) {
        uploadUrl += `&token=${encodeURIComponent(fileToken)}`;
    }

    const uploadResp = await sendViaBackground(
        uploadUrl,
        Array.from(fileBytes),
        false,
        { 'Content-Type': 'application/octet-stream' },
        'POST'
    );

    if (!uploadResp.ok) throw new Error(`Upload Failed: HTTP ${uploadResp.status}`);

    return true;
}

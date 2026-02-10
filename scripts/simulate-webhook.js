const crypto = require('crypto');
const http = require('http');

// Configuration
const WEBHOOK_SECRET = '6e53d693bf77a95493f13ed8d814523657c56fb1a521ed809eddf89a5c9195a9'; // Retrieved from DB
const API_URL = 'http://localhost:3001/api/webhooks/github';

// Payload generator
function createPayload(type, repoName = 'Satyamcoder-2006/Reactflow') {
    const basePayload = {
        ref: 'refs/heads/main',
        before: '0000000000000000000000000000000000000000',
        after: crypto.randomBytes(20).toString('hex'),
        repository: {
            full_name: repoName,
            name: repoName.split('/')[1],
            owner: { name: repoName.split('/')[0] },
        },
        head_commit: {
            id: crypto.randomBytes(20).toString('hex'),
            message: `chore: ${type} change simulation`,
            author: { name: 'Simulated User' },
            added: [],
            removed: [],
            modified: [],
        },
    };

    // Simulate file changes based on type
    switch (type) {
        case 'native':
            basePayload.head_commit.modified = ['android/build.gradle'];
            break;
        case 'js':
            basePayload.head_commit.modified = ['src/App.tsx'];
            break;
        case 'package':
            basePayload.head_commit.modified = ['package.json'];
            break;
        case 'metro':
            basePayload.head_commit.modified = ['metro.config.js'];
            break;
        default:
            basePayload.head_commit.modified = ['README.md'];
    }

    return JSON.stringify(basePayload);
}

// Send webhook
function sendWebhook(type) {
    const payload = createPayload(type);
    const signature = `sha256=${crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(payload)
        .digest('hex')}`;

    console.log(`Sending ${type} webhook simulation...`);

    const req = http.request(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': signature,
            'Content-Length': Buffer.byteLength(payload),
        },
    }, (res) => {
        console.log(`Response Status: ${res.statusCode}`);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('Response Body:', data));
    });

    req.on('error', (e) => console.error(`Problem with request: ${e.message}`));
    req.write(payload);
    req.end();
}

// usage: node simulate-webhook.js <type>
const type = process.argv[2] || 'js';
sendWebhook(type);

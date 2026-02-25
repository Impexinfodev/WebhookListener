require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(bodyParser.json());

// Build deploy map from .env
const deployMap = {};
Object.keys(process.env).forEach(key => {
    if (key === 'PORT') return;
    if (key.endsWith('_SECRET')) return; // Skip secrets

    // Expect format: REPO_BRANCH
    const [repoName, branchName] = key.split('_');
    if (!repoName || !branchName) return;

    const repoKey = repoName.toLowerCase();
    const branchRef = `refs/heads/${branchName.toLowerCase()}`;

    if (!deployMap[repoKey]) deployMap[repoKey] = {};
    deployMap[repoKey][branchRef] = process.env[key];
});

console.log('Deploy map loaded:', deployMap);

// Webhook endpoint
app.post('/deploy', (req, res) => {
    try {
        const repo = req.body.repository.name.toLowerCase();
        const ref = req.body.ref;

        // Get secret for this repo
        const secretVar = `${repo.toUpperCase()}_SECRET`;
        const SECRET = process.env[secretVar];

        if (!SECRET) {
            console.log(`No secret configured for repo: ${repo}`);
            return res.status(401).send('No secret configured for this repo');
        }

        // Verify GitHub signature
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) return res.status(401).send('No signature provided');

        const payload = JSON.stringify(req.body);
        const hmac = crypto.createHmac('sha256', SECRET);
        const digest = 'sha256=' + hmac.update(payload).digest('hex');

        if (signature !== digest) {
            console.log(`Invalid signature for repo: ${repo}`);
            return res.status(403).send('Invalid signature');
        }

        // Check deploy map
        if (deployMap[repo] && deployMap[repo][ref]) {
            const deployScript = deployMap[repo][ref];
            console.log(`Deploying ${repo} (${ref}) using ${deployScript}...`);

            exec(deployScript, (err, stdout, stderr) => {
                if (err) {
                    console.error(`Error deploying ${repo}:`, err);
                    return res.status(500).send('Deploy failed');
                }
                console.log(stdout);
                console.error(stderr);
                res.send('Deploy successful');
            });
        } else {
            console.log(`No deploy script configured for ${repo} (${ref})`);
            res.status(200).send('No action taken');
        }
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Server error');
    }
});

app.listen(PORT, () => {
    console.log(`Webhook listener running on port ${PORT}`);
});

/**
 * SuperHero Network S3 Client Integration
 * Provides secure client data storage to AWS S3 using Cognito Identity Pool
 */

const SUPERHERO_CONFIG = {
    region: 'us-east-2',
    cognitoIdentityPoolId: 'us-east-2:662dfd2a-8d86-4ee3-875b-cd55d0acff8d',
    bucketMapping: {
        'mcpsuperhero.com': 'superhero-clients-mcpsuperhero',
        'shopifysuperhero.com': 'superhero-clients-shopifysuperhero',
        'urlsuperhero.com': 'superhero-clients-urlsuperhero',
        'theaisuperheroes.com': 'superhero-clients-theaisuperheroes',
        'replitsuperhero.com': 'superhero-clients-replitsuperhero',
        'resumesuperhero.com': 'superhero-clients-resumesuperhero',
        'seoaisuperhero.com': 'superhero-clients-seoaisuperhero',
        'startbizsuperhero.com': 'superhero-clients-startbizsuperhero',
        'claudsuperhero.com': 'superhero-clients-claudsuperhero',
        'agenticsuperhero.com': 'superhero-clients-agenticsuperhero'
    }
};

const AWS_SDK_PROMISE = (async () => {
    if (window.AWS && window.AWS.CognitoIdentityCredentialProvider) return window.AWS;
    const credentialScript = document.createElement('script');
    credentialScript.src = 'https://sdk.amazonaws.com/js/aws-sdk-2.1600.0.min.js';
    credentialScript.async = true;
    return new Promise((resolve, reject) => {
        credentialScript.onload = () => resolve(window.AWS);
        credentialScript.onerror = reject;
        document.head.appendChild(credentialScript);
    });
})();

let cognitoCredentials = null;

async function initializeCognitoCredentials() {
    if (cognitoCredentials) return cognitoCredentials;
    const AWS = await AWS_SDK_PROMISE;
    AWS.config.region = SUPERHERO_CONFIG.region; AWS.config.credentials = new AWS.CognitoIdentityCredentials({
        IdentityPoolId: SUPERHERO_CONFIG.cognitoIdentityPoolId,
        Region: SUPERHERO_CONFIG.region
    });
    await new Promise((resolve, reject) => {
        AWS.config.credentials.get((err) => err ? reject(err) : (cognitoCredentials = AWS.config.credentials, resolve()));
    });
    return cognitoCredentials;
}

function getCurrentBucket() {
    const domain = window.location.hostname.replace(/^www\./, '');
    const bucket = SUPERHERO_CONFIG.bucketMapping[domain];
    if (!bucket) throw new Error('Unknown domain: ' + domain);
    return bucket;
}

function generateFilename(prefix) {
    prefix = prefix || 'client-data';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).substring(2, 8);
    return prefix + '-' + ts + '-' + rand + '.json';
}

async function saveClientData(data, filename) {
    if (!data || typeof data !== 'object') throw new Error('Data must be a valid object');
    const AWS = await AWS_SDK_PROMISE;
    const credentials = await initializeCognitoCredentials();
    const bucket = getCurrentBucket();
    const key = filename || generateFilename();
    const s3 = new AWS.S3({ region: SUPERHERO_CONFIG.region, credentials: credentials });
    const payload = Object.assign({}, data, {
        _savedAt: new Date().toISOString(),
        _domain: window.location.hostname,
        _url: window.location.href,
        _userAgent: navigator.userAgent
    });
    const result = await new Promise((resolve, reject) => {
        s3.putObject({
            Bucket: bucket, Key: key,
            Body: JSON.stringify(payload),
            ContentType: 'application/json',
            Metadata: { 'saved-by': 'superhero-network', 'domain': window.location.hostname }
        }, (err, data) => err ? reject(err) : resolve(data));
    });
    console.log('Saved client data to S3: ' + bucket + '/' + key);
    return { success: true, bucket: bucket, key: key, etag: result.ETag, timestamp: new Date().toISOString() };
}

async function getClientData(key) {
    const AWS = await AWS_SDK_PROMISE;
    await initializeCognitoCredentials();
    const bucket = getCurrentBucket();
    const s3 = new AWS.S3({ region: SUPERHERO_CONFIG.region });
    const result = await new Promise((resolve, reject) => {
        s3.getObject({ Bucket: bucket, Key: key }, (err, data) => err ? reject(err) : resolve(data));
    });
    return JSON.parse(result.Body.toString());
}

async function listClientData(prefix) {
    const AWS = await AWS_SDK_PROMISE;
    await initializeCognitoCredentials();
    const bucket = getCurrentBucket();
    const s3 = new AWS.S3({ region: SUPERHERO_CONFIG.region });
    const result = await new Promise((resolve, reject) => {
        s3.listObjectsV2({ Bucket: bucket, Prefix: prefix || '', MaxKeys: 1000 }, (err, data) => err ? reject(err) : resolve(data));
    });
    return (result.Contents || []).map(obj => ({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified }));
}

async function deleteClientData(key) {
    const AWS = await AWS_SDK_PROMISE;
    await initializeCognitoCredentials();
    const bucket = getCurrentBucket();
    const s3 = new AWS.S3({ region: SUPERHERO_CONFIG.region });
    await new Promise((resolve, reject) => {
        s3.deleteObject({ Bucket: bucket, Key: key }, (err, data) => err ? reject(err) : resolve(data));
    });
    return { success: true, bucket: bucket, key: key };
}

function autoSaveFormData(formSelector, dataMapper) {
    const form = document.querySelector(formSelector);
    if (!form) { console.warn('Form not found: ' + formSelector); return; }
    form.addEventListener('submit', async (e) => {
        const formData = new FormData(form);
        let dataToSave = {};
        for (let [key, value] of formData.entries()) dataToSave[key] = value;
        if (dataMapper && typeof dataMapper === 'function') dataToSave = dataMapper(formData, dataToSave);
        try {
            const result = await saveClientData(dataToSave);
            console.log('Form data saved to S3:', result);
            document.dispatchEvent(new CustomEvent('superheroDataSaved', { detail: result }));
        } catch (error) {
            console.error('Failed to save form data:', error);
            document.dispatchEvent(new CustomEvent('superheroDataSaveError', { detail: error }));
        }
    });
}

window.SuperHeroNetwork = {
    saveClientData, getClientData, listClientData, deleteClientData,
    autoSaveFormData, getCurrentBucket, config: SUPERHERO_CONFIG
};

console.log('SuperHero Network S3 Client Integration loaded');
console.log('Bucket:', getCurrentBucket());

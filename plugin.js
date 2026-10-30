// ePoc plugin xAPI
// Sends ePoc events to Umami (audience analytics)
// or to an xAPI LRS (e.g. LRS.io), only if the learner has given consent.

// ---------------------------------------------------------------
// Configuration: to be filled in by the ePoc author
// ---------------------------------------------------------------
const CONFIG = {
    // 'umami' or 'lrs'
    mode: 'umami',

    umami: {
        // Umami Cloud: https://cloud.umami.is
        // Self-hosted Umami: your server address, e.g. https://stats.example.com
        host: 'https://cloud.umami.is',
        websiteId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
    },

    lrs: {
        // xAPI endpoint of your LRS, e.g. https://my-lrs.lrs.io/xapi/
        endpoint: '',
        // Access key with the "Write" permission only
        key: '',
        secret: ''
    }
};

// Delay between two sends (in milliseconds)
const SEND_INTERVAL = 10000;

// ---------------------------------------------------------------

let epoc = {};
let consent = null; // null: no answer yet, true: accepted, false: refused
let queue = [];

ePoc.onLoad = (context) => {
    epoc = context.epoc;
    consent = load('consent');

    return {
        template: 'consent.html',
        shortcode: '[#xapi-consent]'
    };
};

// When the consent block is displayed, send it the current state
ePoc.onEmbed = () => {
    ePoc.emitToEmbeds({ event: 'consent-state', consent });
};

ePoc.receive = (data) => {
    if (data.event === 'consent') {
        setConsent(data.value);
    }

    if (data.event === 'statement' && consent === true) {
        queue.push({ ...data.statement, timestamp: new Date().toISOString() });
    }
};

setInterval(flush, SEND_INTERVAL);

// ---------------------------------------------------------------
// Consent
// ---------------------------------------------------------------

function setConsent(value) {
    consent = value;
    save('consent', value);

    if (!value) {
        // The learner refuses or withdraws consent: forget their identifier
        // and drop the events not sent yet.
        remove('learnerId');
        queue = [];
    }

    ePoc.emitToEmbeds({ event: 'consent-state', consent });
}

// Random anonymous identifier, created only after the learner has given consent
function getLearnerId() {
    let id = load('learnerId');
    if (!id) {
        id = crypto.randomUUID();
        save('learnerId', id);
    }
    return id;
}

// ---------------------------------------------------------------
// Sending
// ---------------------------------------------------------------

async function flush() {
    if (consent !== true || queue.length === 0) return;

    const batch = queue;
    queue = [];

    try {
        if (CONFIG.mode === 'lrs') {
            await sendToLrs(batch);
        } else {
            await sendToUmami(batch);
        }
    } catch (error) {
        // No network or server unavailable: retry on the next send
        console.error('[xapi plugin]', error);
        queue = batch.concat(queue);
    }
}

// Umami: one event per request, no authentication
async function sendToUmami(statements) {
    const learnerId = getLearnerId();

    for (const statement of statements) {
        const response = await fetch(CONFIG.umami.host.replace(/\/$/, '') + '/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'event',
                payload: {
                    website: CONFIG.umami.websiteId,
                    hostname: 'epoc',
                    language: navigator.language,
                    title: epoc.title,
                    url: `/${statement.epocId}/${statement.entityType}/${statement.entityId}`,
                    name: `${statement.entityType}-${statement.verb}`,
                    data: statement,
                    id: learnerId
                }
            })
        });

        if (!response.ok) throw new Error('Umami ' + response.status);
    }
}

// LRS: all statements in a single request, with a write-only key
async function sendToLrs(statements) {
    const learnerId = getLearnerId();

    const response = await fetch(CONFIG.lrs.endpoint.replace(/\/?$/, '/') + 'statements', {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + btoa(CONFIG.lrs.key + ':' + CONFIG.lrs.secret),
            'X-Experience-API-Version': '1.0.3',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(statements.map(s => toXapi(s, learnerId)))
    });

    if (!response.ok) throw new Error('LRS ' + response.status + ' ' + await response.text());
}

// ---------------------------------------------------------------
// Conversion of an ePoc statement into an xAPI statement
// ---------------------------------------------------------------

const XAPI = 'https://epoc.inria.fr/xapi';

const VERBS = {
    started: 'http://adlnet.gov/expapi/verbs/initialized',
    viewed: 'http://id.tincanapi.com/verb/viewed',
    read: 'http://adlnet.gov/expapi/verbs/experienced',
    watched: 'http://adlnet.gov/expapi/verbs/experienced',
    listened: 'http://adlnet.gov/expapi/verbs/experienced',
    played: 'https://w3id.org/xapi/video/verbs/played',
    attempted: 'http://adlnet.gov/expapi/verbs/attempted',
    scored: 'http://adlnet.gov/expapi/verbs/scored',
    completed: 'http://adlnet.gov/expapi/verbs/completed',
    passed: 'http://adlnet.gov/expapi/verbs/passed',
    failed: 'http://adlnet.gov/expapi/verbs/failed'
};

function toXapi(s, learnerId) {
    // "passed" with the value false becomes "failed"
    const verb = s.verb === 'passed' && !s.value ? 'failed' : s.verb;
    const epocIri = `${XAPI}/epoc/${encodeURIComponent(s.epocId)}`;

    const statement = {
        id: crypto.randomUUID(),
        timestamp: s.timestamp,
        actor: {
            objectType: 'Agent',
            account: { homePage: 'https://epoc.inria.fr', name: learnerId }
        },
        verb: {
            id: VERBS[verb] || `${XAPI}/verbs/${encodeURIComponent(verb)}`,
            display: { 'en-US': verb }
        },
        object: {
            objectType: 'Activity',
            id: `${epocIri}/${encodeURIComponent(s.entityType)}/${encodeURIComponent(s.entityId)}`,
            definition: { type: `${XAPI}/activities/${encodeURIComponent(s.entityType)}` }
        },
        context: {
            platform: 'ePoc',
            contextActivities: {
                parent: [{
                    objectType: 'Activity',
                    id: epocIri,
                    definition: { name: { 'en-US': epoc.title || s.epocId } }
                }]
            }
        }
    };

    if (s.verb === 'scored') statement.result = { score: { raw: Number(s.value) } };
    if (s.verb === 'passed') statement.result = { success: Boolean(s.value) };
    if (s.verb === 'completed') statement.result = { completion: true };

    return statement;
}

// ---------------------------------------------------------------
// Local storage (separate for each ePoc)
// ---------------------------------------------------------------

function storageKey(name) {
    return `epoc-plugin-xapi:${epoc.id}:${name}`;
}

function load(name) {
    const value = localStorage.getItem(storageKey(name));
    return value === null ? null : JSON.parse(value);
}

function save(name, value) {
    localStorage.setItem(storageKey(name), JSON.stringify(value));
}

function remove(name) {
    localStorage.removeItem(storageKey(name));
}

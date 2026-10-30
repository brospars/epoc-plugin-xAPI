# ePoc plugin xAPI

An [ePoc](https://epoc.inria.fr) plugin that sends the reading events of an ePoc (pages viewed, contents read, videos, answers to questions…) to the service of your choice:

- **Umami** (cloud or self-hosted): simple audience analytics, no authentication;
- **an xAPI LRS** (for example [LRS.io](https://lrs.io)): full xAPI statements, with an access key.

Nothing is sent until the learner has given consent.

## Privacy and consent

ePoc requires no account and centralizes no data. This plugin keeps that principle: you, the ePoc author, choose where your learners' data goes, and it is up to you to inform them.

The plugin works as follows:

- it displays a consent block (the `[#xapi-consent]` shortcode) that you place in your ePoc;
- as long as the learner has not answered, or if they refuse, **no event is collected or sent**;
- if they agree, a random identifier is created on their device. No name or email is sent;
- they can change their mind at any time from the same block. If they withdraw consent, the identifier and pending events are deleted from the device;
- the choice is stored separately for each ePoc.

Adapt the text in `consent.html` to clearly state who collects the data, which data, where it is stored and for what purpose. Depending on your context (GDPR in particular), you are responsible for this processing.

## Installation

1. Download `plugin.js` and `consent.html`.
2. Fill in the configuration at the top of `plugin.js` (see the two options below).
3. In the ePoc editor, open the ePoc settings and add the plugin: `plugin.js` as the JavaScript file and `consent.html` as the template.
4. Add the `[#xapi-consent]` shortcode to a text page, ideally the very first page of the ePoc, so the learner sees the question right away.

## Option 1: Umami (audience analytics)

[Umami](https://umami.is) is an open source, privacy-friendly analytics tool. Sending events only requires a public website ID, no password.

- **Umami Cloud**: a free plan is available ("Hobby", around 100,000 events per month).
- **Self-hosted Umami**: free and unlimited, on your own server.

### Configuration

1. Create an account on [cloud.umami.is](https://cloud.umami.is) or use your own instance.
2. Add a website (name and domain are up to you, for example "My ePoc" and `epoc`).
3. Copy the *Website ID* (a UUID) from the website settings.
4. In `plugin.js`:

```js
const CONFIG = {
    mode: 'umami',
    umami: {
        host: 'https://cloud.umami.is', // or the address of your Umami server
        websiteId: 'your-website-id'
    },
    ...
};
```

### What you will see in Umami

Each ePoc event becomes an Umami event:

| Umami field | Value | Example |
|---|---|---|
| Event name | `<entityType>-<verb>` | `questions-passed` |
| URL | `/<epocId>/<entityType>/<entityId>` | `/E001/questions/q1` |
| Title | ePoc title | `My ePoc` |
| Data | the full statement | `{ verb: 'scored', value: 2, … }` |
| Identifier | anonymous learner identifier | random UUID |

URLs show the most viewed contents, and event names let you count questions attempted, passed, etc.

### Other possible tools

The plugin only supports Umami, but other tools accept events with a simple public identifier. You can adapt the `sendToUmami` function in `plugin.js` to use them:

- [PostHog](https://posthog.com): free plan with one million events per month, EU hosting available;
- [Matomo](https://matomo.org): widely used by institutions, often already installed (HTTP tracking API, custom events).

## Option 2: xAPI LRS (LRS.io)

An LRS (*Learning Record Store*) stores statements in the standard [xAPI](https://xapi.com) format, richer and usable by other analytics tools. [LRS.io](https://lrs.io) offers a free plan: up to 3 LRSs and around 100,000 statements per LRS.

### Configuration

1. Create an account on [lrs.io](https://lrs.io), then an LRS. Its name will be part of the xAPI endpoint address.
2. On the LRS management page, create an **access key**. LRS.io suggests a username and a password.
3. For this key, **check "Write" only** and uncheck "Read", "Limited Read" and "Advanced Queries".
4. Copy the xAPI endpoint address of your LRS.
5. In `plugin.js`:

```js
const CONFIG = {
    mode: 'lrs',
    ...
    lrs: {
        endpoint: 'https://my-lrs.lrs.io/xapi/', // the xAPI endpoint of your LRS
        key: 'key-username',
        secret: 'key-password'
    }
};
```

The plugin also works with any other xAPI 1.0.3 conformant LRS (Ralph, TRAX, SCORM Cloud…) that accepts Basic authentication.

### About the key

The key is stored in `plugin.js`, which is distributed with the ePoc: anyone can read it. That is why it must have **the write permission only**. This way, nobody can read your learners' data with it. Someone could however send fake statements to your LRS: if that happens, disable the key in LRS.io, create a new one and publish an update of the ePoc.

### Statement format

Each ePoc event becomes an xAPI statement:

- **actor**: an anonymous account `{ homePage: 'https://epoc.inria.fr', name: '<random identifier>' }`;
- **verb**: a standard xAPI verb when one exists (see the table);
- **object**: the activity `https://epoc.inria.fr/xapi/epoc/<epocId>/<entityType>/<entityId>`;
- **context**: the parent ePoc (with its title) and the `ePoc` platform;
- **result**: the score for `scored`, success for `passed`, completion for `completed`.

| ePoc verb | xAPI verb |
|---|---|
| `started` | `http://adlnet.gov/expapi/verbs/initialized` |
| `viewed` | `http://id.tincanapi.com/verb/viewed` |
| `read`, `watched`, `listened` | `http://adlnet.gov/expapi/verbs/experienced` |
| `played` | `https://w3id.org/xapi/video/verbs/played` |
| `attempted` | `http://adlnet.gov/expapi/verbs/attempted` |
| `scored` | `http://adlnet.gov/expapi/verbs/scored` |
| `completed` | `http://adlnet.gov/expapi/verbs/completed` |
| `passed` (true / false) | `http://adlnet.gov/expapi/verbs/passed` / `.../failed` |

The original ePoc verb name is kept in `verb.display`.

You will find the statements in the LRS.io statement viewer, and charts on its "Analytics" page.

## How it works and limitations

- Events are sent in batches every 10 seconds (`SEND_INTERVAL`). Without network, they are kept in memory and sent later. They are lost if the app is closed before they are sent.
- The chosen service must allow requests from the app (CORS). Umami does. For an LRS, check it with a first test.
- If sending fails, an `[xapi plugin]` message is logged in the console.

## Available events

The plugin uses the `statement` event of the [ePoc plugin API](https://epoc.inria.fr/en/guide/developer/plugins/create/). Each statement contains `epocId`, `entityType` (`global`, `chapters`, `pages`, `contents`, `questions`), `entityId`, `verb` and `value`.

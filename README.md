# Is JAM Down for Everyone or Just Me?

Independent browser-path monitoring for the six `jam-public-devnet` validators used by [jamlc.paseo.fyi](https://jamlc.paseo.fyi/).

**Canonical status:** https://replghost.github.io/jam-status/

**DotNS alias:** `jamstatus.paseo` — [paseo.fyi](https://jamstatus.paseo.fyi/) / [paseo.li](https://jamstatus.paseo.li/)

The monitor distinguishes four layers:

1. the hosted `jamlc.paseo.fyi` shell answers over HTTPS;
2. Chromium completes certificate-pinned WebTransport to each validator;
3. the endpoint exchanges a framed JAM UP0 handshake;
4. the endpoint emits a live block announcement.

A scheduled GitHub Actions runner checks every five minutes and publishes a rolling 90-day JSONL history and static dashboard to GitHub Pages. Two consecutive all-validator failures declare an incident; two consecutive non-down observations resolve it. The dashboard's **Run test from this browser** action executes the same WebTransport and UP0 check from the visitor's network. It retries only failed validators once after 6.5 seconds, then reports both attempts and their exact failure phases.

On narrow screens, each validator observation is rendered as a two-column detail card so every endpoint, transport phase, announcement result, and latency remains visible without horizontal scrolling.

## Status interpretation

| External monitor | Visitor test | Interpretation |
| --- | --- | --- |
| Up | Up | Both paths are healthy |
| Up | Down | Likely visitor browser, router, ISP, or regional path |
| Down | Down | Likely shared validator/VPS outage |
| Down | Up | Monitor or monitor-region path failure |
| Up or down | WebTransport unavailable | External result only; this browser cannot run the visitor probe |

These are sampled observations, not proof about every network on the Internet.

## Public data

- `data/status.json`: stable state, latest observation, and rolling metrics
- `data/latest.json`: latest raw probe
- `data/history.jsonl`: one schema-1 observation per line, retained for 90 days
- `data/incidents.json`: derived incident intervals

States:

- `operational`: all six validators emitted valid UP0 announcements;
- `degraded`: at least one validator completed UP0, but fewer than six announced;
- `investigating`: first consecutive all-validator failure;
- `down`: two or more consecutive all-validator failures;
- `recovering`: one non-down observation after an incident;
- `unknown`: absent, stale, or internally failed monitoring data.

## Local operation

Requires Node.js 22+ and Chrome.

```sh
npm ci
npm test
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run probe
npm run build:status
npm run build:site
npm run serve
```

The live probe always writes an observation, including outages. Validator downtime does not make the workflow fail before the down state can be published. Internal monitor failures are recorded as `unknown`.

## Browser compatibility

The publishing workflow uses Chrome as the availability reference. A separate daily compatibility workflow runs the full certificate-pinned WebTransport, JAM UP0 handshake and announcement probe in current Chrome and Firefox, retries failed validators up to three times after 6.5 seconds, fails unless all six announce, and uploads each raw observation without changing public status or incidents.

Mobile engines remain release checks because GitHub-hosted Linux runners do not provide representative Android Chrome or Apple Network.framework:

- current Chrome on a physical Android device;
- Safari on a physical iPhone or iPad running iOS 26.4 or newer;
- Safari on macOS 26.4 or newer.

The iOS Simulator is useful for regression testing but does not replace a physical-device run. WebKitGTK on Linux is not a supported WebTransport target; its rendering can be tested, but it does not establish Safari transport compatibility.

## Network membership

This monitor observes a fixed development network, not a permissionless validator pool. Its six random validator keysets and addresses were installed in genesis. Other clients may connect as ordinary peers, but a node does not become a validator by connecting. JAM supports validator-set rotation through the privileged on-chain `designate` service and epoch transitions; this development chain did not install a public admission or staking mechanism.

## Source provenance

The deterministic certificate reconstruction in `src/certificates.js` is adapted from the MIT-licensed `paritytech/host-rust-core` implementation. See [NOTICE](NOTICE).

// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host. The worker reads
// the real board and the log at the default path, so `live` and `chinese` show the live state: once fresh, once in
// Chinese. `cover` answers inbox.list with made-up data instead, Wired points open, for the listing images:
// orca plugin shot . --scenario cover --theme dark
import { defineCheck } from 'orca/testing'
import type { Inbox, InboxMessage } from './protocol'

const ago = (minutes: number) => Date.now() - minutes * 60_000

const message = (id: string, minutes: number, key: string, text: string, read: boolean, url: string | null = null): InboxMessage => ({
  id,
  at: ago(minutes),
  key,
  text,
  url,
  read
})

const cover: Inbox = {
  waiting: [
    {
      path: '/work/payments-api/PAY-2318',
      key: 'PAY-2318',
      repo: 'payments-api',
      reason: 'The migration drops the unused settlement_batch index on 40M rows. OK to run it on staging?',
      since: ago(4),
      url: 'https://github.com/acme/payments-api/pull/924',
      terminal: 'term_1'
    },
    {
      path: '/work/payments-api/PAY-2297',
      key: 'PAY-2297',
      repo: 'payments-api',
      reason: 'Refunds round half-up in the API but half-even in the ledger. Which one is the spec?',
      since: ago(52),
      url: null,
      terminal: 'term_3'
    },
    {
      path: '/work/platform/release-2.14',
      key: 'release-2.14.0',
      repo: 'platform',
      reason: 'All 1,284 checks are green on staging. Tag v2.14.0 and roll out to production?',
      since: ago(95),
      url: 'https://github.com/acme/platform/actions/runs/8812',
      terminal: 'term_4'
    }
  ],
  messages: [
    message('m01', 9, 'nightly-e2e', '3 of 412 tests failed in checkout-flow; the report is attached.', false, 'https://ci.acme.dev/e2e/2231'),
    message('m02', 34, 'aws-sso', 'The session expires in 2 hours. Run aws sso login before the 18:00 deploy.', false),
    message('m03', 71, 'PAY-2305', 'PR #918 is open and green, ready for your review.', false, 'https://github.com/acme/payments-api/pull/918'),
    message('m04', 180, 'dependency-audit', 'Two high-severity advisories in undici; fix PR #921 opened.', false, 'https://github.com/acme/web-app/pull/921'),
    message('m05', 310, 'db-backup', 'Weekly snapshot finished: 182 GB in 41 min, restore verified.', false),
    message('m06', 420, 'WEB-1138', 'Merged into main and deployed to staging.', true),
    message('m07', 600, 'perf-bench', 'p95 latency of /checkout is down from 412 ms to 287 ms.', true),
    message('m08', 1_380, 'PAY-2281', 'Ready for QA: test notes posted on the ticket.', true),
    message('m09', 1_500, 'nightly-e2e', 'All 412 tests passed.', true),
    message('m10', 2_900, 'cost-report', 'Cloud spend this week: $4,812, 3% under budget.', true),
    message('m11', 4_300, 'release-2.13.2', 'Rolled out to production; error rate unchanged.', true)
  ],
  unreadCount: 5,
  readCount: 6,
  points: [
    { id: 'decision-gate', kind: 'ask', key: '<ticket>', when: 'The agent stops for a decision only you can make', wiredIn: 'CLAUDE.md, "Stop for review"' },
    { id: 'prod-deploy', kind: 'ask', key: 'release-<version>', when: 'Before a production rollout', wiredIn: 'scripts/release.sh' },
    { id: 'db-migration', kind: 'ask', key: '<ticket>', when: 'Before a migration that rewrites data', wiredIn: 'scripts/migrate.sh' },
    { id: 'nightly-e2e', kind: 'notify', key: 'nightly-e2e', when: 'The nightly e2e run ends', wiredIn: 'Orca automation "Nightly e2e"' },
    { id: 'pr-ready', kind: 'notify', key: '<ticket>', when: 'A PR is open and its checks pass', wiredIn: 'CLAUDE.md, "Open the PR"' },
    { id: 'credential-expiry', kind: 'notify', key: 'aws-sso', when: 'A cloud session is about to expire', wiredIn: '~/bin/check-sso.sh (cron)' },
    { id: 'db-backup', kind: 'notify', key: 'db-backup', when: 'The weekly snapshot ends', wiredIn: 'Orca automation "DB backup"' }
  ],
  retentionDays: 7,
  language: 'en',
  setup: {
    cli: '~/.config/agent-inbox/bin/agent-inbox',
    guide: '~/.config/agent-inbox/agent-guide.md',
    log: '~/.local/state/agent-inbox/inbox.jsonl'
  },
  setupPending: false,
  error: null
}

export default defineCheck({
  live: {},
  chinese: { settings: { language: 'zh-CN' } },
  cover: { requests: { 'inbox.list': () => cover }, persisted: { plugin: { pointsOpen: true } } },
  // a shot stops at the window's height: with nothing above them, the wired points fit in one
  'cover-points': { requests: { 'inbox.list': () => ({ ...cover, waiting: [], messages: [], unreadCount: 0, readCount: 0 }) }, persisted: { plugin: { pointsOpen: true } } }
})

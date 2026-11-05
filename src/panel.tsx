// Agent Inbox: what agents and scripts wait on you for. Data and actions come from src/worker.ts.
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Collapsible,
  EmptyState,
  env,
  Heading,
  IconButton,
  KeyValue,
  Link,
  on,
  plugin,
  read,
  RelativeTime,
  Row,
  Separator,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import { strings } from './i18n'
import type { ActionResult, Inbox, InboxMessage, WaitingItem } from './protocol'

const REFRESH_MS = 60_000

const inbox = atom<Inbox | null>(null)
/** The last failed request or action, shown until the next one succeeds. */
const failure = atom<string | null>(null)

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const t = () => strings(read(inbox)?.language ?? 'auto', env.locale)

async function refresh(): Promise<void> {
  try {
    set(inbox, await plugin.request('inbox.list'))
    set(failure, null)
  } catch (e) {
    set(failure, t().loadFailed(errorText(e)))
  }
}

async function act(request: Promise<ActionResult>, then?: () => Promise<void>): Promise<void> {
  try {
    const result = await request
    const error = result.error === 'no-terminal' ? t().noTerminal : (result.error ?? t().actionFailed)
    set(failure, result.ok ? null : error)
  } catch (e) {
    set(failure, errorText(e))
  }
  if (then) await then()
}

const goTo = (w: WaitingItem) => act(plugin.request('inbox.open', { path: w.path, terminal: w.terminal }))
const resolve = (w: WaitingItem) => act(plugin.request('inbox.resolve', { path: w.path, key: w.key }), refresh)
const dismiss = (m: InboxMessage) => act(plugin.request('inbox.dismiss', { id: m.id }), refresh)
const openLink = (url: string) => void shell.openExternal(url)

export function setup(ctx: PanelContext): void {
  void refresh()
  let pending: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(pending)
    pending = setTimeout(() => void refresh(), 1_000)
  }
  // the worker posts when the log or the settings change; agents stopping and workspaces coming or going
  // change the board
  ctx.subscriptions.push(
    plugin.on('inbox.changed', soon),
    on('agent.status.changed', soon),
    on('workspace.created', soon),
    on('workspace.removed', soon)
  )
  // a card dragged on the board by hand sends no event
  const timer = setInterval(() => {
    if (read(ctx.visible)) void refresh()
  }, REFRESH_MS)
  ctx.signal.addEventListener('abort', () => {
    clearInterval(timer)
    clearTimeout(pending)
  })
}

function waitingCard(w: WaitingItem) {
  const s = t()
  return (
    <Card title={w.key} description={w.repo}>
      <Stack gap="sm">
        <Text>{w.reason ?? s.noReason}</Text>
        {w.since !== null && (
          <Text muted size="xs">
            {s.askedAt} <RelativeTime at={w.since} />
          </Text>
        )}
        <Row gap="xs">
          <Button size="sm" icon="terminal" onPress={() => goTo(w)} tooltip={s.goToTip}>
            {s.goTo}
          </Button>
          <Button size="sm" variant="ghost" icon="check" onPress={() => resolve(w)} tooltip={s.resolveTip}>
            {s.resolve}
          </Button>
          {w.url !== null && <Link onPress={() => openLink(w.url as string)}>{s.openLink}</Link>}
        </Row>
      </Stack>
    </Card>
  )
}

function messageRow(m: InboxMessage) {
  const s = t()
  return (
    <Stack gap="xs">
      <Row justify="between" align="start" gap="xs">
        <Text size="sm">
          <Text size="sm" weight="semibold">
            {m.key}
          </Text>{' '}
          {m.text}
        </Text>
        <IconButton icon="close" label={s.hide} size="xs" variant="ghost" onPress={() => dismiss(m)} />
      </Row>
      <Row gap="sm" align="center">
        <Text muted size="xs">
          <RelativeTime at={m.at} />
        </Text>
        {m.url !== null && <Link onPress={() => openLink(m.url as string)}>{s.openLink}</Link>}
      </Row>
    </Stack>
  )
}

function setupSection(data: Inbox) {
  const s = t()
  const empty = data.waiting.length === 0 && data.messages.length === 0
  return (
    <Collapsible title={s.setup} description={s.setupDescription} defaultOpen={empty}>
      <Stack gap="sm">
        <Text size="sm">{s.setupBody}</Text>
        <Code block>{s.setupPrompt(data.setup.guide)}</Code>
        <KeyValue
          items={[
            { label: s.cli, value: data.setup.cli, code: true },
            { label: s.guide, value: data.setup.guide, code: true },
            { label: s.log, value: data.setup.log, code: true }
          ]}
        />
      </Stack>
    </Collapsible>
  )
}

export default function Panel() {
  const data = read(inbox)
  const error = read(failure)
  const s = t()
  if (data === null) {
    return <Stack gap="md">{error !== null ? <Callout tone="danger">{error}</Callout> : <Spinner label={s.loading} />}</Stack>
  }
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Row gap="xs" align="center">
          <Heading level={2}>{s.waiting}</Heading>
          <Badge tone={data.waiting.length > 0 ? 'warning' : 'neutral'}>{String(data.waiting.length)}</Badge>
        </Row>
        <IconButton icon="refresh" label={s.refresh} size="sm" variant="ghost" onPress={() => void refresh()} />
      </Row>
      {error !== null && <Callout tone="danger">{error}</Callout>}
      {data.error !== null && (
        <Callout tone="danger" title={s.problem}>
          {data.error}
        </Callout>
      )}
      {data.waiting.length === 0 ? (
        <EmptyState icon="check" title={s.noneWaiting} />
      ) : (
        <Stack gap="sm">{data.waiting.map(waitingCard)}</Stack>
      )}
      <Separator />
      <Collapsible title={s.messages(data.messages.length)} description={s.lastDays(data.retentionDays)} defaultOpen>
        {data.messages.length === 0 ? (
          <Text muted size="sm">
            {s.noMessages}
          </Text>
        ) : (
          <Stack gap="md">{data.messages.map(messageRow)}</Stack>
        )}
      </Collapsible>
      <Separator />
      {setupSection(data)}
    </Stack>
  )
}

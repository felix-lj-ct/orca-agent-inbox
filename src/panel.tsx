// Agent Inbox: what agents and scripts wait on you for. Data and actions come from src/worker.ts.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Code,
  Collapsible,
  EmptyState,
  env,
  IconButton,
  KeyValue,
  Link,
  plugin,
  read,
  RelativeTime,
  Row,
  Separator,
  set,
  shell,
  Spinner,
  Stack,
  Tab,
  Tabs,
  Text,
  type PanelContext
} from 'orca'
import { strings } from './i18n'
import { type ActionResult, type Inbox, type InboxMessage, REPO, type Setup, type WaitingItem, type WiredPoint } from './protocol'

const REFRESH_MS = 60_000
/** Messages shown at first in each list, and how many more each Show more adds. */
const MESSAGE_PAGE = 20
const REPO_URL = `https://github.com/${REPO}`

const inbox = atom<Inbox | null>(null)
/** The last failed request or action, shown until the next one succeeds. */
const failure = atom<string | null>(null)
const shownMessages = { unread: atom(MESSAGE_PAGE), history: atom(MESSAGE_PAGE) }
/** The setup prompt is on the clipboard. */
const copied = atom(false)
/** Wired points stay open or closed as the person left them; a run ends whenever another sidebar tab shows. */
const pointsOpen = atom('pointsOpen', false, { persist: 'plugin' })
/** The footer's Star worked once; it then only says thanks. */
const starred = atom('starred', false, { persist: 'plugin' })
/** busy while gh stars; failed: gh is missing or signed out, so the footer links to the page for this run. */
const starring = atom<'idle' | 'busy' | 'failed'>('idle')

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

/** Runs an action, shows why it failed, and says whether it worked. */
async function act(request: Promise<ActionResult>, then?: () => Promise<void>): Promise<boolean> {
  let ok = false
  try {
    const result = await request
    const s = t()
    const known: Record<string, string> = { 'no-terminal': s.noTerminal, 'no-clipboard': s.noClipboard, 'no-workspace': s.noWorkspace }
    const error = (result.error !== undefined ? known[result.error] : undefined) ?? result.error ?? s.actionFailed
    ok = result.ok
    set(failure, ok ? null : error)
  } catch (e) {
    set(failure, errorText(e))
  }
  if (then) await then()
  return ok
}

const goTo = (w: WaitingItem) => act(plugin.request('inbox.open', { path: w.path, terminal: w.terminal }))
const resolve = (w: WaitingItem) => act(plugin.request('inbox.resolve', { path: w.path, key: w.key }), refresh)
const markRead = (messages: InboxMessage[]) => act(plugin.request('inbox.read', { ids: messages.map((m) => m.id) }), refresh)
const openLink = (url: string) => void shell.openExternal(url)
const openMessage = (m: InboxMessage) => {
  openLink(m.url as string)
  if (!m.read) void markRead([m])
}
const copy = async (text: string) => set(copied, await act(plugin.request('inbox.copy', { text })))
const finishSetup = () => act(plugin.request('inbox.setupDone'), refresh)
/** The agent opens focused in the selected workspace; the points list follows its `point add` or `point remove`. */
const launch = (prompt: string) => act(plugin.request('inbox.launch', { prompt }))

/** Not through act: a star that fails is no problem of the inbox, so it stays in the footer. */
async function star(): Promise<void> {
  set(starring, 'busy')
  let ok = false
  try {
    ok = (await plugin.request('inbox.star')).ok
  } catch {
    // the worker is down: the link to the page still works
  }
  if (ok) set(starred, true)
  set(starring, ok ? 'idle' : 'failed')
}

export function setup(ctx: PanelContext): void {
  void refresh()
  let pending: ReturnType<typeof setTimeout> | undefined
  const soon = () => {
    clearTimeout(pending)
    pending = setTimeout(() => void refresh(), 1_000)
  }
  // the worker posts when the log or the settings change
  ctx.subscriptions.push(plugin.on('inbox.changed', soon))
  // the board sends no event: a card dragged by hand, a workspace removed
  const timer = setInterval(() => {
    if (read(ctx.visible)) void refresh()
  }, REFRESH_MS)
  ctx.signal.addEventListener('abort', () => {
    clearInterval(timer)
    clearTimeout(pending)
  })
}

/**
 * One ask as a bordered tile: what and when, the reason, then the actions with their names on them,
 * Go to agent filled as the one to take. The project shows in the group around it.
 */
function waitingItem(w: WaitingItem) {
  const s = t()
  return (
    <Box border="neutral" radius="md" paddingX="md" paddingY="sm" gap="sm">
      <Row justify="between" align="start" gap="sm">
        <Text size="sm" weight="semibold">
          {w.key}
        </Text>
        {w.since !== null && (
          <Text muted size="xs">
            <RelativeTime at={w.since} />
          </Text>
        )}
      </Row>
      <Text size="sm">{w.reason ?? s.noReason}</Text>
      <Row gap="xs" align="center" wrap>
        <Button size="sm" variant="solid" tone="accent" icon="terminal" tooltip={s.goToTip} onPress={() => goTo(w)}>
          {s.goTo}
        </Button>
        <Button size="sm" variant="outline" icon="check" tooltip={s.resolveTip} onPress={() => resolve(w)}>
          {s.resolve}
        </Button>
        {w.url !== null && <Link onPress={() => openLink(w.url as string)}>{s.openLink}</Link>}
      </Row>
    </Box>
  )
}

/** The waiting items by project; the group with the newest ask first, as the items come. */
function byProject(items: WaitingItem[]): { repo: string; items: WaitingItem[] }[] {
  const groups = new Map<string, WaitingItem[]>()
  for (const w of items) groups.set(w.repo, [...(groups.get(w.repo) ?? []), w])
  return [...groups].map(([repo, items]) => ({ repo, items }))
}

function projectGroup(group: { repo: string; items: WaitingItem[] }) {
  const s = t()
  return (
    <Collapsible key={`repo:${group.repo}`} title={s.project(group.repo || s.noProject, group.items.length)} defaultOpen>
      <Stack gap="sm">{group.items.map(waitingItem)}</Stack>
    </Collapsible>
  )
}

/** Unread: the key in bold and a Mark read button; read: the whole line muted. */
function messageRow(m: InboxMessage) {
  const s = t()
  return (
    <Stack gap="xs">
      <Text size="sm" muted={m.read}>
        <Text size="sm" weight={m.read ? undefined : 'semibold'} muted={m.read}>
          {m.key}
        </Text>{' '}
        {m.text}
      </Text>
      <Row justify="between" align="center" gap="sm">
        <Row gap="sm" align="center">
          <Text muted size="xs">
            <RelativeTime at={m.at} />
          </Text>
          {m.url !== null && <Link onPress={() => openMessage(m)}>{s.openLink}</Link>}
        </Row>
        {!m.read && (
          <Button size="xs" variant="outline" icon="check" onPress={() => markRead([m])}>
            {s.markRead}
          </Button>
        )}
      </Row>
    </Stack>
  )
}

function messageList(messages: InboxMessage[], list: keyof typeof shownMessages) {
  const s = t()
  const shown = read(shownMessages[list])
  const rest = messages.length - shown
  return (
    <Stack gap="md">
      {messages.slice(0, shown).map(messageRow)}
      {rest > 0 && (
        <Button size="sm" variant="ghost" onPress={() => set(shownMessages[list], shown + MESSAGE_PAGE)}>
          {s.showMore(rest)}
        </Button>
      )}
    </Stack>
  )
}

/** Unread and Read tabs; Mark all read sits over the unread ones. */
function messagesSection(messages: InboxMessage[], retentionDays: number) {
  const s = t()
  const unread = messages.filter((m) => !m.read)
  const history = messages.filter((m) => m.read)
  return (
    <Collapsible title={s.messages(unread.length)} description={s.lastDays(retentionDays)} defaultOpen>
      <Tabs label={s.messagesTabs} defaultValue="unread">
        <Tab value="unread" label={s.unreadTab(unread.length)}>
          {unread.length === 0 ? (
            <Text muted size="sm">
              {s.noUnread}
            </Text>
          ) : (
            <Stack gap="md">
              <Row justify="end">
                <Button size="sm" variant="outline" icon="check" onPress={() => markRead(unread)}>
                  {s.markAllRead}
                </Button>
              </Row>
              {messageList(unread, 'unread')}
            </Stack>
          )}
        </Tab>
        <Tab value="read" label={s.readTab(history.length)}>
          {history.length === 0 ? (
            <Text muted size="sm">
              {s.noRead}
            </Text>
          ) : (
            messageList(history, 'history')
          )}
        </Tab>
      </Tabs>
    </Collapsible>
  )
}

/** Where the point shows as a badge, then when it sends; under it the key, the place that sends, and Remove. */
function pointRow(p: WiredPoint, guide: string) {
  const s = t()
  return (
    <Stack gap="xs">
      <Row gap="sm" align="center">
        <Badge tone={p.kind === 'ask' ? 'accent' : 'neutral'}>{s.pointKind(p.kind)}</Badge>
        <Text size="sm">{p.when}</Text>
      </Row>
      <Row justify="between" align="center" gap="sm">
        <Text muted size="xs">
          {s.pointDetail(p.key, p.wiredIn)}
        </Text>
        <Button size="xs" variant="outline" icon="delete" tooltip={s.removePointTip} onPress={() => launch(s.removePointPrompt(guide, p))}>
          {s.removePoint}
        </Button>
      </Row>
    </Stack>
  )
}

/**
 * What can write here, as the CLI recorded it: asks first, in the order they were recorded, under Add a point
 * and Align. Every action hands the change to an agent with a prompt. Closed until opened, then as left.
 */
function pointsSection(points: WiredPoint[], guide: string) {
  const s = t()
  const ordered = [...points.filter((p) => p.kind === 'ask'), ...points.filter((p) => p.kind === 'notify')]
  return (
    <Collapsible title={s.points(points.length)} description={s.pointsDescription} open={read(pointsOpen)} onChange={(open) => set(pointsOpen, open)}>
      <Stack gap="md">
        <Row gap="sm">
          <Button size="sm" variant="solid" tone="accent" icon="add" tooltip={s.addPointTip} onPress={() => launch(s.addPointPrompt(guide))}>
            {s.addPoint}
          </Button>
          <Button size="sm" variant="outline" icon="search" tooltip={s.alignPointsTip} onPress={() => launch(s.alignPointsPrompt(guide))}>
            {s.alignPoints}
          </Button>
        </Row>
        {points.length === 0 ? (
          <Text muted size="sm">
            {s.noPoints}
          </Text>
        ) : (
          ordered.map((p) => pointRow(p, guide))
        )}
      </Stack>
    </Collapsible>
  )
}

/** Waits on a person who has not sent anything yet; the log path setting describes the same afterwards. */
function setupCard(setup: Setup) {
  const s = t()
  const prompt = s.setupPrompt(setup.guide)
  return (
    <Card title={s.setup} description={s.setupDescription}>
      <Stack gap="sm">
        <Text size="sm">{s.setupBody}</Text>
        <Code block>{prompt}</Code>
        <KeyValue
          items={[
            { label: s.cli, value: setup.cli, code: true },
            { label: s.guide, value: setup.guide, code: true },
            { label: s.log, value: setup.log, code: true }
          ]}
        />
        <Row gap="xs" align="center">
          <Button size="sm" icon="copy" onPress={() => copy(prompt)}>
            {s.copyPrompt}
          </Button>
          <Button size="sm" variant="ghost" icon="check" onPress={finishSetup} tooltip={s.setupDoneTip}>
            {s.resolve}
          </Button>
          {read(copied) && (
            <Text muted size="xs">
              {s.copied}
            </Text>
          )}
        </Row>
      </Stack>
    </Card>
  )
}

/** Star stars the repository through the person's gh CLI; without gh it links to the page instead. */
function starLine() {
  const s = t()
  if (read(starred)) {
    return (
      <Text muted size="xs">
        {s.starred}
      </Text>
    )
  }
  if (read(starring) === 'failed') {
    return (
      <Text muted size="xs">
        {s.starNeedsGh} <Link href={REPO_URL}>{s.starOnPage}</Link>
      </Text>
    )
  }
  return (
    <Row gap="sm" align="center" justify="center" wrap>
      <Text muted size="xs">
        {s.starAsk}
      </Text>
      <Button size="xs" variant="outline" icon="star" tooltip={s.starTip} disabled={read(starring) === 'busy'} onPress={star}>
        {s.star}
      </Button>
    </Row>
  )
}

/** Under everything, at the bottom of the panel however little is above it. */
function footer() {
  return (
    <Stack gap="sm">
      <Separator />
      <Row justify="center">{starLine()}</Row>
    </Stack>
  )
}

function inboxView(data: Inbox, error: string | null) {
  const s = t()
  return (
    <Stack gap="md">
      <Row justify="end">
        <IconButton icon="refresh" label={s.refresh} size="sm" variant="ghost" onPress={() => void refresh()} />
      </Row>
      {error !== null && <Callout tone="danger">{error}</Callout>}
      {data.error !== null && (
        <Callout tone="danger" title={s.problem}>
          {data.error}
        </Callout>
      )}
      <Collapsible title={s.waiting(data.waiting.length + (data.setupPending ? 1 : 0))} defaultOpen>
        {data.waiting.length === 0 && !data.setupPending ? (
          <EmptyState icon="check" title={s.noneWaiting} />
        ) : (
          <Stack gap="sm">
            {data.setupPending && setupCard(data.setup)}
            {byProject(data.waiting).map(projectGroup)}
          </Stack>
        )}
      </Collapsible>
      <Separator />
      {messagesSection(data.messages, data.retentionDays)}
      <Separator />
      {pointsSection(data.points, data.setup.guide)}
    </Stack>
  )
}

/**
 * Orca's sidebar keeps no room for its scrollbar, so content growing past the window height would narrow the
 * whole panel. At least the full height plus a margin, the panel always overflows a little: the scrollbar stays
 * and nothing shifts sideways when a section opens or closes.
 */
export default function Panel() {
  const data = read(inbox)
  const error = read(failure)
  const s = t()
  return (
    <Box minHeight="100%" shrink={false} margin="xs" justify="between" gap="lg">
      {data !== null ? (
        inboxView(data, error)
      ) : (
        <Stack gap="md">{error !== null ? <Callout tone="danger">{error}</Callout> : <Spinner label={s.loading} />}</Stack>
      )}
      {footer()}
    </Box>
  )
}

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
  type OrcaNode,
  type PanelContext
} from 'orca'
import { strings } from './i18n'
import { type ActionResult, type Inbox, type InboxMessage, MESSAGE_PAGE, REPO, type Setup, type WaitingItem, type WiredPoint } from './protocol'

const REFRESH_MS = 60_000
/** The longest a request may wait: the worker reads the board, then gives the agent up to a minute to start. */
const LAUNCH_TIMEOUT_MS = 120_000
const REPO_URL = `https://github.com/${REPO}`

const inbox = atom<Inbox | null>(null)
/** The last failed request or action, shown until the next one succeeds. */
const failure = atom<string | null>(null)
const shownMessages = { unread: atom(MESSAGE_PAGE), history: atom(MESSAGE_PAGE) }
const messagesOpen = atom(true)
const messagesTab = atom<'unread' | 'read'>('unread')
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
    set(inbox, await plugin.request('inbox.list', { unread: read(shownMessages.unread), read: read(shownMessages.history) }))
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
/** Every unread message up to the newest shown, those behind Show more too. */
const markAllRead = (newest: InboxMessage) => act(plugin.request('inbox.readAll', { through: newest.at }), refresh)
/** Whether the link opened: Orca refuses one that is not http, https or mailto, and the person may cancel its prompt. */
async function openLink(url: string): Promise<boolean> {
  try {
    return (await shell.openExternal(url)).opened
  } catch (e) {
    set(failure, t().openLinkFailed(errorText(e)))
    return false
  }
}
/** A message counts as read once its link opened. */
const openMessage = async (m: InboxMessage) => {
  if ((await openLink(m.url as string)) && !m.read) await markRead([m])
}
const copy = async (text: string) => set(copied, await act(plugin.request('inbox.copy', { text })))
const finishSetup = () => act(plugin.request('inbox.setupDone'), refresh)
/** The agent opens focused in the selected workspace; the points list follows its `point add` or `point remove`. */
const launch = (prompt: string) => act(plugin.request('inbox.launch', { prompt }, { timeoutMs: LAUNCH_TIMEOUT_MS }))

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

/** The messages the worker sent for a list, and Show more while it holds more than that. */
function messageList(messages: InboxMessage[], total: number, list: keyof typeof shownMessages) {
  const s = t()
  const rest = total - messages.length
  const showMore = () => {
    set(shownMessages[list], messages.length + MESSAGE_PAGE)
    return refresh()
  }
  return (
    <Stack gap="md">
      {messages.map(messageRow)}
      {rest > 0 && (
        <Button size="sm" variant="ghost" onPress={showMore}>
          {s.showMore(rest)}
        </Button>
      )}
    </Stack>
  )
}

/**
 * A section that opens and closes, with its note muted beside the title. Orca draws a Collapsible's title in one
 * colour and its description on a line of its own, so the Collapsible here is only the header; the body goes
 * under it, indented as Orca indents a Collapsible's. Both sit 8px from the top: the note lines up with the title.
 */
function notedSection(title: string, note: string, open: boolean, onChange: (open: boolean) => void, body: OrcaNode) {
  return (
    <Stack gap="none">
      <Row align="start" gap="sm">
        <Box shrink={false}>
          <Collapsible title={title} open={open} onChange={onChange} />
        </Box>
        <Box paddingY="sm" minWidth={0}>
          <Text muted size="sm" truncate>
            {note}
          </Text>
        </Box>
      </Row>
      {open && (
        <Row gap="none" align="start">
          <Box width={24} shrink={false} />
          <Box grow minWidth={0} gap="md">
            {body}
          </Box>
        </Row>
      )}
    </Stack>
  )
}

/**
 * Unread and Read tabs, Mark all read at the end of the tab bar on Unread. Orca's Tabs take nothing beside the
 * tab names, so the Tabs draw only the bar and the selected list goes under the row.
 */
function messagesSection(data: Inbox) {
  const s = t()
  const unread = data.messages.filter((m) => !m.read)
  const history = data.messages.filter((m) => m.read)
  const tab = read(messagesTab)
  const empty = (text: string) => (
    <Text muted size="sm">
      {text}
    </Text>
  )
  return notedSection(
    s.messages(data.unreadCount),
    s.lastDays(data.retentionDays),
    read(messagesOpen),
    (open) => set(messagesOpen, open),
    <>
      <Row justify="between" align="start" gap="sm" wrap>
        <Tabs label={s.messagesTabs} value={tab} onChange={(value) => set(messagesTab, value === 'read' ? 'read' : 'unread')}>
          <Tab value="unread" label={s.unreadTab(data.unreadCount)} />
          <Tab value="read" label={s.readTab(data.readCount)} />
        </Tabs>
        {tab === 'unread' && unread.length > 0 && (
          <Button size="sm" variant="outline" icon="check" onPress={() => markAllRead(unread[0])}>
            {s.markAllRead}
          </Button>
        )}
      </Row>
      {tab === 'unread'
        ? unread.length === 0
          ? empty(s.noUnread)
          : messageList(unread, data.unreadCount, 'unread')
        : history.length === 0
          ? empty(s.noRead)
          : messageList(history, data.readCount, 'history')}
    </>
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
  return notedSection(
    s.points(points.length),
    s.pointsDescription,
    read(pointsOpen),
    (open) => set(pointsOpen, open),
    <>
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
    </>
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
      {messagesSection(data)}
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

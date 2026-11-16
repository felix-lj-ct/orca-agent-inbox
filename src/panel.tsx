// Agent Inbox: what agents and scripts wait on you for. Data and actions come from src/worker.ts.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Collapsible,
  EmptyState,
  env,
  Input,
  Link,
  Markdown,
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
import { type ActionResult, type Inbox, type InboxMessage, MESSAGE_PAGE, REPO, type WaitingItem, type WiredPoint } from './protocol'
import { preview } from './preview'
import { DISCUSSIONS_URL, RECOMMENDED, recommended } from './recommended'

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
/** The point search the Messages list shows, and the one Wired points searches; '' is every point. */
const messagePoint = atom('')
const pointsPoint = atom('')
/** Wired points stay open or closed as the person left them; a run ends whenever another sidebar tab shows. */
const pointsOpen = atom('pointsOpen', false, { persist: 'plugin' })
/** Recommended points: open until the person closes them, then as left. */
const recommendedOpen = atom('recommendedOpen', true, { persist: 'plugin' })
/** The footer's Star worked once; it then only says thanks. */
const starred = atom('starred', false, { persist: 'plugin' })
/** busy while gh stars; failed: gh is missing or signed out, so the footer links to the page for this run. */
const starring = atom<'idle' | 'busy' | 'failed'>('idle')
/** The messages (by id) and asks (by path) shown whole after Show more. */
const expanded = atom<Record<string, boolean>>({})

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const t = () => strings(read(inbox)?.language ?? 'auto', env.locale)

/** The newest refresh wins: a search typed while an answer is on its way must not show the older answer. */
let refreshSeq = 0

async function refresh(): Promise<void> {
  const seq = ++refreshSeq
  try {
    const point = read(messagePoint).trim()
    const data = await plugin.request('inbox.list', {
      unread: read(shownMessages.unread),
      read: read(shownMessages.history),
      ...(point ? { point } : {})
    })
    if (seq !== refreshSeq) return
    set(inbox, data)
    // the settings can turn the point search off: a search typed before that does not come back with it
    if (data.showPointSearch === false) {
      set(messagePoint, '')
      set(pointsPoint, '')
    }
    set(failure, null)
  } catch (e) {
    if (seq === refreshSeq) set(failure, t().loadFailed(errorText(e)))
  }
}

/** Runs an action, shows why it failed, and says whether it worked. */
async function act(request: Promise<ActionResult>, then?: () => Promise<void>): Promise<boolean> {
  let ok = false
  try {
    const result = await request
    const s = t()
    const known: Record<string, string> = { 'no-terminal': s.noTerminal, 'no-workspace': s.noWorkspace }
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
/** Every unread message up to the newest shown, those behind Show more too, inside the Messages search. */
const markAllRead = (newest: InboxMessage) => {
  const point = read(messagePoint).trim()
  return act(plugin.request('inbox.readAll', { through: newest.at, ...(point ? { point } : {}) }), refresh)
}

let filterTimer: ReturnType<typeof setTimeout> | undefined

/** Types the Messages search; the worker filters after a pause, so typing a word costs one request. */
function filterMessages(value: string): void {
  set(messagePoint, value)
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => {
    set(shownMessages.unread, MESSAGE_PAGE)
    set(shownMessages.history, MESSAGE_PAGE)
    void refresh()
  }, 250)
}
/** Whether the link opened: Orca refuses one that is not http, https or mailto, and the person may cancel its prompt. */
async function openLink(url: string): Promise<boolean> {
  try {
    return (await shell.openExternal(url)).opened
  } catch (e) {
    set(failure, t().openLinkFailed(errorText(e)))
    return false
  }
}
/** A message counts as read once its link opened, unless the settings keep it unread until marked. */
const openMessage = async (m: InboxMessage) => {
  if ((await openLink(m.url as string)) && !m.read && !read(inbox)?.keepMessagesUntilRead) await markRead([m])
}
const finishSetup = () => act(plugin.request('inbox.setupDone'), refresh)
/** The agent opens focused in the selected workspace; the points list follows its `point add` or `point remove`. */
const launch = (prompt: string) => act(plugin.request('inbox.launch', { prompt }, { timeoutMs: LAUNCH_TIMEOUT_MS }))
/** Wired points opens on the new record, so the person sees where it went and where Remove is. */
async function addRecommended(p: WiredPoint): Promise<void> {
  if (await act(plugin.request('inbox.addRecommended', { id: p.id }), refresh)) set(pointsOpen, true)
}
const removeRecommended = (p: WiredPoint) => act(plugin.request('inbox.removeRecommended', { id: p.id }), refresh)

/**
 * A message or a reason as the CLI sent it: GitHub-flavoured Markdown. A long one shows its start, and Show more
 * shows it whole; id names it in `expanded`.
 */
function body(text: string, id: string) {
  const s = t()
  const start = preview(text)
  if (start === null) return <Markdown content={text} />
  const open = read(expanded)[id] === true
  return (
    <Stack gap="xs">
      <Markdown content={open ? text : start} />
      <Row>
        <Button size="xs" variant="ghost" onPress={() => set(expanded, { ...read(expanded), [id]: !open })}>
          {open ? s.showLessText : s.showMoreText}
        </Button>
      </Row>
    </Stack>
  )
}

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
    clearTimeout(filterTimer)
  })
}

/**
 * One ask as a bordered tile: what and when, the reason, then the actions with their names on them,
 * Go to agent filled as the one to take. The project shows in the group around it. An ask kept until handled
 * that the agent already resolved says so, muted, before the time.
 */
function waitingItem(w: WaitingItem) {
  const s = t()
  return (
    <Box key={`ask:${w.path}`} border="neutral" radius="md" paddingX="md" paddingY="sm" gap="sm">
      <Row justify="between" align="start" gap="sm">
        <Text size="sm" weight="semibold">
          {w.key}
        </Text>
        {w.since !== null && (
          <Text muted size="xs">
            {w.resumed && `${s.resumed} · `}
            <RelativeTime at={w.since} />
          </Text>
        )}
      </Row>
      {w.reason !== null ? body(w.reason, `ask:${w.path}`) : <Text size="sm">{s.noReason}</Text>}
      <Row gap="xs" align="center" wrap>
        <Button size="sm" variant="solid" tone="accent" icon="terminal" tooltip={s.goToTip} onPress={() => goTo(w)}>
          {s.goTo}
        </Button>
        <Button size="sm" variant="outline" icon="check" tooltip={w.resumed ? s.resolveResumedTip : s.resolveTip} onPress={() => resolve(w)}>
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

/**
 * One message as a bordered tile, like an ask: its key, the message as Markdown, then the time and actions.
 * Unread: the key in bold, Open link filled and a Mark read button; read: the key muted. Open link sits on
 * the right with Mark read, not after the time: Orca opens a link only from a control that has not moved since
 * it last looked, and the time changes width as it counts, every second in the first minute.
 */
function messageRow(m: InboxMessage) {
  const s = t()
  return (
    <Box key={`message:${m.id}`} border="neutral" radius="md" paddingX="md" paddingY="sm" gap="sm">
      <Text size="sm" weight={m.read ? undefined : 'semibold'} muted={m.read}>
        {m.key}
      </Text>
      {body(m.text, `message:${m.id}`)}
      <Row justify="between" align="center" gap="sm">
        <Text muted size="xs">
          <RelativeTime at={m.at} />
          {m.point !== null && ` · ${s.messagePoint(m.point)}`}
        </Text>
        <Row gap="sm" align="center">
          {m.url !== null && (
            <Button
              size="xs"
              variant={m.read ? 'outline' : 'solid'}
              tone={m.read ? undefined : 'accent'}
              icon="open-external"
              onPress={() => openMessage(m)}
            >
              {s.openLink}
            </Button>
          )}
          {!m.read && (
            <Button size="xs" variant="outline" icon="check" onPress={() => markRead([m])}>
              {s.markRead}
            </Button>
          )}
        </Row>
      </Row>
    </Box>
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
    <Stack gap="sm">
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
      {data.showPointSearch && (
        <Row gap="sm" align="center">
          <Box grow minWidth={0}>
            <Input
              label={s.filterMessages}
              labelHidden
              type="search"
              placeholder={s.filterMessagesPlaceholder}
              value={read(messagePoint)}
              onChange={filterMessages}
            />
          </Box>
        </Row>
      )}
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

/**
 * One point as a bordered tile, like an ask and a message: where it shows as a badge, then when it sends; under it
 * the key, the place that sends, Edit and Remove. A recommended point shows in the panel's language, has no Edit,
 * since the plugin wires it as it is, and Remove takes it out at once; the others an agent changes or takes out of
 * the workflow.
 */
function pointRow(p: WiredPoint, guide: string) {
  const s = t()
  const own = recommended(p.id) !== undefined
  const shown = { ...p, ...(own ? s.recommendedPoints[p.id] : undefined) }
  return (
    <Box key={`point:${p.id}`} border="neutral" radius="md" paddingX="md" paddingY="sm" gap="sm">
      <Row gap="sm" align="center">
        <Badge tone={p.kind === 'ask' ? 'accent' : 'neutral'}>{s.pointKind(p.kind)}</Badge>
        <Badge tone="neutral">{shown.id}</Badge>
        <Text size="sm">{shown.when}</Text>
      </Row>
      <Row justify="between" align="center" gap="sm">
        <Box grow minWidth={0}>
          <Text muted size="xs">
            {s.pointDetail(shown.key, shown.wiredIn)}
          </Text>
        </Box>
        <Box direction="row" gap="xs" align="center" shrink={false}>
          {!own && (
            <Button size="xs" variant="outline" icon="edit" tooltip={s.editPointTip} onPress={() => launch(s.editPointPrompt(guide, p))}>
              {s.editPoint}
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            icon="delete"
            tooltip={own ? s.removeRecommendedTip : s.removePointTip}
            onPress={() => (own ? removeRecommended(p) : launch(s.removePointPrompt(guide, p)))}
          >
            {s.removePoint}
          </Button>
        </Box>
      </Row>
    </Box>
  )
}

/**
 * What can write here, as the CLI recorded it: asks first, in the order they were recorded, under Add a point
 * and Align. Every action hands the change to an agent with a prompt. Closed until opened, then as left.
 */
function pointsSection(points: WiredPoint[], guide: string, showSearch: boolean) {
  const s = t()
  const ordered = [...points.filter((p) => p.kind === 'ask'), ...points.filter((p) => p.kind === 'notify')]
  const query = showSearch ? read(pointsPoint).trim().toLowerCase() : ''
  const shown =
    query === ''
      ? ordered
      : ordered.filter((p) => [p.id, p.when, p.wiredIn, p.key].some((text) => text.toLowerCase().includes(query)))
  return notedSection(
    s.points(shown.length),
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
      {showSearch && points.length > 1 && (
        <Row gap="sm" align="center">
          <Box grow minWidth={0}>
            <Input
              label={s.filterPoints}
              labelHidden
              type="search"
              placeholder={s.filterPointsPlaceholder}
              value={read(pointsPoint)}
              onChange={(value) => set(pointsPoint, value)}
            />
          </Box>
        </Row>
      )}
      {points.length === 0 ? (
        <Text muted size="sm">
          {s.noPoints}
        </Text>
      ) : shown.length === 0 ? (
        <Text muted size="sm">
          {s.noMatchingPoints}
        </Text>
      ) : (
        <Stack gap="sm">{shown.map((p) => pointRow(p, guide))}</Stack>
      )}
    </>
  )
}

/** A recommended point not added yet, as a tile like an ask: where it shows and what it does, then Add. */
function recommendationTile(p: WiredPoint) {
  const s = t()
  const text = s.recommendedPoints[p.id]
  return (
    <Box border="neutral" radius="md" paddingX="md" paddingY="sm" gap="sm">
      <Row gap="sm" align="center">
        <Badge tone={p.kind === 'ask' ? 'accent' : 'neutral'}>{s.pointKind(p.kind)}</Badge>
        <Text size="sm" weight="semibold">
          {text?.title ?? p.when}
        </Text>
      </Row>
      {text !== undefined && <Text size="sm">{text.description}</Text>}
      <Row gap="xs" align="center">
        <Button size="sm" variant="solid" tone="accent" icon="add" tooltip={s.addRecommendedTip} onPress={() => addRecommended(p)}>
          {s.addRecommended}
        </Button>
      </Row>
    </Box>
  )
}

/**
 * The recommended points not recorded yet (src/recommended.ts), after Wired points, where an added one goes. The
 * settings can hide this section; a point already added keeps working and stays under Wired points.
 */
function recommendedSection(points: WiredPoint[]) {
  const s = t()
  const pending = RECOMMENDED.filter((r) => !points.some((p) => p.id === r.id))
  return notedSection(
    s.recommendations(pending.length),
    s.recommendationsNote,
    read(recommendedOpen),
    (open) => set(recommendedOpen, open),
    <>
      {pending.length === 0 ? (
        <Text muted size="sm">
          {s.noRecommendations}
        </Text>
      ) : (
        <Stack gap="sm">{pending.map(recommendationTile)}</Stack>
      )}
      <Text muted size="xs">
        {s.moreRecommendations}
        <Link href={DISCUSSIONS_URL}>{s.recommendedDiscussions}</Link>
      </Text>
    </>
  )
}

/** Waits on a person who has not sent anything yet: it sends them to Add a point under Wired points. */
function setupCard() {
  const s = t()
  return (
    <Card title={s.setup} description={s.setupDescription}>
      <Stack gap="sm">
        <Text size="sm">{s.setupBody}</Text>
        <Row gap="xs" align="center">
          <Button size="sm" variant="outline" icon="check" onPress={finishSetup} tooltip={s.setupDoneTip}>
            {s.resolve}
          </Button>
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
            {data.setupPending && setupCard()}
            {byProject(data.waiting).map(projectGroup)}
          </Stack>
        )}
      </Collapsible>
      <Separator />
      {messagesSection(data)}
      <Separator />
      {pointsSection(data.points, data.setup.guide, data.showPointSearch)}
      {data.showRecommendations && <Separator />}
      {data.showRecommendations && recommendedSection(data.points)}
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

// The panel's strings. "auto" follows Orca's interface language (env.locale).
import type { Language } from './config'
import type { WiredPoint } from './protocol'
import { ASK_QUESTION } from './recommended'

/** What a recommended point (src/recommended.ts) is called and does, and its record as the panel shows it. */
export interface RecommendedText {
  title: string
  description: string
  when: string
  key: string
  wiredIn: string
}

const en = {
  waiting: (n: number) => `Waiting on you (${n})`,
  noneWaiting: 'Nothing is waiting on you',
  project: (repo: string, n: number) => `${repo} (${n})`,
  noProject: 'No project',
  goTo: 'Go to agent',
  goToTip: 'Switch to the terminal of the agent that asked',
  resolve: 'Mark handled',
  resolveTip: 'Move the workspace back and clear its comment',
  resolveResumedTip: 'Take it off this list; the agent already went on',
  /** before the time of an ask kept until handled that the agent resolved */
  resumed: 'Agent resumed',
  noReason: '(no reason given)',
  noTerminal: 'This workspace has no open terminal; open it from the sidebar',
  /** n: the unread ones */
  messages: (n: number) => `Messages (${n})`,
  lastDays: (d: number) => `Last ${d} days`,
  messagesTabs: 'Messages',
  unreadTab: (n: number) => `Unread (${n})`,
  readTab: (n: number) => `Read (${n})`,
  noUnread: 'No unread messages',
  noRead: 'Nothing read yet',
  markRead: 'Mark read',
  markAllRead: 'Mark all read',
  showMore: (n: number) => `Show more (${n} more)`,
  openLink: 'Open link',
  openLinkFailed: (e: string) => `Could not open the link: ${e}`,
  points: (n: number) => `Wired points (${n})`,
  pointsDescription: 'Where your workflow sends here',
  noPoints: 'No points recorded yet. Add a point has an agent wire one; to go through your whole workflow, use the setup prompt in the Log file setting.',
  pointKind: (kind: 'ask' | 'notify') => (kind === 'ask' ? 'Waiting on you' : 'Message'),
  pointDetail: (key: string, wiredIn: string) => `key ${key} · ${wiredIn}`,
  addPoint: 'Add a point',
  addPointTip: 'Start your default agent in the selected workspace to wire a new point and record it',
  editPoint: 'Edit',
  editPointTip: 'Start your default agent in the selected workspace: it asks you what to change in this point, then changes its call and its record',
  removePoint: 'Remove',
  removePointTip: 'Start your default agent in the selected workspace to take this point out of your workflow and its record',
  alignPoints: 'Align',
  alignPointsTip: 'Start your default agent in the selected workspace to check the records against the calls in your workflow; it changes only the records, once you agree',
  noWorkspace: 'Select a workspace in Orca first; the agent starts there',
  recommendations: (n: number) => `Recommended points (${n})`,
  recommendationsNote: 'Picked from what people wire',
  /** by id; the record keeps the English of src/recommended.ts */
  recommendedPoints: {
    [ASK_QUESTION]: {
      title: 'Agent questions wait on you',
      description:
        'When an agent asks you with AskUserQuestion, its workspace shows under Waiting on you with the question, and goes once you answer. For Claude Code in Orca terminals on this computer; not yet on SSH or in WSL.',
      when: 'An agent asks you with AskUserQuestion; it goes once you answer',
      key: '<ticket or folder>',
      wiredIn: 'the Agent Inbox plugin'
    }
  } as Record<string, RecommendedText>,
  addRecommended: 'Add this point',
  addRecommendedTip: 'Wire it in and record it under Wired points; Remove there stops it',
  removeRecommendedTip: 'Stop this point and take it off the list; it shows under Recommended points again',
  noRecommendations: 'You have added every recommended point.',
  /** the link follows it */
  moreRecommendations: 'See the points others wire, and share yours: ',
  recommendedDiscussions: 'GitHub Discussions',
  addPointPrompt: (guide: string) =>
    `Read ${guide} and add one Agent Inbox point to my workflow: ask me what should send, wire it where it belongs, and record it with agent-inbox point add.`,
  editPointPrompt: (guide: string, p: WiredPoint) =>
    `Read ${guide} and change the Agent Inbox point ${p.id} (${p.kind}, key ${p.key}; ${p.when}; wired in ${p.wiredIn}): find its call in my workflow, show it to me and ask me how to change it, such as when it sends, its key, its message or where it is wired. Then change the call and record it again with agent-inbox point add ${p.id}.`,
  removePointPrompt: (guide: string, p: WiredPoint) =>
    `Read ${guide} and remove the Agent Inbox point ${p.id} (${p.when}; wired in ${p.wiredIn}): take its call out of my workflow and run agent-inbox point remove ${p.id}.`,
  alignPointsPrompt: (guide: string) =>
    `Read ${guide} and align my Agent Inbox points: compare the recorded points with the agent-inbox calls in my workflow, show me the differences and the point add and point remove commands that fix the records, and run them once I agree. Change no workflow files.`,
  refresh: 'Refresh',
  loading: 'Loading',
  loadFailed: (e: string) => `Could not load: ${e}`,
  actionFailed: 'That did not work',
  problem: 'Something needs fixing',
  setup: 'Set up Agent Inbox',
  setupDescription: 'How agents and scripts send to this panel',
  setupDoneTip: 'Hide this task for good; Add a point stays under Wired points',
  setupBody:
    'Open Wired points below and press Add a point: your agent asks what should send here, wires it into your workflow and records it. Recommended points, under it, wire in with one press.',
  starAsk: 'Find Agent Inbox useful?',
  star: 'Star on GitHub',
  starTip: 'Star felix-lj-ct/orca-agent-inbox with your GitHub account, through your gh CLI',
  starred: 'Starred on GitHub. Thank you!',
  starNeedsGh: 'Starring from here needs the gh CLI, signed in (gh auth login). Or',
  starOnPage: 'star it on the page'
}

type Strings = typeof en

const zhCN: Strings = {
  waiting: (n) => `等你处理（${n}）`,
  noneWaiting: '没有在等你的事',
  project: (repo, n) => `${repo}（${n}）`,
  noProject: '无项目',
  goTo: '去处理',
  goToTip: '切到提出这件事的 agent 终端',
  resolve: '标记已处理',
  resolveTip: '把工作区移回去并清掉备注',
  resolveResumedTip: '从列表里移除；agent 已经继续了',
  resumed: 'agent 已继续',
  noReason: '（没有写原因）',
  noTerminal: '这个工作区没有打开的终端，请从侧边栏打开它',
  messages: (n) => `消息（${n}）`,
  lastDays: (d) => `近 ${d} 天`,
  messagesTabs: '消息',
  unreadTab: (n) => `未读（${n}）`,
  readTab: (n) => `已读（${n}）`,
  noUnread: '没有未读消息',
  noRead: '还没有已读消息',
  markRead: '标为已读',
  markAllRead: '全部标为已读',
  showMore: (n) => `显示更多（还有 ${n} 条）`,
  openLink: '打开链接',
  openLinkFailed: (e) => `打不开链接：${e}`,
  points: (n) => `接入点（${n}）`,
  pointsDescription: '工作流里会写入这里的位置',
  noPoints: '还没有登记接入点。点「新增」让 agent 接入一处；想梳理整个工作流，用设置页「Log file」说明里的提示词。',
  pointKind: (kind) => (kind === 'ask' ? '等你处理' : '消息'),
  pointDetail: (key, wiredIn) => `key：${key} · ${wiredIn}`,
  addPoint: '新增',
  addPointTip: '在当前选中的工作区打开默认 agent，接入一个新的点并登记',
  editPoint: '修改',
  editPointTip: '在当前选中的工作区打开默认 agent：先问你这个点要怎么调整，再改它的调用和登记',
  removePoint: '移除',
  removePointTip: '在当前选中的工作区打开默认 agent，把这个点从工作流和登记表里去掉',
  alignPoints: '对齐',
  alignPointsTip: '在当前选中的工作区打开默认 agent，把登记表和工作流里的实际调用逐个对照；只改登记表，并且要你确认',
  noWorkspace: '先在 Orca 里选中一个工作区，agent 会在那里打开',
  recommendations: (n) => `推荐接入点（${n}）`,
  recommendationsNote: '从大家的接入里挑选',
  recommendedPoints: {
    [ASK_QUESTION]: {
      title: 'agent 提问时等你处理',
      description:
        'agent 用 AskUserQuestion 向你提问时，它的工作区带着问题出现在「等你处理」，你回答后自动移走。适用于本机 Orca 终端里的 Claude Code；SSH 和 WSL 暂不支持。',
      when: 'agent 用 AskUserQuestion 向你提问；回答后自动移走',
      key: '<ticket 或目录名>',
      wiredIn: 'Agent Inbox 插件'
    }
  },
  addRecommended: '接入',
  addRecommendedTip: '接入并登记到「接入点」；在那里点「移除」就停止',
  removeRecommendedTip: '停止这个接入点并从列表移除；它会回到「推荐接入点」',
  noRecommendations: '推荐的接入点都已接入。',
  moreRecommendations: '看大家接了哪些点，分享你的：',
  recommendedDiscussions: 'GitHub 讨论区',
  addPointPrompt: (guide) => `读 ${guide}，给我的工作流新增一个 Agent Inbox 接入点：先问我在什么场景发，接到它该在的位置，再用 agent-inbox point add 登记。`,
  editPointPrompt: (guide, p) =>
    `读 ${guide}，修改 Agent Inbox 接入点 ${p.id}（${p.kind}，key ${p.key}；${p.when}；接在 ${p.wiredIn}）：先在我的工作流里找到它的调用给我看，问我要怎么调整，比如什么时候发、key、消息内容或接入位置；再改调用，并用 agent-inbox point add ${p.id} 重新登记。`,
  removePointPrompt: (guide, p) =>
    `读 ${guide}，移除 Agent Inbox 接入点 ${p.id}（${p.when}；接在 ${p.wiredIn}）：把它的调用从我的工作流里去掉，再运行 agent-inbox point remove ${p.id}。`,
  alignPointsPrompt: (guide) =>
    `读 ${guide}，对齐 Agent Inbox 接入点：把登记的接入点和工作流里实际的 agent-inbox 调用逐个对照，列出差异和修正登记要运行的 point add / point remove，我确认后再执行。不要改工作流文件。`,
  refresh: '刷新',
  loading: '读取中',
  loadFailed: (e) => `读取失败：${e}`,
  actionFailed: '操作失败',
  problem: '有需要处理的问题',
  setup: '接入 Agent Inbox',
  setupDescription: 'agent 和脚本怎么把消息发到这里',
  setupDoneTip: '不再显示这个待办；之后随时可以在「接入点」里新增',
  setupBody: '点开下方「接入点」，点「新增」：agent 会先问你在什么场景发，再接进工作流并登记。它下面的「推荐接入点」点一下就能接入。',
  starAsk: '觉得 Agent Inbox 好用？',
  star: '在 GitHub 点 Star',
  starTip: '用你的 GitHub 账号，通过本机的 gh 命令给 felix-lj-ct/orca-agent-inbox 点 Star',
  starred: '已在 GitHub 点 Star，谢谢支持！',
  starNeedsGh: '在这里直接点 Star 需要已登录的 gh 命令（gh auth login）；也可以',
  starOnPage: '去页面点 Star'
}

export function strings(language: Language, orcaLocale: string): Strings {
  const resolved = language === 'auto' ? (orcaLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en') : language
  return resolved === 'zh-CN' ? zhCN : en
}

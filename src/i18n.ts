// The panel's strings. "auto" follows Orca's interface language (env.locale).
import type { Language } from './config'

const en = {
  waiting: 'Waiting on you',
  noneWaiting: 'Nothing is waiting on you',
  askedAt: 'Asked',
  goTo: 'Go to agent',
  goToTip: 'Switch to the terminal of the agent that asked',
  resolve: 'Mark handled',
  resolveTip: 'Move the workspace back and clear its comment',
  noReason: '(no reason given)',
  noTerminal: 'This workspace has no open terminal; open it from the sidebar',
  messages: (n: number) => `Messages (${n})`,
  lastDays: (d: number) => `Last ${d} days`,
  noMessages: 'No messages',
  hide: 'Hide',
  openLink: 'Open link',
  refresh: 'Refresh',
  loading: 'Loading',
  loadFailed: (e: string) => `Could not load: ${e}`,
  actionFailed: 'That did not work',
  problem: 'Something needs fixing',
  setup: 'Set up',
  setupDescription: 'How agents and scripts send to this panel',
  setupBody:
    'Agents and scripts call the CLI below. To decide where your workflow should ask you or tell you something, give your agent this prompt:',
  setupPrompt: (guide: string) => `Read ${guide} and help me add Agent Inbox messages to my workflow.`,
  cli: 'CLI',
  guide: 'Agent guide',
  log: 'Log'
}

type Strings = typeof en

const zhCN: Strings = {
  waiting: '等你处理',
  noneWaiting: '没有在等你的事',
  askedAt: '提出于',
  goTo: '去处理',
  goToTip: '切到提出这件事的 agent 终端',
  resolve: '标记已处理',
  resolveTip: '把工作区移回去并清掉备注',
  noReason: '（没有写原因）',
  noTerminal: '这个工作区没有打开的终端，请从侧边栏打开它',
  messages: (n) => `消息（${n}）`,
  lastDays: (d) => `近 ${d} 天`,
  noMessages: '没有新消息',
  hide: '不再显示',
  openLink: '打开链接',
  refresh: '刷新',
  loading: '读取中',
  loadFailed: (e) => `读取失败：${e}`,
  actionFailed: '操作失败',
  problem: '有需要处理的问题',
  setup: '接入',
  setupDescription: 'agent 和脚本怎么把消息发到这里',
  setupBody: 'agent 和脚本调用下面的 CLI。想梳理工作流里哪些节点该提醒你，把这句话发给你的 agent：',
  setupPrompt: (guide) => `读 ${guide}，帮我在工作流里接入 Agent Inbox 消息。`,
  cli: 'CLI',
  guide: 'Agent 指南',
  log: '日志'
}

export function strings(language: Language, orcaLocale: string): Strings {
  const resolved = language === 'auto' ? (orcaLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en') : language
  return resolved === 'zh-CN' ? zhCN : en
}

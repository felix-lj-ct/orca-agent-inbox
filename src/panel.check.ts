// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host. The worker reads
// the real board and the log at the default path, so these show the live state: once fresh, once in Chinese.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  live: {},
  chinese: { settings: { language: 'zh-CN' } }
})

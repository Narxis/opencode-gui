// Apparence persistante ; « claude » suit le mode clair/sombre du système.
export const themes = { claude: 'Claude (système)', 'claude-light': 'Claude clair', 'claude-dark': 'Claude sombre', oled: 'OLED (noir pur)', nord: 'Nord' }
const dark = matchMedia('(prefers-color-scheme: dark)')
export const saved = () => localStorage.getItem('theme') ?? 'claude'
export function apply(t = saved()) {
  localStorage.setItem('theme', t)
  document.documentElement.dataset.theme = t === 'claude' ? (dark.matches ? 'claude-dark' : 'claude-light') : t
}
dark.onchange = () => apply()

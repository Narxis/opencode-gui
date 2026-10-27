// Lance l'app sous xvfb et joue des étapes : xvfb-run -a node drive.mjs "type salut" "press Enter" "wait 5" "ss 02"
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const dir = new URL('../../..', import.meta.url).pathname
const req = createRequire(dir)
const { _electron } = req('playwright') // préinstallé en cloud (NODE_PATH)
const shots = process.env.SCREENSHOT_DIR || '/tmp/shots'
mkdirSync(shots, { recursive: true })
const app = await _electron.launch({ executablePath: req('electron'), args: ['--no-sandbox', dir], timeout: 30000 })
const w = await app.firstWindow()
const log = (d) => String(d).split('\n').filter((l) => l && !l.includes('dbus')).forEach((l) => console.log('[main] ' + l))
app.process().stdout.on('data', log)
app.process().stderr.on('data', log)
await w.waitForTimeout(5000)
const steps = { // ss [nom] | type <texte> | press <touche> | click <css> | wait <s> | text | eval <js>
  ss: (a) => w.screenshot({ path: `${shots}/${a || Date.now()}.png` }).then(() => console.log(`ss: ${shots}/${a}.png`)),
  type: (a) => w.locator('textarea').fill(a),
  press: (a) => w.keyboard.press(a),
  click: (a) => w.click(a),
  wait: (a) => w.waitForTimeout(+a * 1000),
  text: () => w.evaluate(() => document.body.innerText).then(console.log),
  eval: (a) => w.evaluate(a).then((r) => console.log(JSON.stringify(r)))
}
for (const s of process.argv.slice(2).length ? process.argv.slice(2) : ['ss 01', 'text']) {
  const [c, ...r] = s.split(' ')
  await steps[c](r.join(' ')).catch((e) => console.log(`ERREUR ${s}: ${e.message}`))
}
// app.close() bloque tant que `opencode serve` tourne : on tue tout.
try { execSync('pkill -f "^opencode serve"') } catch {}
app.process().kill('SIGKILL')
process.exit(0)

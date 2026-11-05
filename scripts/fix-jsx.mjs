import fs from 'node:fs'

const file = process.argv[2]
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
const fixed = []
let count = 0

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]
  const next = lines[i + 1] ?? ''
  const trimmed = line.trim()
  if (trimmed.startsWith('{toggle(') && trimmed.endsWith(')}') && /^\s*\/>$/.test(next)) {
    // balance the toggle( call and close the wrapping <div>
    const indent = next.match(/^\s*/)[0]
    fixed.push(line.replace(/\)}$/, '))}'))
    fixed.push(`${indent}</div>`)
    i += 1
    count += 1
    continue
  }
  fixed.push(line)
}

fs.writeFileSync(file, fixed.join('\n'), 'utf8')
console.log(`fixed ${count} blocks in ${file}`)

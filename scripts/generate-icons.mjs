/**
 * Generates the MMZ Torrent icon set from a single SVG source.
 *
 * Outputs:
 *   resources/icons/icon.svg      (source of truth)
 *   resources/icons/icon.png      (512x512, app icon / electron-builder input)
 *   resources/icons/tray.png      (64x64, system tray)
 *   src/renderer/public/icon.png  (512x512, renderer favicon)
 *
 * Run with:  npm run icons
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'resources', 'icons')
const publicDir = path.join(root, 'src', 'renderer', 'public')

/** Original identity: rounded square + downward arrow over a shelf. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <path d="M256 108v188" stroke="#ffffff" stroke-width="44" stroke-linecap="round"/>
  <path d="M164 236l92 92 92-92" fill="none" stroke="#ffffff"
        stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M140 372h232" stroke="#ffffff" stroke-width="44" stroke-linecap="round"
        opacity="0.9"/>
</svg>
`

/** Tray variant: the full mark, rendered small (readable on light + dark panels). */
const traySvg = svg

function render(source, width) {
  const resvg = new Resvg(source, { fitTo: { mode: 'width', value: width } })
  return resvg.render().asPng()
}

/**
 * Minimal ICO writer: PNG-compressed entries (supported since Windows Vista),
 * which is exactly what electron-builder's own converter produces.  We emit it
 * ourselves because that converter (`icon-tool.js`) can crash with 0xC0000005
 * on some Node/Windows combinations.
 */
function toIco(pngFrames) {
  const count = pngFrames.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = 6 + count * 16
  for (const { size, png } of pngFrames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // color count (0 = truecolor)
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...pngFrames.map((f) => f.png)])
}

function write(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, data)
  console.log(`wrote ${path.relative(root, target)} (${data.length} bytes)`)
}

fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(publicDir, { recursive: true })

write(path.join(outDir, 'icon.svg'), Buffer.from(svg, 'utf8'))
write(path.join(outDir, 'icon.png'), render(svg, 512))
write(path.join(outDir, 'tray.png'), render(traySvg, 64))
write(path.join(publicDir, 'icon.png'), render(svg, 512))

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const frames = icoSizes.map((size) => ({ size, png: render(svg, size) }))
write(path.join(outDir, 'icon.ico'), toIco(frames))

import { createServer } from 'node:http'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync, renameSync, unlinkSync, statSync, realpathSync, createReadStream, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, relative, sep, extname, isAbsolute } from 'node:path'
import { apply, result, setup, view } from './play.js'

const gameID = 'skullzfyre'
const bodyLimit = 8192
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.webp':'image/webp',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.woff2':'font/woff2', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav',
}
const hash = (value) => createHash('sha256').update(value).digest('hex')
const equal = (value, expected) => typeof value === 'string' &&
  timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(hash(expected), 'hex'))
const token = (size = 32) => randomBytes(size).toString('hex')
const normalizeName = (value) => typeof value === 'string'
  ? [...value.normalize('NFC').replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/\s+/gu, ' ').trim()].slice(0, 40).join('')
  : ''
const fold = (value) => value.toLocaleLowerCase('ru')
const fail = (status, message) => Object.assign(new Error(message), { status })
const publicPlayers = ({ players }) => players.map(({ id, name }) => name ? { id, name } : { id })

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' })
  res.end(JSON.stringify(value))
}

async function parseBody(req) {
  if (Number(req.headers['content-length']) > bodyLimit) {
    req.resume()
    throw fail(413, 'Запрос слишком большой')
  }
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume()
    throw fail(415, 'Требуется JSON')
  }
  let size = 0
  const chunks = []
  for await (const chunk of req.iterator({ destroyOnReturn:false })) {
    size += chunk.length
    if (size > bodyLimit) {
      req.resume()
      throw fail(413, 'Запрос слишком большой')
    }
    chunks.push(chunk)
  }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw fail(400, 'Некорректный JSON')
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw fail(400, 'Требуется объект JSON')
  return value
}

function credentials(req, match) {
  const matchKey = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')
  if (!matchKey) return null
  const digest = Buffer.from(hash(matchKey[1]), 'hex')
  return match.players.find(({ keyHash }) => keyHash && timingSafeEqual(digest, Buffer.from(keyHash, 'hex')))?.id ?? null
}

function renamePlayer(game, seat, name) {
  game.players[seat].name = name
  if (game.pending?.base) {
    const base = JSON.parse(game.pending.base)
    base.players[seat].name = name
    game.pending.base = JSON.stringify(base)
  }
}

function defaultClientDir() {
  const dist = fileURLToPath(new URL('./dist/', import.meta.url))
  const client = resolve(dist, 'client')
  return existsSync(client) ? client : dist
}

export function createGameServer({
  dir = process.env.MATCHES_DIR || resolve('data/matches'),
  dist = defaultClientDir(),
  secret = process.env.PLATFORM_SECRET,
  publicURL = process.env.PUBLIC_URL,
} = {}) {
  const corsOrigin = publicURL ? new URL(publicURL).origin : null
  mkdirSync(dir, { recursive:true })
  const subscriptions = new Map()
  const file = (id) => resolve(dir, id + '.json')
  const load = (id) => {
    try { return JSON.parse(readFileSync(file(id), 'utf8')) } catch (issue) {
      if (issue.code === 'ENOENT') return null
      throw issue
    }
  }
  const publish = (match) => {
    for (const stream of subscriptions.get(match.id) || []) {
      if (stream.writableLength > 16384) {
        stream.destroy()
        continue
      }
      stream.write('event: revision\ndata: ' + JSON.stringify({ revision:match.revision }) + '\n\n')
    }
  }
  function persist(match) {
    const tmp = file(match.id) + '.' + token(8) + '.tmp'
    const fd = openSync(tmp, 'wx', 0o600)
    try {
      try {
        writeFileSync(fd, JSON.stringify(match))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, file(match.id))
    } catch (issue) {
      try { unlinkSync(tmp) } catch {}
      throw issue
    }
    publish(match)
  }

  function subscribe(res, match) {
    let streams = subscriptions.get(match.id)
    if (!streams) subscriptions.set(match.id, streams = new Set())
    if (streams.size >= 64) return send(res, 429, { error:'Слишком много подключений к комнате' })
    res.writeHead(200, {
      'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-store, no-transform',
      'X-Accel-Buffering':'no',
    })
    res.write('retry: 2000\nevent: revision\ndata: ' + JSON.stringify({ revision:match.revision }) + '\n\n')
    streams.add(res)
    const heartbeat = setInterval(() => {
      if (res.writableLength > 16384) res.destroy()
      else res.write(': heartbeat\n\n')
    }, 20000)
    res.on('close', () => {
      clearInterval(heartbeat)
      streams.delete(res)
      if (!streams.size && subscriptions.get(match.id) === streams) subscriptions.delete(match.id)
    })
  }

  function staticFile(req, res, path) {
    const isIndex = path === '/'
    let asset
    let size
    try {
      const root = realpathSync(dist)
      const location = decodeURIComponent(isIndex ? '/index.html' : path).slice(1)
      if (location.split(/[\\/]/).some((part) => part.startsWith('.'))) return false
      asset = realpathSync(resolve(root, location))
      const remainder = relative(root, asset)
      if (remainder.startsWith('..' + sep) || remainder === '..' || isAbsolute(remainder)) return false
      const stat = statSync(asset)
      if (!stat.isFile()) return false
      size = stat.size
    } catch (issue) {
      if (!isIndex || issue.code !== 'ENOENT') return false
      res.writeHead(200, { 'Content-Type':'text/plain; charset=utf-8' })
      res.end(req.method === 'HEAD' ? undefined : 'Skullzfyre\n')
      return true
    }
    res.writeHead(200, {
      'Content-Type':mime[extname(asset)] || 'application/octet-stream',
      'Content-Length':size,
      'Cache-Control':isIndex ? 'no-cache' : 'public, max-age=3600',
    })
    if (req.method === 'HEAD') res.end()
    else createReadStream(asset).on('error', () => res.destroy()).pipe(res)
    return true
  }

  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const method = req.method
    try {
      let path
      try { path = new URL(req.url, 'http://localhost').pathname } catch {
        throw fail(400, 'Некорректный адрес запроса')
      }
      if (req.headers.origin && corsOrigin && req.headers.origin === corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin)
        res.setHeader('Vary', 'Origin')
        if (method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Methods':'GET, POST, DELETE',
            'Access-Control-Allow-Headers':'Content-Type, Authorization',
          })
          return res.end()
        }
      }
      if (method === 'GET' && path === '/health') return send(res, 200, { ok:true })
      if (method === 'POST' && path === '/games/' + gameID + '/create') {
        const { numPlayers } = await parseBody(req)
        if (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 6) throw fail(400, 'Нужно от двух до шести магов')
        let id
        do { id = token(8) } while (load(id))
        persist({ id, revision:0, game:null, players:Array.from({ length:numPlayers }, (_, id) => ({ id })) })
        return send(res, 200, { matchID:id })
      }
      const metadata = /^\/games\/skullzfyre\/([a-f0-9]{16})$/.exec(path)
      const platform = /^\/platform\/matches\/([a-f0-9]{16})(\/leave)?$/.exec(path)
      const api = /^\/api\/([a-f0-9]{16})\/(view|seat|leave|start|action|undo|events)$/.exec(path)
      if (metadata && method === 'GET') {
        const match = load(metadata[1])
        if (!match) throw fail(404, 'Комната не найдена')
        return send(res, 200, { matchID:match.id, players:publicPlayers(match), gameover:match.game ? result(match.game) : null })
      }
      if (platform) {
        if (!secret) throw fail(404, 'Маршрут не найден')
        if (!equal(req.headers['x-platform-secret'], secret)) throw fail(403, 'Доступ запрещён')
        if (!platform[2] && method === 'DELETE') {
          const id = platform[1]
          try { unlinkSync(file(id)) } catch (issue) {
            if (issue.code === 'ENOENT') throw fail(404, 'Комната не найдена')
            throw issue
          }
          for (const stream of subscriptions.get(id) || []) stream.end()
          subscriptions.delete(id)
          return send(res, 200, { ok:true })
        }
        if (platform[2] && method === 'POST') {
          const { playerName } = await parseBody(req)
          const match = load(platform[1])
          if (!match) throw fail(404, 'Комната не найдена')
          const name = normalizeName(playerName)
          if (!name) throw fail(400, 'Укажите имя игрока')
          const player = match.players.find((p) => p.name && fold(p.name) === fold(name))
          if (player) {
            match.players[player.id] = { id:player.id }
            ++match.revision
            persist(match)
          }
          return send(res, 200, { left:player ? 1 : 0 })
        }
      }
      if (api) {
        const [, id, endpoint] = api
        const read = endpoint === 'view' || endpoint === 'events'
        if ((read && method !== 'GET') || (!read && method !== 'POST')) throw fail(405, 'Метод не поддерживается')
        const body = read ? null : await parseBody(req)
        const match = load(id)
        if (!match) throw fail(404, 'Комната не найдена')
        const seat = credentials(req, match)
        if (endpoint === 'events') return subscribe(res, match)
        if (endpoint === 'view') return send(res, 200, {
          players:publicPlayers(match), seat, revision:match.revision, game:match.game ? view(match.game, seat) : null,
          canUndo:seat !== null && Boolean(match.previousGame) && !result(match.game),
        })
        if (endpoint === 'seat') {
          const { seat:requestedSeat } = body
          const name = normalizeName(body.name)
          if (!Number.isInteger(requestedSeat) || !match.players[requestedSeat] || !name) throw fail(400, 'Укажите место и имя')
          if (seat !== null || match.players[requestedSeat].name) throw fail(409, 'Место уже занято')
          if (match.players.some((p) => p.name && fold(p.name) === fold(name))) throw fail(409, 'Это имя уже занято')
          const key = token()
          match.players[requestedSeat] = { id:requestedSeat, name, keyHash:hash(key) }
          if (match.game) renamePlayer(match.game, requestedSeat, name)
          if (match.previousGame) renamePlayer(match.previousGame, requestedSeat, name)
          ++match.revision
          persist(match)
          return send(res, 200, { key, revision:match.revision })
        }
        if (seat === null) throw fail(403, 'Сначала займите место')
        if (endpoint === 'leave') {
          match.players[seat] = { id:seat }
        } else if (endpoint === 'start') {
          if (seat !== 0) throw fail(403, 'Начать партию может хозяин')
          if (match.game) throw fail(409, 'Партия уже началась')
          if (match.players.some((player) => !player.name)) throw fail(409, 'Дождитесь всех игроков')
          match.game = setup(match.players.map(({ name }) => name), token())
        } else {
          if (!Number.isSafeInteger(body.revision) || body.revision !== match.revision) throw fail(409, 'Комната обновилась. Повторите ход.')
          if (!match.game) throw fail(409, 'Партия ещё не началась')
          if (endpoint === 'undo') {
            if (!match.previousGame || result(match.game)) throw fail(409, 'Нет действия для отмены')
            match.game = match.previousGame
            delete match.previousGame
            const note = match.players[seat].name + ' отменяет последнее действие.'
            match.game.log.push(note)
            if (match.game.pending?.base) {
              const base = JSON.parse(match.game.pending.base)
              base.log.push(note)
              match.game.pending.base = JSON.stringify(base)
            }
          } else {
            const before = match.game
            try { match.game = apply(before, body.action, seat) } catch (issue) {
              throw fail(400, issue.message)
            }
            match.previousGame = before
          }
        }
        ++match.revision
        persist(match)
        return send(res, 200, { revision:match.revision })
      }
      if ((method === 'GET' || method === 'HEAD') && staticFile(req, res, path)) return
      throw fail(404, 'Маршрут не найден')
    } catch (issue) {
      if (res.headersSent || res.destroyed) return
      if (!issue.status) console.error(issue)
      send(res, issue.status || 500, { error:issue.status ? issue.message : 'Ошибка сервера' })
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001)
  createGameServer().listen(port, '0.0.0.0', () => console.log('Skullzfyre listening on port ' + port))
}

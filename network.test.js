import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { createGameServer } from './server.js'

test('HTTP room persists across restart and keeps credentials and hands private', async (t) => {
  const temp = await mkdtemp(resolve(tmpdir(), 'skullzfyre-network-'))
  const dir = resolve(temp, 'matches')
  const dist = resolve(temp, 'dist')
  const secret = 'test-secret'
  await mkdir(dist)
  await writeFile(resolve(dist, 'index.html'), '<html>Skullzfyre</html>')
  let server, origin
  const stop = async () => {
    const stopped = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await stopped
  }
  t.after(async () => {
    if (server?.listening) await stop()
    await rm(temp, { recursive:true, force:true })
  })
  const start = async () => {
    server = createGameServer({ dir, dist, secret })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    origin = 'http://127.0.0.1:' + server.address().port
  }
  await start()
  async function request(path, { method, body, key, platformSecret } = {}) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (key) headers.Authorization = 'Bearer ' + key
    if (platformSecret) headers['X-Platform-Secret'] = platformSecret
    const response = await fetch(origin + path, { method:method || (body === undefined ? 'GET' : 'POST'), headers, body:JSON.stringify(body) })
    return { status:response.status, data:await response.json() }
  }
  assert.equal((await fetch(origin + '/')).status, 200)
  assert.equal((await request('/health')).data.ok, true)
  assert.equal((await fetch(origin + '/%2e%2e%2fmatches/test.json')).status, 404)
  const create = '/games/skullzfyre/create'
  assert.equal((await request(create, { body:{ numPlayers:7 } })).status, 400)
  assert.equal((await request(create, { body:{ numPlayers:2, junk:'a'.repeat(8192) } })).status, 413)
  const { data:{ matchID } } = await request(create, { body:{ numPlayers:2 } })
  const api = '/api/' + matchID
  const metadata = '/games/skullzfyre/' + matchID
  const platform = '/platform/matches/' + matchID
  assert.deepEqual((await request(metadata)).data, { matchID, players:[{ id:0 }, { id:1 }], gameover:null })

  const events = await fetch(origin + api + '/events')
  const stream = events.body.getReader()
  const decoder = new TextDecoder()
  async function revision(expected) {
    const frame = decoder.decode((await stream.read()).value)
    assert.match(frame, /event: revision\n/)
    const line = frame.split('\n').find((entry) => entry.startsWith('data: '))
    assert.deepEqual(JSON.parse(line.slice(6)), { revision:expected })
  }
  assert.equal(events.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  await revision(0)
  const races = await Promise.all(['< Dим >', 'Dим'].map((name) => request(api + '/seat', { body:{ seat:0, name } })))
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409])
  const host = races.find((r) => r.status === 200).data.key
  await revision(1)
  assert.equal((await request(api + '/start', { key:host, body:{} })).status, 409)
  const { data:{ key:guest } } = await request(api + '/seat', { body:{ seat:1, name:'Лоскут' } })
  await revision(2)
  assert.equal((await request(api + '/start', { key:guest, body:{} })).status, 403)
  assert.equal((await request(api + '/start', { key:host, body:{} })).status, 200)
  await revision(3)
  await stream.cancel()

  const watcher = (await request(api + '/view')).data
  const hostView = (await request(api + '/view', { key:host })).data
  const guestView = (await request(api + '/view', { key:guest })).data
  assert.equal(watcher.seat, null)
  assert.deepEqual(watcher.game.hand, [])
  assert.equal(watcher.game.me, null)
  assert.equal(hostView.seat, 0)
  assert.equal(guestView.seat, 1)
  assert.equal(guestView.game.hand.length, 8)
  assert.equal(hostView.game.hand.length, 8)
  assert.notDeepEqual(hostView.game.hand, guestView.game.hand)
  assert.deepEqual(watcher.players, [{ id:0, name:'Dим' }, { id:1, name:'Лоскут' }])

  // Simultaneous copies of one request can commit at most one action.
  const card = hostView.game.hand[0]
  const body = {
    action:{ type:'commit', cards:[card.uid], slots:{ [card.uid]:'source' } },
    revision:hostView.revision,
  }
  assert.equal((await request(api + '/action', { body })).status, 403)
  const submissions = await Promise.all([0, 1].map(() => request(api + '/action', { key:host, body })))
  assert.deepEqual(submissions.map((r) => r.status).sort(), [200, 409])
  const before = (await request(api + '/view', { key:host })).data
  assert.equal(before.revision, 4)
  assert.equal(before.game.hand.length, 7)
  assert.equal(before.canUndo, true)
  assert.equal((await request(api + '/view')).data.canUndo, false)
  const disk = await readFile(resolve(dir, matchID + '.json'), 'utf8')
  assert.ok(!disk.includes(host) && !disk.includes(guest))

  await stop()
  await start()
  assert.deepEqual((await request(api + '/view', { key:host })).data, before)
  const undo = { revision:before.revision }
  assert.equal((await request(api + '/undo', { body:undo })).status, 403)
  assert.equal((await request(api + '/undo', { key:host, body:{ revision:3 } })).status, 409)
  assert.equal((await request(api + '/undo', { key:host, body:undo })).status, 200)
  const undone = (await request(api + '/view', { key:host })).data
  assert.equal(undone.revision, 5)
  assert.equal(undone.canUndo, false)
  assert.deepEqual(undone.game.hand, hostView.game.hand)
  assert.match((await request(api + '/view')).data.game.log[0], /отменяет последнее действие/)
  assert.equal((await request(api + '/undo', { key:host, body:{ revision:5 } })).status, 409)
  assert.equal((await request(platform + '/leave', { body:{ playerName:'лоскут' } })).status, 403)
  assert.deepEqual((await request(platform + '/leave', { platformSecret:secret, body:{ playerName:'лоскут' } })).data, { left:1 })
  const revoked = (await request(api + '/view', { key:guest })).data
  assert.equal(revoked.seat, null)
  assert.deepEqual(revoked.game.hand, [])
  const { data:{ key:replacement } } = await request(api + '/seat', { body:{ seat:1, name:'Новый маг' } })
  assert.notEqual(replacement, guest)
  const restored = (await request(api + '/view', { key:replacement })).data
  assert.equal(restored.seat, 1)
  assert.equal(restored.game.players[1].name, 'Новый маг')
  assert.equal((await request(api + '/leave', { body:{} })).status, 403)
  assert.equal((await request(api + '/leave', { key:replacement, body:{} })).status, 200)
  assert.equal((await request(api + '/view', { key:replacement })).data.seat, null)
  assert.deepEqual((await request(metadata)).data.players[1], { id:1 })

  const live = (await fetch(origin + api + '/events')).body.getReader()
  assert.equal((await live.read()).done, false)
  assert.deepEqual((await request(platform, { method:'DELETE', platformSecret:secret })).data, { ok:true })
  assert.equal((await live.read()).done, true)
  assert.equal((await request(metadata)).status, 404)
  assert.deepEqual(await readdir(dir), [])
})

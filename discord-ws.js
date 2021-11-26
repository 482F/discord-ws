#!/usr/bin/env node

async function setState(user, info) {
  const stateName = `d-${user.name}`
  let color = '#000000'
  let joinedBody = ''
  let body = 'オフライン'
  if (user.isJoined) {
    color = '#008800'
    joinedBody = 'JOINED '
    body = 'オンライン'
  } else {
    color =
      {
        offline: '#333333',
        online: '#008800',
        idle: '#cc9900',
        dnd: '#e24f38',
      }[user.state] ?? '#000000'
  }
  body =
    user.activity ??
    {
      online: 'オンライン',
      idle: '離席中',
      dnd: '取り込み中',
    }[user.state] ??
    body
  const message = `${stateName},${color},${joinedBody}${body}`
  console.log(message)

  const { execFile } = require('child_process')
  execFile(info.stateViewerPath, ['set', message])
}

function showData(description, data) {
  if ([1, 11].includes(data.op)) {
    return
  }
  console.log(description)
  console.dir(data, { depth: null })
}

async function getScriptDirPath() {
  const fs = require('fs')
  const scriptPath = process.argv[1]
  const scriptRealPath = await new Promise((resolve, reject) =>
    fs.realpath(scriptPath, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  )
  const path = require('path')
  const scriptDirPath = path.dirname(scriptRealPath)
  return scriptDirPath
}

async function readJson(path) {
  const fs = require('fs').promises
  return JSON.parse(await fs.readFile(path))
}

async function writeJson(path, obj) {
  const fs = require('fs').promises
  await fs.writeFile(path, JSON.stringify(obj))
}

const WebSocket = require('ws')
class DiscordWebSocket {
  constructor(url, info, intents) {
    this.constructorMethod(url, info, intents)
  }
  constructorMethod(url, info, intents, isReconnect = false) {
    this.url = url
    this.ws = new WebSocket(this.url)
    this.ws.onmessage = (...args) => this.onmessage(...args)
    this.lastSequence = null
    this.intents = intents
    this.info = info
    this.watchUsers = {}
    for (const [id, name] of Object.entries(this.info.watchUsers)) {
      this.watchUsers[id] = {
        name,
        isJoined: false,
        activity: null,
        state: 'offline',
      }
    }
    this.isReconnect = isReconnect
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj))
    showData('sent', obj)
  }
  async start() {
    this.heartbeatIntervalId = null
    this.heartbeatReceived = true
    await new Promise((resolve) => (this.ws.onopen = resolve))
    if (this.isReconnect) {
      this.reconnect()
    } else {
      this.identify()
    }
  }
  reconnect() {
    const message = {
      op: 6,
      d: {
        token: this.info.token,
        session_id: this.sessionId,
        seq: this.lastSequence,
      },
    }
    this.send(message)
  }
  identify() {
    const message = {
      op: 2,
      d: { token: this.info.token, intents: this.intents, properties: {} },
    }
    this.send(message)
  }
  filterGuilds(guilds) {
    const filteredGuilds = []
    for (const guild of guilds) {
      if (!this.info.watchGuilds[guild.id]) {
        continue
      }
      filteredGuilds.push(guild)
    }
    return filteredGuilds
  }
  async guildAction(guild) {
    const message = {
      op: 14,
      d: {
        guild_id: guild.id,
        typing: true,
        threads: true,
        activities: true,
        members: [],
        channels: { [guild.system_channel_id]: [[0, 99]] },
        thread_member_lists: [],
      },
    }
    this.send(message)
    for (const vState of guild.voice_states) {
      const user = this.watchUsers[vState.user_id]
      if (!user) {
        continue
      }
      user.isJoined = Boolean(vState.channel_id)
      setState(user, this.info)
    }
  }
  onmessage(message) {
    const data = JSON.parse(message.data)

    showData('received', data)

    if (data.s) {
      this.lastSequence = data.s
    }

    if (data.op === 0) {
      this.onOpZero(data)
    } else if (data.op === 7) {
      this.onReconnect()
    } else if (data.op === 10) {
      this.sendingHeartbeat(data.d.heartbeat_interval)
    } else if (data.op === 11) {
      this.heartbeatReceived = true
    }
  }
  onOpZero(data) {
    if (data.t === 'READY') {
      this.onReady(data)
    } else if (data.t === 'PRESENCE_UPDATE') {
      this.onPresenceUpdate(data)
    } else if (data.t === 'VOICE_STATE_UPDATE') {
      this.onVoiceStateUpdate(data)
    } else if (data.t === 'GUILD_MEMBER_LIST_UPDATE') {
      this.onGuildMemberListUpdate(data)
    }
  }
  onReady(data) {
    this.sessionId = data.d.session_id
    this.filterGuilds(data.d.guilds).forEach((guild) => this.guildAction(guild))
  }
  onReconnect() {
    this.constructorMethod(this.url, this.info, this.intents, true)
  }
  onPresenceUpdate(data) {
    const user = this.watchUsers[data.d.user.id]
    if (!user) {
      return
    }

    user.state = data.d.status
    user.activity = data.d.activities?.[0]?.name
    setState(user, this.info)
  }
  onVoiceStateUpdate(data) {
    const user = this.watchUsers[data.d.user_id]
    if (!user) {
      return
    }

    user.isJoined = Boolean(data.d.channel_id)
    setState(user, this.info)
  }
  onGuildMemberListUpdate(data) {
    for (const op of data.d.ops) {
      const items = op.items ?? [op.item] ?? []
      for (const item of items) {
        const user = this.watchUsers[item?.member?.user?.id]
        if (!user) {
          continue
        }
        user.state = item.member.presence.status
        user.activity = item.member.presence.activities?.[0]?.name
        if (user.activity === 'Custom Status') {
          user.activity = item.member.presence.activities[0].state
        }
        setState(user, this.info)
      }
    }
  }
  sendHeartbeat() {
    if (!this.heartbeatReceived) {
      this.identify()
    }
    const heartbeat = { op: 1, d: this.lastSequence }
    this.send(heartbeat)
    this.heartbeatReceived = false
  }
  async sendingHeartbeat(interval) {
    clearInterval(this.heartbeatInterval)
    this.heartbeatIntervalId = setInterval(() => this.sendHeartbeat(), interval)
  }
}

;(async function () {
  const infoPath = `${await getScriptDirPath()}/info.json`
  const info = await readJson(infoPath)
  info.path = infoPath

  const url = 'wss://gateway.discord.gg/?encoding=json&v=9'

  const intents = Object.values({
    GUILD_MEMBERS: 1 << 1,
    GUILD_VOICE_STATES: 1 << 7,
  }).reduce((sum, intent) => sum | intent)

  const dws = new DiscordWebSocket(url, info, intents)
  dws.start()
})()

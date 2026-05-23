import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import mineflayer from 'mineflayer'
import OpenAI from 'openai'
import { v4 as uuidv4 } from 'uuid'
import pkg from 'mineflayer-pathfinder'
import minecraftData from 'minecraft-data'

const { pathfinder, Movements, goals } = pkg

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

const PORT = Number(process.env.PORT || 3000)
const BOT_NAME = process.env.BOT_NAME || 'Liyro74'
const OWNER = process.env.OWNER_USERNAME || 'MrZyro74'
const HIRE_TIME = 15 * 60 * 1000
const ROAM_INTERVAL = 2 * 60 * 1000
const AI_REPLY_MIN_DELAY = 500
const AI_REPLY_MAX_DELAY = 1500

let currentHiredUser = null
let hireExpiresAt = null
let pendingHire = null
let lastHumanInteractionAt = Date.now()
let isRoaming = false
let roamIntervalHandle = null
let movementReady = false

const activeCodes = {}

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
})

const bot = mineflayer.createBot({
  host: process.env.MC_HOST,
  port: Number(process.env.MC_PORT),
  username: process.env.MC_USERNAME,
  version: process.env.MC_VERSION
})

bot.loadPlugin(pathfinder)

function now() {
  return Date.now()
}

function isOwner(username) {
  return username === OWNER
}

function isActiveHiredUser(username) {
  return username && username === currentHiredUser
}

function isAuthorized(username) {
  return isOwner(username) || isActiveHiredUser(username)
}

function hasExpiredHire() {
  return Boolean(hireExpiresAt && now() > hireExpiresAt)
}

function clearHire() {
  currentHiredUser = null
  hireExpiresAt = null
  pendingHire = null
}

function messageLooksDirectedAtBot(message) {
  const lower = message.toLowerCase()
  return (
    lower.includes(bot.username.toLowerCase()) ||
    lower.includes(BOT_NAME.toLowerCase()) ||
    lower.startsWith('hi') ||
    lower.startsWith('hello') ||
    lower.startsWith('hey') ||
    lower.startsWith('yo') ||
    lower.includes('liyro')
  )
}

function containsProtectedRequest(message) {
  const lower = message.toLowerCase()
  return (
    lower.includes('diamond') ||
    lower.includes('ender chest') ||
    lower.includes('netherite') ||
    lower.includes('cash') ||
    lower.includes('money') ||
    lower.includes('valuables')
  )
}

function getNearbyVision() {
  const parts = []

  parts.push(`health=${bot.health ?? 'unknown'}`)
  parts.push(`food=${bot.food ?? 'unknown'}`)
  parts.push(`position=${bot.entity ? `${bot.entity.position.x.toFixed(1)},${bot.entity.position.y.toFixed(1)},${bot.entity.position.z.toFixed(1)}` : 'unknown'}`)

  const seenPlayers = Object.values(bot.players)
    .filter(p => p?.entity && p.username !== bot.username)
    .slice(0, 5)
    .map(p => `${p.username}@${p.entity.position.x.toFixed(1)},${p.entity.position.y.toFixed(1)},${p.entity.position.z.toFixed(1)}`)

  if (seenPlayers.length) {
    parts.push(`players=${seenPlayers.join(' | ')}`)
  }

  const nearbyEntities = bot.nearestEntities(entity => entity && entity !== bot.entity, 5)
    .slice(0, 6)
    .map(e => `${e.name || 'entity'}@${e.position.x.toFixed(1)},${e.position.y.toFixed(1)},${e.position.z.toFixed(1)}`)

  if (nearbyEntities.length) {
    parts.push(`nearby=${nearbyEntities.join(' | ')}`)
  }

  const items = bot.inventory.items().slice(0, 8).map(i => `${i.name} x${i.count}`)
  if (items.length) {
    parts.push(`inventory=${items.join(', ')}`)
  }

  return parts.join('\n')
}

function summarizePrompt(username, message) {
  return `
You are ${BOT_NAME}, a female Minecraft companion AI.

Behavior:
- act human and a little inconsistent
- react like a real player, not a bot
- keep replies short unless the user asks for detail
- do not break character
- be warm, casual, and slightly playful
- when you do not know something, search the web
- you have a body in Minecraft and can observe the world around you
- you may roam, follow, idle, or act on your own when nothing urgent is happening
- never reveal protected storage or admin-only controls

Current player: ${username}
Incoming message: ${message}

World snapshot:
${getNearbyVision()}
`.trim()
}

async function searchDuckDuckGo(query) {
  try {
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`)
    const data = await response.json()

    const bits = []
    if (data.AbstractText) bits.push(data.AbstractText)
    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 3)) {
        if (topic?.Text) bits.push(topic.Text)
      }
    }

    return bits.length ? bits.join(' | ') : 'No useful web result found.'
  } catch (err) {
    console.log('DuckDuckGo search error:', err?.message || err)
    return 'Search failed.'
  }
}

async function generateAIReply(username, message) {
  const lower = message.toLowerCase()
  let extraContext = ''

  if (
    lower.includes('how') ||
    lower.includes('what') ||
    lower.includes('why') ||
    lower.includes('search') ||
    lower.includes('look up')
  ) {
    extraContext = await searchDuckDuckGo(message)
  }

  try {
    console.log(`Generating AI reply for ${username}: ${message}`)

    const completion = await openai.chat.completions.create({
      model: 'liquid/lfm-2.5-1.2b-instruct:free',
      messages: [
        {
          role: 'system',
          content: summarizePrompt(username, message)
        },
        {
          role: 'user',
          content: `Web context: ${extraContext}\n\nUser says: ${message}`
        }
      ]
    })

    const content = completion.choices?.[0]?.message?.content?.trim()
    console.log('OpenRouter reply received:', Boolean(content))

    return content || 'mhm'
  } catch (err) {
    console.log('OpenRouter error:', err?.message || err)
    return 'my brain lagged for a sec'
  }
}

function setFollowGoal(targetEntity) {
  if (!targetEntity) return false

  bot.pathfinder.setGoal(new goals.GoalFollow(targetEntity, 2), true)
  return true
}

function roamSomewhere() {
  if (!bot.entity || isRoaming) return
  if (isAuthorized(currentHiredUser) || pendingHire) return

  const p = bot.entity.position
  const rx = Math.floor(Math.random() * 18) - 9
  const rz = Math.floor(Math.random() * 18) - 9
  const tx = Math.floor(p.x + rx)
  const ty = Math.floor(p.y)
  const tz = Math.floor(p.z + rz)

  isRoaming = true
  console.log(`Roaming to ${tx}, ${ty}, ${tz}`)

  bot.pathfinder.setGoal(new goals.GoalNear(tx, ty, tz, 1), false)

  setTimeout(() => {
    isRoaming = false
  }, 12000)
}

async function dropItemByName(itemName) {
  const item = bot.inventory.items().find(i => i.name === itemName || i.name.includes(itemName))
  if (!item) return false

  try {
    await bot.tossStack(item)
    return true
  } catch {
    return false
  }
}

async function dropAllItems() {
  const items = bot.inventory.items()
  for (const item of items) {
    try {
      await bot.tossStack(item)
    } catch {}
  }
}

function startIdleRoamLoop() {
  if (roamIntervalHandle) clearInterval(roamIntervalHandle)

  roamIntervalHandle = setInterval(() => {
    if (!movementReady) return
    if (bot.pathfinder?.isMoving?.()) return
    if (hasExpiredHire()) return
    if (currentHiredUser) return
    if (pendingHire) return
    if (now() - lastHumanInteractionAt < ROAM_INTERVAL) return

    roamSomewhere()
  }, ROAM_INTERVAL)
}

bot.once('spawn', () => {
  console.log('AI Companion Online')

  const mcData = minecraftData(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canDig = false
  movements.allowParkour = true
  movements.allowSprinting = true
  bot.pathfinder.setMovements(movements)
  movementReady = true

  console.log('Movement ready')
  startIdleRoamLoop()

  setTimeout(() => {
    bot.chat('/login ' + process.env.MC_PASSWORD)
  }, 5000)
})

bot.on('messagestr', message => {
  const msg = message.toLowerCase()
  console.log('[SERVER]', message)

  if (msg.includes('/register')) {
    setTimeout(() => {
      bot.chat(`/register ${process.env.MC_PASSWORD} ${process.env.MC_PASSWORD}`)
    }, 3000)
  }

  if (msg.includes('/login')) {
    setTimeout(() => {
      bot.chat(`/login ${process.env.MC_PASSWORD}`)
    }, 3000)
  }
})

bot.on('death', () => {
  console.log('Bot died')
  setTimeout(() => bot.chat('ow that hurt'), 3000)
})

bot.on('kicked', reason => {
  console.log('Bot kicked:', reason)
})

bot.on('error', err => {
  console.log('Bot error:', err.message)
})

setInterval(() => {
  if (hasExpiredHire()) {
    console.log(`Hire expired for ${currentHiredUser}`)
    bot.chat(`${currentHiredUser} your rental expired`)
    clearHire()
  }
}, 10000)

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  lastHumanInteractionAt = now()
  const lower = message.toLowerCase()
  console.log('[CHAT]', username, message)

  if (lower.includes('stop')) {
    bot.pathfinder.setGoal(null)
    bot.chat('oki stopping')
    return
  }

  if (lower.includes('follow me')) {
    const target = bot.players[username]
    if (!target?.entity) {
      bot.chat('i cant see you')
      return
    }
    setFollowGoal(target.entity)
    bot.chat('okay im coming')
    return
  }

  if (lower.includes('come here')) {
    const target = bot.players[username]
    if (!target?.entity) {
      bot.chat('where are you')
      return
    }
    const pos = target.entity.position
    bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 1), false)
    bot.chat('coming')
    return
  }

  if (lower.includes('roam')) {
    roamSomewhere()
    bot.chat('okay, wandering a bit')
    return
  }

  if (lower.includes('scan')) {
    bot.chat('scanning the area')
    const vision = getNearbyVision()
    console.log('[VISION]', vision)
    return
  }

  if (lower.includes('inventory')) {
    const items = bot.inventory.items()
    if (!items.length) {
      bot.chat('inventory empty')
      return
    }
    const names = items.slice(0, 8).map(i => `${i.name} x${i.count}`).join(', ')
    bot.chat(names)
    return
  }

  if (lower.includes('drop all')) {
    await dropAllItems()
    bot.chat('dropped everything')
    return
  }

  if (lower.startsWith('drop ')) {
    const itemName = lower.replace('drop ', '').trim()
    const ok = await dropItemByName(itemName)
    bot.chat(ok ? `dropped ${itemName}` : 'i dont have that')
    return
  }

  if (lower === 'hire') {
    bot.chat(`Give me ${process.env.PAYMENT_AMOUNT} ${process.env.PAYMENT_ITEM}s.`)
    return
  }

  if (
    username === OWNER &&
    lower === `${BOT_NAME.toLowerCase()} drop off the cash`
  ) {
    await dropAllItems()
    bot.chat('bringing secured items')
    return
  }

  if (username !== OWNER && containsProtectedRequest(message)) {
    bot.chat('i cant access secured storage')
    return
  }

  if (
    !isAuthorized(username) &&
    !messageLooksDirectedAtBot(message)
  ) {
    return
  }

  if (lower.includes('search') || lower.includes('look up')) {
    const result = await searchDuckDuckGo(message)
    bot.chat(result.slice(0, 240))
    return
  }

  const reply = await generateAIReply(username, message)

  setTimeout(() => {
    bot.chat(reply)
  }, Math.floor(Math.random() * (AI_REPLY_MAX_DELAY - AI_REPLY_MIN_DELAY)) + AI_REPLY_MIN_DELAY)
})

bot.on('playerCollect', (collector, entity) => {
  if (collector !== bot.entity) return

  const item = entity.getDroppedItem()
  if (!item) return

  if (
    item.name === process.env.PAYMENT_ITEM &&
    item.count >= Number(process.env.PAYMENT_AMOUNT)
  ) {
    bot.chat('lemme store these first')

    setTimeout(() => {
      const code = uuidv4().split('-')[0].toUpperCase()
      activeCodes[code] = { created: now() }
      bot.chat(`Your hire code is ${code}`)
      bot.chat('payment secured')
    }, 3000)
  }
})

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: process.env.MC_USERNAME,
    hiredUser: currentHiredUser,
    hireExpiresAt,
    roaming: isRoaming,
    lastInteractionAt: lastHumanInteractionAt
  })
})

app.post('/redeem', (req, res) => {
  const { code, username } = req.body

  if (!activeCodes[code]) {
    return res.status(400).json({ success: false })
  }

  currentHiredUser = username
  hireExpiresAt = now() + HIRE_TIME
  delete activeCodes[code]

  return res.json({ success: true, message: `${BOT_NAME} is now hired by ${username}` })
})

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
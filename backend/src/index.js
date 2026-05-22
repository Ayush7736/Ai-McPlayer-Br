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

const PORT = process.env.PORT || 3000
const BOT_NAME = process.env.BOT_NAME || 'Liyro74'
const OWNER = process.env.OWNER_USERNAME || 'MrZyro74'
const HIRE_TIME = 15 * 60 * 1000

let currentHiredUser = null
let hireExpiresAt = null
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

bot.once('spawn', () => {
  console.log('AI Companion Online')

  const mcData = minecraftData(bot.version)
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)

  console.log('Movement ready')
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

async function generateAIReply(username, message) {
  try {
    console.log(`Generating AI reply for ${username}: ${message}`)

    const completion = await openai.chat.completions.create({
      model: 'liquid/lfm-2.5-1.2b-instruct:free',
      messages: [
        {
          role: 'system',
          content: `You are ${BOT_NAME}, a female Minecraft companion AI.`
        },
        {
          role: 'user',
          content: `${username}: ${message}`
        }
      ]
    })

    return completion.choices?.[0]?.message?.content || 'mhm'
  } catch (err) {
    console.log(err)
    return 'my brain lagged'
  }
}

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  const lower = message.toLowerCase()

  console.log('[CHAT]', username, message)

  if (lower.includes('follow me')) {
    const target = bot.players[username]

    if (!target?.entity) {
      bot.chat('i cant see you')
      return
    }

    bot.pathfinder.setGoal(
      new goals.GoalFollow(target.entity, 2),
      true
    )

    bot.chat('okay im coming')
    return
  }

  if (lower.includes('stop')) {
    bot.pathfinder.setGoal(null)
    bot.chat('oki stopping')
    return
  }

  const reply = await generateAIReply(username, message)

  setTimeout(() => {
    bot.chat(reply)
  }, 1000)
})

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: process.env.MC_USERNAME,
    hiredUser: currentHiredUser,
    hireExpiresAt
  })
})

app.post('/redeem', (req, res) => {
  const { code, username } = req.body

  if (!activeCodes[code]) {
    return res.status(400).json({ success: false })
  }

  currentHiredUser = username
  hireExpiresAt = Date.now() + HIRE_TIME

  delete activeCodes[code]

  return res.json({ success: true })
})

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
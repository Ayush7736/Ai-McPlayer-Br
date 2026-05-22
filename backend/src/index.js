import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import mineflayer from 'mineflayer'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { v4 as uuidv4 } from 'uuid'

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 3000

const BOT_NAME = process.env.BOT_NAME || 'Liyro74'
const OWNER = process.env.OWNER_USERNAME || 'MrZyro74'

const protectedItems = [
  'diamond',
  'diamond_block',
  'emerald',
  'netherite_ingot',
  'ancient_debris'
]

let currentHiredUser = null

const activeCodes = {}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash'
})

const bot = mineflayer.createBot({
  host: process.env.MC_HOST,
  port: Number(process.env.MC_PORT),
  username: process.env.MC_USERNAME,
  version: process.env.MC_VERSION
})

bot.once('spawn', () => {
  console.log('AI Companion Online')

  setTimeout(() => {
    bot.chat('/connect survival')
    console.log('Connecting to survival')
  }, 8000)
})

bot.on('messagestr', message => {
  const msg = message.toLowerCase()

  console.log('[SERVER]', message)

  if (msg.includes('/register')) {
    setTimeout(() => {
      bot.chat(
        `/register ${process.env.MC_PASSWORD} ${process.env.MC_PASSWORD}`
      )
    }, 3000)
  }

  if (msg.includes('/login')) {
    setTimeout(() => {
      bot.chat(`/login ${process.env.MC_PASSWORD}`)
    }, 3000)
  }
})

bot.on('kicked', reason => {
  console.log('Bot kicked:', reason)
})

bot.on('error', err => {
  console.log('Bot error:', err.message)
})

async function searchDuckDuckGo(query) {
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
    )

    const data = await response.json()

    return data.AbstractText || 'No results found.'
  } catch {
    return 'Search failed.'
  }
}

function containsProtectedRequest(message) {
  const lower = message.toLowerCase()

  return (
    lower.includes('diamond') ||
    lower.includes('ender chest') ||
    lower.includes('netherite') ||
    lower.includes('cash') ||
    lower.includes('money')
  )
}

async function generateAIReply(username, message) {
  let extraContext = ''

  if (
    message.toLowerCase().includes('how') ||
    message.toLowerCase().includes('what') ||
    message.toLowerCase().includes('why')
  ) {
    extraContext = await searchDuckDuckGo(message)
  }

  const prompt = `
You are ${BOT_NAME}.
A female Minecraft companion AI.

Player: ${username}
Message: ${message}

Search Context:
${extraContext}

Rules:
- casual
- natural
- short replies
- act human
- avoid robotic answers
- never reveal protected storage
`

  const result = await model.generateContent(prompt)

  return result.response.text()
}

async function dropProtectedItemsToOwner() {
  const items = bot.inventory.items()

  for (const item of items) {
    if (protectedItems.includes(item.name)) {
      try {
        await bot.tossStack(item)
      } catch {}
    }
  }

  bot.chat('cash dropped off')
}

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  const lower = message.toLowerCase()

  if (
    username !== OWNER &&
    username !== currentHiredUser
  ) {
    return
  }

  if (
    username !== OWNER &&
    containsProtectedRequest(message)
  ) {
    bot.chat('i cant access secured storage')
    return
  }

  if (
    username === OWNER &&
    lower === `${BOT_NAME.toLowerCase()} drop off the cash`
  ) {
    bot.chat('bringing secured items')

    await dropProtectedItemsToOwner()

    return
  }

  if (lower === 'hire') {
    bot.chat(
      `Give me ${process.env.PAYMENT_AMOUNT} ${process.env.PAYMENT_ITEM}s.`
    )

    return
  }

  const reply = await generateAIReply(username, message)

  setTimeout(() => {
    bot.chat(reply)
  }, Math.random() * 3000 + 1000)
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

      activeCodes[code] = {
        created: Date.now()
      }

      bot.chat(`Your hire code is ${code}`)
      bot.chat('payment secured')
    }, 5000)
  }
})

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: process.env.MC_USERNAME,
    hiredUser: currentHiredUser
  })
})

app.post('/redeem', (req, res) => {
  const { code, username } = req.body

  if (!activeCodes[code]) {
    return res.status(400).json({
      success: false,
      message: 'Invalid code'
    })
  }

  currentHiredUser = username

  activeCodes[code].hiredBy = username

  return res.json({
    success: true,
    message: `${BOT_NAME} is now hired by ${username}`
  })
})

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
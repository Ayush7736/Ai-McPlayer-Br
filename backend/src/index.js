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
You are Luna.
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
`

  const result = await model.generateContent(prompt)

  return result.response.text()
}

bot.on('chat', async (username, message) => {
  if (username === bot.username) return

  if (message.toLowerCase() === 'hire') {
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
        owner: entity.metadata?.username || 'unknown',
        created: Date.now()
      }

      bot.chat(`/msg ${username} Your hire code is ${code}`)
      bot.chat('payment secured')
    }, 5000)
  }
})

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: process.env.MC_USERNAME
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

  activeCodes[code].hiredBy = username

  return res.json({
    success: true,
    message: 'AI companion hired successfully'
  })
})

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})

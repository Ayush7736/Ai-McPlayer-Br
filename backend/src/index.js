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

const BOT_NAME =
  process.env.BOT_NAME || 'Liyro74'

const OWNER =
  process.env.OWNER_USERNAME || 'MrZyro74'

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

let movementReady = false
let roamTarget = null

// =======================
// AI WORLD VISION
// =======================

function perceiveWorld() {
  const nearbyPlayers =
    Object.values(bot.players)
      .filter(
        p =>
          p.entity &&
          p.username !== bot.username
      )
      .map(p => ({
        username: p.username,
        distance:
          bot.entity.position.distanceTo(
            p.entity.position
          )
      }))

  const hostile =
    bot.nearestEntity(entity => {
      if (!entity?.mobType) return false

      return [
        'Zombie',
        'Skeleton',
        'Spider',
        'Creeper'
      ].includes(entity.mobType)
    })

  return {
    health: bot.health,
    food: bot.food,
    nearbyPlayers,
    hostile:
      hostile
        ? {
            type: hostile.mobType,
            distance:
              bot.entity.position.distanceTo(
                hostile.position
              )
          }
        : null
  }
}

// =======================
// AI BRAIN
// =======================

async function reasonAndAct() {
  if (!bot.entity) return

  const world = perceiveWorld()

  // Threat handling
  if (
    world.hostile &&
    world.hostile.distance < 5
  ) {
    await escapeThreat()
    return
  }

  // Follow owner automatically
  const owner =
    bot.players[OWNER]

  if (
    owner?.entity &&
    bot.entity.position.distanceTo(
      owner.entity.position
    ) < 12
  ) {
    bot.pathfinder.setGoal(
      new goals.GoalFollow(
        owner.entity,
        2
      ),
      true
    )

    return
  }

  // Autonomous roaming
  autonomousRoam()
}

// =======================
// ESCAPE LOGIC
// =======================

async function escapeThreat() {
  const hostile =
    bot.nearestEntity(
      e => e?.mobType
    )

  if (!hostile) return

  const dx =
    bot.entity.position.x -
    hostile.position.x

  const dz =
    bot.entity.position.z -
    hostile.position.z

  const tx =
    bot.entity.position.x + dx * 3

  const tz =
    bot.entity.position.z + dz * 3

  bot.pathfinder.setGoal(
    new goals.GoalNear(
      tx,
      bot.entity.position.y,
      tz,
      1
    )
  )

  bot.chat('NOPE NOPE NOPE')
}

// =======================
// SMART ROAMING
// =======================

function autonomousRoam() {
  if (!movementReady) return

  if (!roamTarget || Math.random() > 0.7) {
    const rx =
      Math.floor(Math.random() * 20) - 10

    const rz =
      Math.floor(Math.random() * 20) - 10

    roamTarget = {
      x:
        Math.floor(
          bot.entity.position.x + rx
        ),
      y:
        Math.floor(
          bot.entity.position.y
        ),
      z:
        Math.floor(
          bot.entity.position.z + rz
        )
    }
  }

  bot.pathfinder.setGoal(
    new goals.GoalNear(
      roamTarget.x,
      roamTarget.y,
      roamTarget.z,
      1
    )
  )
}

// =======================
// AI CHAT
// =======================

async function generateAIReply(
  username,
  message
) {
  try {
    const completion =
      await openai.chat.completions.create({
        model:
          'liquid/lfm-2.5-1.2b-instruct:free',

        messages: [
          {
            role: 'system',
            content: `
You are ${BOT_NAME}.

You are a human-like female Minecraft companion.

Act natural and emotional.

Never say you are an AI.

Behave like a real player.

You can:
- move
- explore
- defend yourself
- react emotionally
- roam freely

Keep responses short and human.
`
          },
          {
            role: 'user',
            content: `
Player: ${username}

Message:
${message}

World:
${JSON.stringify(
  perceiveWorld()
)}
`
          }
        ]
      })

    return (
      completion.choices?.[0]?.message
        ?.content || 'mhm'
    )
  } catch (err) {
    console.log(err)

    return 'brain lag'
  }
}

// =======================
// SPAWN
// =======================

bot.once('spawn', () => {
  console.log('AI Companion Online')

  const mcData =
    minecraftData(bot.version)

  const movements =
    new Movements(bot, mcData)

  movements.canDig = false
  movements.allowParkour = true
  movements.allowSprinting = true

  bot.pathfinder.setMovements(
    movements
  )

  movementReady = true

  console.log('Movement ready')
})

// =======================
// AUTO LOGIN
// =======================

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
      bot.chat(
        `/login ${process.env.MC_PASSWORD}`
      )
    }, 3000)
  }
})

// =======================
// DAMAGE REACTION
// =======================

bot.on('entityHurt', entity => {
  if (entity !== bot.entity) return

  bot.chat('OW WTF')

  bot.setControlState(
    'jump',
    true
  )

  setTimeout(() => {
    bot.setControlState(
      'jump',
      false
    )
  }, 400)
})

// =======================
// DEATH
// =======================

bot.on('death', () => {
  console.log('Bot died')

  setTimeout(() => {
    bot.chat('ow that hurt')
  }, 3000)
})

// =======================
// STUCK RECOVERY
// =======================

setInterval(() => {
  if (
    !bot.pathfinder?.isMoving?.()
  )
    return

  bot.setControlState(
    'jump',
    true
  )

  setTimeout(() => {
    bot.setControlState(
      'jump',
      false
    )
  }, 300)
}, 15000)

// =======================
// MAIN AI LOOP
// =======================

setInterval(async () => {
  try {
    await reasonAndAct()
  } catch (err) {
    console.log(
      'AI brain error:',
      err
    )
  }
}, 3000)

// =======================
// CHAT COMMANDS
// =======================

bot.on(
  'chat',
  async (username, message) => {
    if (username === bot.username)
      return

    const lower =
      message.toLowerCase()

    console.log(
      '[CHAT]',
      username,
      message
    )

    if (lower === 'stop') {
      bot.pathfinder.setGoal(null)

      bot.chat('oki')

      return
    }

    if (lower === 'follow me') {
      const target =
        bot.players[username]

      if (!target?.entity) {
        bot.chat(
          'i cant see you'
        )

        return
      }

      bot.pathfinder.setGoal(
        new goals.GoalFollow(
          target.entity,
          2
        ),
        true
      )

      bot.chat(
        'okay im coming'
      )

      return
    }

    if (lower === 'inventory') {
      const items =
        bot.inventory.items()

      if (!items.length) {
        bot.chat(
          'inventory empty'
        )

        return
      }

      bot.chat(
        items
          .map(
            i =>
              `${i.name} x${i.count}`
          )
          .join(', ')
      )

      return
    }

    if (lower === 'drop all') {
      const items =
        bot.inventory.items()

      for (const item of items) {
        try {
          await bot.tossStack(item)
        } catch {}
      }

      bot.chat(
        'dropped everything'
      )

      return
    }

    if (lower.startsWith('drop ')) {
      const itemName =
        lower
          .replace('drop ', '')
          .trim()

      const item =
        bot.inventory
          .items()
          .find(i =>
            i.name.includes(
              itemName
            )
          )

      if (!item) {
        bot.chat(
          'i dont have that'
        )

        return
      }

      try {
        await bot.tossStack(item)

        bot.chat(
          `dropped ${item.name}`
        )
      } catch {
        bot.chat(
          'failed to drop'
        )
      }

      return
    }

    const reply =
      await generateAIReply(
        username,
        message
      )

    setTimeout(() => {
      bot.chat(reply)
    }, 1000)
  }
)

// =======================
// EXPRESS
// =======================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: process.env.MC_USERNAME
  })
})

app.listen(PORT, () => {
  console.log(
    `Backend running on port ${PORT}`
  )
})

import { app } from './app.js'
import { env } from './config/env.js'
import { encryptLegacyShareTokens } from './modules/files/share-token.js'

app.listen(env.APP_PORT, () => {
  console.log(`Backend running on http://localhost:${env.APP_PORT}`)
})

encryptLegacyShareTokens()
  .then((count) => {
    if (count > 0) console.info(`[startup] encrypted ${count} legacy share token(s)`)
  })
  .catch((error) => console.error('[startup] failed to encrypt legacy share tokens:', error instanceof Error ? error.message : error))

import app, { aiPendingRecoveryMs } from './app.js'
import { recoverPendingGenerations } from './db.js'

const port = Number(process.env.PORT || 3100)
app.listen(port, '0.0.0.0', () => console.log(`Infinite Canvas: http://localhost:${port}`))
const recoveryTimer = setInterval(() => {
  try { recoverPendingGenerations(aiPendingRecoveryMs) }
  catch (error) { console.error('Pending AI recovery failed', error) }
}, Math.min(aiPendingRecoveryMs, 60000))
recoveryTimer.unref()

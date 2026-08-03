import app, { aiPendingRecoveryMs, imagePendingRecoveryMs, videoPendingRecoveryMs } from './app.js'
import { recoverPendingGenerations } from './db.js'

const port = Number(process.env.PORT || 3102)
app.listen(port, '0.0.0.0', () => console.log(`Infinite Canvas: http://localhost:${port}`))
const recoveryTimer = setInterval(() => {
  try { recoverPendingGenerations(aiPendingRecoveryMs, videoPendingRecoveryMs, imagePendingRecoveryMs) }
  catch (error) { console.error('Pending AI recovery failed', error) }
}, Math.min(aiPendingRecoveryMs, imagePendingRecoveryMs, videoPendingRecoveryMs, 60000))
recoveryTimer.unref()

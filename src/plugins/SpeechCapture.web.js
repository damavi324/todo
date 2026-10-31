import { WebPlugin } from '@capacitor/core'

export class SpeechCaptureWeb extends WebPlugin {
  async checkPermissions() {
    return { microphone: 'prompt' }
  }

  async requestPermissions() {
    return { microphone: 'prompt' }
  }

  async stop() {
    this.rec?.abort()
  }

  async listen() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Rec) throw new Error('Speech recognition is not available in this browser')
    this.rec?.abort()
    return new Promise((resolve, reject) => {
      const rec = new Rec()
      this.rec = rec
      let settled = false
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        if (this.rec === rec) this.rec = null
        fn(value)
      }
      rec.lang = navigator.language || 'en-US'
      rec.interimResults = false
      rec.maxAlternatives = 1
      rec.onresult = (event) => settle(resolve, { text: event.results[0][0].transcript })
      rec.onerror = (event) =>
        settle(reject, new Error(event.error === 'aborted' ? 'Listening was cancelled' : event.error || 'Speech recognition failed'))
      // Recognition ends without a result when nothing was said.
      rec.onend = () => settle(reject, new Error("Didn't catch that. Try again."))
      rec.start()
    })
  }
}

import { WebPlugin } from '@capacitor/core'

export class SpeechCaptureWeb extends WebPlugin {
  async checkPermissions() {
    return { microphone: 'prompt' }
  }

  async requestPermissions() {
    return { microphone: 'prompt' }
  }

  async stop() {}

  async listen() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Rec) throw new Error('Speech recognition is not available in this browser')
    return new Promise((resolve, reject) => {
      const rec = new Rec()
      rec.lang = navigator.language || 'en-US'
      rec.interimResults = false
      rec.maxAlternatives = 1
      rec.onresult = (event) => {
        resolve({ text: event.results[0][0].transcript })
      }
      rec.onerror = (event) => reject(new Error(event.error || 'Speech recognition failed'))
      rec.start()
    })
  }
}

import { registerPlugin } from '@capacitor/core'

const SpeechCapture = registerPlugin('SpeechCapture', {
  web: () => import('./SpeechCapture.web').then((m) => new m.SpeechCaptureWeb()),
})

export default SpeechCapture

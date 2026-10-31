import { registerPlugin } from '@capacitor/core'

/**
 * Native DeviceCalendar plugin (Android).
 * Reads the phone's calendar store, which the Samsung and Google calendar apps both display.
 */
const DeviceCalendar = registerPlugin('DeviceCalendar')

export default DeviceCalendar

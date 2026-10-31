import { registerPlugin } from '@capacitor/core'

/**
 * Native PhoneContacts plugin (Android).
 * Reads names and phone numbers from the phone's contacts, so calls can be placed to them.
 */
const PhoneContacts = registerPlugin('PhoneContacts')

export default PhoneContacts

// Whether each voice of Google's Android speech engine is male or female. The engine only reports
// codes such as "en-us-x-iom-local", so this is what lets the voice picker say which is which.
const GOOGLE_VOICE_GENDER = {
  // US
  iol: 'Male', iom: 'Male', tpd: 'Male',
  iob: 'Female', iog: 'Female', sfg: 'Female', tpc: 'Female', tpf: 'Female',
  // UK
  gbb: 'Male', gbd: 'Male', rjs: 'Male',
  gba: 'Female', gbc: 'Female', gbg: 'Female', fis: 'Female',
  // Australia
  aub: 'Male', aud: 'Male',
  aua: 'Female', auc: 'Female',
  // India
  end: 'Male', ene: 'Male',
  ena: 'Female', enc: 'Female', ahp: 'Female', cxx: 'Female',
}

export const PITCHES = [
  { value: 1, label: 'Normal' },
  { value: 0.8, label: 'Deep' },
  { value: 0.65, label: 'Very deep' },
]

function regionName(locale) {
  try {
    const region = new Intl.Locale(locale).region
    return (region && new Intl.DisplayNames(['en'], { type: 'region' }).of(region)) || locale
  } catch {
    return locale
  }
}

/** Turn the voices a device reports into picker options, male voices first. */
export function voiceOptions(voices) {
  const counts = {}
  return voices
    .map((v) => {
      const code = /-x-([a-z]{3})-/.exec(v.id)?.[1]
      const gender = GOOGLE_VOICE_GENDER[code] || ''
      return { ...v, gender, region: regionName(v.locale) }
    })
    .sort((a, b) =>
      (a.gender === 'Male' ? 0 : 1) - (b.gender === 'Male' ? 0 : 1) ||
      a.region.localeCompare(b.region) ||
      a.id.localeCompare(b.id)
    )
    .map((v) => {
      // Browsers give voices real names; Android voices are numbered within their group.
      if (v.name) return { id: v.id, label: v.name }
      const group = `${v.gender || 'Voice'} · ${v.region}`
      counts[group] = (counts[group] || 0) + 1
      return { id: v.id, label: `${group} ${counts[group]}` }
    })
}

/**
 * Preset grooves, stored in the app's own URL format so loading a preset is
 * just parseUrl(). Each query string must be canonical (it round-trips
 * through toUrl unchanged) — enforced by presets.test.ts.
 */

export interface Preset {
  name: string;
  query: string;
}

export const PRESETS: Preset[] = [
  {
    name: 'Basic Rock',
    query:
      '?TimeSig=4/4&Div=8&Tempo=90&Measures=1&H=|xxxxxxxx|&S=|--O---O-|&K=|o---o-o-|',
  },
  {
    name: 'Rock (16th kicks)',
    query:
      '?TimeSig=4/4&Div=16&Tempo=95&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o------oo-o-----|',
  },
  {
    name: 'Funk (ghost notes)',
    query:
      '?TimeSig=4/4&Div=16&Tempo=96&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|-g--O--g-g--O--g|&K=|o-o-----o-o-----|',
  },
  {
    name: 'Disco',
    query:
      '?TimeSig=4/4&Div=16&Tempo=110&Measures=1&H=|x-o-x-o-x-o-x-o-|&S=|----O-------O---|&K=|o---o---o---o---|',
  },
  {
    name: 'Half-time',
    query:
      '?TimeSig=4/4&Div=16&Tempo=85&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|--------O-------|&K=|o---------o-----|',
  },
  {
    name: 'Shuffle',
    query:
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|x-xx-xx-xx-x|&S=|---O-----O--|&K=|o-----o-----|',
  },
  {
    name: 'Jazz Ride',
    query:
      '?TimeSig=4/4&Div=12&Tempo=140&Measures=1&H=|r--r-rr--r-r|&S=|------------|&K=|---x-----x--|',
  },
  {
    name: '6/8 Groove',
    query:
      '?TimeSig=6/8&Div=16&Tempo=70&Measures=1&H=|x-x-x-x-x-x-|&S=|------o-----|&K=|o-----------|',
  },
  {
    name: 'Blank (16ths)',
    query:
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|',
  },
];
